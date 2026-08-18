import logging
from urllib.parse import urlparse

from django.db.models import Count, Q
from django.utils import timezone
from rest_framework import parsers, serializers, status, viewsets
from rest_framework.decorators import action, api_view, permission_classes
from rest_framework.exceptions import PermissionDenied
from rest_framework.response import Response

from fleet_manager.permissions import IsAdmin, IsEditorOrReadOnly, IsSuperAdmin, user_can_delete_content
from history.logging import log_action

from .models import MediaFile, MediaFolder, ScheduledDeployment, detect_file_type
from .scoping import filter_folders, filter_media_files, is_root_content_visible_to_editors, set_root_content_visible_to_editors
from .serializers import MediaFileSerializer, MediaFolderSerializer, ScheduledDeploymentSerializer
from .tasks import _is_safe_url, fetch_og_image_task, generate_image_thumbnail, transcode_video

logger = logging.getLogger(__name__)


@api_view(['GET', 'PATCH'])
@permission_classes([IsAdmin])
def content_library_settings(request):
    """Admin-only content-library-wide settings — currently just whether
    root-level (folderless) content is visible to editors. Separate from
    a folder's own is_common flag: this covers content that was never
    organized into a folder at all."""
    if request.method == 'PATCH' and 'root_visible_to_editors' in request.data:
        set_root_content_visible_to_editors(request.data['root_visible_to_editors'])
        log_action(
            request, 'update', 'settings', target_name='content_library',
            details={'root_visible_to_editors': bool(request.data['root_visible_to_editors'])},
        )
    return Response({'root_visible_to_editors': is_root_content_visible_to_editors()})


class MediaFolderViewSet(viewsets.ModelViewSet):
    """ViewSet for managing media folders."""
    # Unfiltered — only here for the router's automatic basename
    # inference (content/urls.py registers this without an explicit
    # basename=). Every real request is served through get_queryset()
    # below, which applies the actual scoping filter.
    queryset = MediaFolder.objects.all()
    serializer_class = MediaFolderSerializer
    permission_classes = [IsEditorOrReadOnly]

    def get_queryset(self):
        qs = MediaFolder.objects.select_related('location', 'group').annotate(
            file_count=Count('files', filter=Q(files__is_deleted=False)),
        )
        return filter_folders(qs, self.request.user)

    def perform_create(self, serializer):
        folder = serializer.save()
        log_action(self.request, 'create', 'folder', target_id=folder.id, target_name=folder.name)

    def perform_update(self, serializer):
        folder = serializer.save()
        log_action(self.request, 'update', 'folder', target_id=folder.id, target_name=folder.name)

    def perform_destroy(self, instance):
        log_action(self.request, 'delete', 'folder', target_id=instance.id, target_name=instance.name)
        instance.delete()

    @action(detail=True, methods=['post'], permission_classes=[IsAdmin], url_path='set-common')
    def set_common(self, request, pk=None):
        """Admin-only — mark/unmark a folder (and, per MediaFolder.
        effective_is_common, everything nested under it) as visible to
        every editor regardless of their own location/group scope. The
        one write path for is_common; the regular create/update
        endpoint above deliberately can't touch it (see the
        serializer's read_only_fields)."""
        folder = MediaFolder.objects.filter(pk=pk).first()
        if not folder:
            return Response({'error': 'Not found.'}, status=status.HTTP_404_NOT_FOUND)
        is_common = bool(request.data.get('is_common'))
        folder.is_common = is_common
        folder.save(update_fields=['is_common'])
        log_action(
            request, 'update', 'folder', target_id=folder.id, target_name=folder.name,
            details={'is_common': is_common},
        )
        return Response(self.get_serializer(folder).data)


class MediaFileViewSet(viewsets.ModelViewSet):
    """ViewSet for managing uploaded media files."""
    serializer_class = MediaFileSerializer
    parser_classes = [parsers.MultiPartParser, parsers.FormParser, parsers.JSONParser]
    permission_classes = [IsEditorOrReadOnly]

    def get_queryset(self):
        qs = MediaFile.objects.select_related('folder').prefetch_related('cctv_config__cameras')
        if self.request.query_params.get('deleted') == '1':
            qs = qs.filter(is_deleted=True)
        else:
            qs = qs.filter(is_deleted=False)
        folder = self.request.query_params.get('folder')
        if folder == 'none':
            qs = qs.filter(folder__isnull=True)
        elif folder:
            qs = qs.filter(folder_id=folder)
        file_type = self.request.query_params.get('file_type')
        if file_type:
            qs = qs.filter(file_type=file_type)
        return filter_media_files(qs, self.request.user)

    def perform_destroy(self, instance):
        """Soft-delete a MediaFile — hides it from normal use but keeps it
        recoverable from the recycle bin. If CCTV, stop the live stream
        (an inactive/deleted item shouldn't keep streaming)."""
        if not user_can_delete_content(self.request.user):
            raise PermissionDenied('You do not have permission to delete content.')
        log_action(self.request, 'delete', 'media', target_id=instance.id, target_name=instance.name)
        if instance.file_type == 'cctv':
            try:
                cctv_config = instance.cctv_config
                if cctv_config.is_active:
                    from cctv.services import stop_stream
                    stop_stream(str(cctv_config.id))
            except Exception:
                pass  # cctv_config may not exist
        instance.is_deleted = True
        instance.deleted_at = timezone.now()
        instance.save(update_fields=['is_deleted', 'deleted_at'])

    @action(detail=True, methods=['post'])
    def restore(self, request, pk=None):
        """Recover a soft-deleted MediaFile from the recycle bin."""
        instance = MediaFile.objects.filter(pk=pk).first()
        if not instance:
            return Response({'error': 'Not found.'}, status=status.HTTP_404_NOT_FOUND)
        instance.is_deleted = False
        instance.deleted_at = None
        instance.save(update_fields=['is_deleted', 'deleted_at'])
        log_action(request, 'restore', 'media', target_id=instance.id, target_name=instance.name)
        return Response(self.get_serializer(instance).data)

    @action(detail=True, methods=['delete'], permission_classes=[IsSuperAdmin])
    def purge(self, request, pk=None):
        """Permanently delete a MediaFile — only a superadmin can do this."""
        instance = MediaFile.objects.filter(pk=pk).first()
        if not instance:
            return Response({'error': 'Not found.'}, status=status.HTTP_404_NOT_FOUND)
        if instance.file_type == 'cctv':
            try:
                instance.cctv_config.delete()
            except Exception:
                pass
        log_action(request, 'purge', 'media', target_id=instance.id, target_name=instance.name)
        instance.delete()
        return Response(status=status.HTTP_204_NO_CONTENT)

    def perform_create(self, serializer):
        uploaded_file = self.request.FILES.get('file')
        source_url = self.request.data.get('source_url')
        if uploaded_file:
            name = self.request.data.get('name') or uploaded_file.name
            file_type = detect_file_type(uploaded_file.name)
            instance = serializer.save(
                name=name,
                file_type=file_type,
                file_size=uploaded_file.size,
            )
            log_action(self.request, 'upload', 'media', target_id=instance.id, target_name=name, details={'file_type': file_type, 'size': uploaded_file.size})
            if file_type == 'video':
                instance.processing_status = 'processing'
                instance.save(update_fields=['processing_status'])
                transcode_video.delay(str(instance.id))
            elif file_type == 'image':
                generate_image_thumbnail.delay(str(instance.id))
        elif source_url:
            # Allow CCTV player URLs on the same server (local network)
            parsed = urlparse(source_url)
            is_cctv_url = parsed.path.startswith('/cctv/')
            if not is_cctv_url and not _is_safe_url(source_url):
                raise serializers.ValidationError({'source_url': 'URL points to a private or disallowed network.'})
            name = self.request.data.get('name') or source_url
            instance = serializer.save(
                name=name,
                source_url=source_url,
                file_type='web',
                file_size=0,
            )
            log_action(self.request, 'create', 'media', target_id=instance.id, target_name=name, details={'source_url': source_url})
            # Fetch og:image asynchronously to avoid blocking the request
            fetch_og_image_task.delay(str(instance.id), source_url)

    @action(detail=True, methods=['post'])
    def schedule(self, request, pk=None):
        """Deploy this content to a mix of devices/groups/locations at
        once, optionally with a start/end date — the centralized
        counterpart to picking one device at a time and deploying content
        from its own page. Resolution rule (direct players ∪ players in a
        target group ∪ players in a target location, directly or via a
        located group) matches Playlist.resolve_target_players."""
        media_file = self.get_object()

        player_ids = request.data.get('target_player_ids') or []
        group_ids = request.data.get('target_group_ids') or []
        location_ids = request.data.get('target_location_ids') or []
        if not (player_ids or group_ids or location_ids):
            return Response({'error': 'At least one target device, group or location is required.'}, status=status.HTTP_400_BAD_REQUEST)

        duration = request.data.get('duration')
        try:
            duration = int(duration) if duration not in (None, '') else 10
        except (TypeError, ValueError):
            return Response({'error': 'duration must be an integer'}, status=status.HTTP_400_BAD_REQUEST)
        start_date = request.data.get('start_date') or None
        end_date = request.data.get('end_date') or None

        from players.services import PlayerConnectionError, deploy_media_file_to_player, resolve_players_from_targets
        players = resolve_players_from_targets(player_ids, group_ids, location_ids)
        if not players:
            return Response({'error': 'No devices resolved from the selected targets.'}, status=status.HTTP_400_BAD_REQUEST)

        base_url = f'{request.scheme}://{request.get_host()}'
        results = {}
        for player in players:
            try:
                deploy_media_file_to_player(
                    player, media_file, duration=duration,
                    start_date=start_date, end_date=end_date, base_url=base_url,
                )
                results[str(player.id)] = {'name': player.name, 'success': True}
            except PlayerConnectionError as exc:
                results[str(player.id)] = {'name': player.name, 'success': False, 'error': str(exc)}
            except Exception as exc:
                logger.exception('Error scheduling %s to %s', media_file.name, player.name)
                results[str(player.id)] = {'name': player.name, 'success': False, 'error': str(exc)}

        log_action(
            request, 'schedule', 'media', target_id=media_file.id, target_name=media_file.name,
            details={'targets': len(results), 'start_date': start_date, 'end_date': end_date},
        )
        return Response({'success': True, 'results': results})


class ScheduledDeploymentViewSet(viewsets.ModelViewSet):
    """Centralized view of everything scheduled from the Scheduling page —
    a media_file schedule (ad-hoc targets, deployed synchronously here,
    same as MediaFileViewSet.schedule above) or a playlist schedule
    (reuses the playlist's own configured targets, deployed via the
    existing async deploy_playlist task with the date window attached).
    """
    queryset = ScheduledDeployment.objects.select_related('media_file', 'playlist').prefetch_related(
        'target_players', 'target_groups', 'target_locations',
    )
    serializer_class = ScheduledDeploymentSerializer
    permission_classes = [IsEditorOrReadOnly]

    def perform_create(self, serializer):
        schedule = serializer.save()
        start_date = schedule.start_date.strftime('%Y-%m-%dT%H:%M:%S.000Z') if schedule.start_date else None
        end_date = schedule.end_date.strftime('%Y-%m-%dT%H:%M:%S.000Z') if schedule.end_date else None

        if schedule.playlist_id:
            from playlists.tasks import deploy_playlist
            deploy_playlist.delay(str(schedule.playlist_id), start_date, end_date)
            log_action(
                self.request, 'schedule', 'playlist', target_id=schedule.playlist_id,
                target_name=schedule.playlist.name,
                details={'start_date': start_date, 'end_date': end_date},
            )
            return

        from players.services import PlayerConnectionError, deploy_media_file_to_player, resolve_players_from_targets
        players = resolve_players_from_targets(
            [str(p.id) for p in schedule.target_players.all()],
            [str(g.id) for g in schedule.target_groups.all()],
            [str(loc.id) for loc in schedule.target_locations.all()],
        )
        base_url = f'{self.request.scheme}://{self.request.get_host()}'
        results = {}
        deployed_assets = {}
        for player in players:
            try:
                asset = deploy_media_file_to_player(
                    player, schedule.media_file, duration=schedule.duration or 10,
                    start_date=start_date, end_date=end_date, base_url=base_url,
                )
                results[str(player.id)] = {'name': player.name, 'success': True}
                if asset and asset.get('asset_id'):
                    deployed_assets[str(player.id)] = [asset['asset_id']]
            except PlayerConnectionError as exc:
                results[str(player.id)] = {'name': player.name, 'success': False, 'error': str(exc)}
            except Exception as exc:
                logger.exception('Error deploying scheduled %s to %s', schedule.media_file.name, player.name)
                results[str(player.id)] = {'name': player.name, 'success': False, 'error': str(exc)}

        schedule.last_deploy_status = results
        schedule.deployed_assets = deployed_assets
        schedule.save(update_fields=['last_deploy_status', 'deployed_assets'])
        log_action(
            self.request, 'schedule', 'media', target_id=schedule.media_file_id,
            target_name=schedule.media_file.name,
            details={'targets': len(results), 'start_date': start_date, 'end_date': end_date},
        )

    def perform_destroy(self, instance):
        """Cancel a schedule — best-effort removal of whatever it
        deployed (media_file schedules only; a playlist schedule's
        assets belong to the playlist itself and are managed by its own
        deploy/re-deploy lifecycle, not this record)."""
        if instance.deployed_assets:
            from players.models import Player
            from players.services import AnthiasAPIClient
            for player_id, asset_ids in instance.deployed_assets.items():
                try:
                    player = Player.objects.get(pk=player_id)
                except Player.DoesNotExist:
                    continue
                client = AnthiasAPIClient(player)
                for asset_id in asset_ids:
                    try:
                        client.delete_asset(asset_id)
                    except Exception:
                        pass
        log_action(
            self.request, 'cancel_schedule', 'schedule', target_id=instance.id,
            target_name=str(instance.media_file or instance.playlist),
        )
        instance.delete()
