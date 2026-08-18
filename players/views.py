import logging

import requests as http_requests
from django.conf import settings
from django.core.cache import cache
from django.db import IntegrityError
from django.http import HttpResponse, StreamingHttpResponse
from django.utils import timezone
from rest_framework import status, viewsets
from rest_framework.decorators import action, api_view, permission_classes
from rest_framework.permissions import AllowAny
from rest_framework.response import Response
from rest_framework.views import APIView

from rest_framework.permissions import BasePermission

from fleet_manager.permissions import IsEditorOrReadOnly, _user_role

from content.models import MediaFile
from .editor_capabilities import action_allowed_for_editor
from .models import Player, PlayerSnapshot
from .serializers import PlayerListSerializer, PlayerSerializer, PlayerSnapshotSerializer
from .services import AnthiasAPIClient, PlayerConnectionError, deploy_media_file_to_player, format_player_error

logger = logging.getLogger(__name__)

PLAYER_VERSION_CACHE_KEY = 'player:latest_version'
PLAYER_VERSION_CACHE_TTL = 300  # 5 minutes


def _player_ghcr_repo(device_type='pi4'):
    """Org/repo path (no host) for the configured Anthias player image
    registry. x86/pi4/pi5 all run our own mupitech-player image (Phase
    5), which uses a different naming convention (hyphen before the
    service name, not the old fork's slash + `anthias-` prefix — see
    docker/Dockerfile.server.j2 in pedrom20/mupitech-player). Any other
    device_type falls back to the old third-party fork's convention."""
    from .provision import _COMPOSE_TEMPLATE_BY_DEVICE_TYPE
    if device_type in _COMPOSE_TEMPLATE_BY_DEVICE_TYPE:
        _, _, registry_setting = _COMPOSE_TEMPLATE_BY_DEVICE_TYPE[device_type]
        return getattr(settings, registry_setting).removeprefix('ghcr.io/') + '-server'
    return settings.ANTHIAS_IMAGE_REGISTRY.removeprefix('ghcr.io/') + '/anthias-server'


def _player_tag_suffix(device_type='pi4'):
    """Tag suffix used to filter GHCR tags for this device type. Our own
    mupitech-player image tags as plain `-<board>` (`-x86`, `-pi4-64`,
    `-pi5` — see docker-build.yaml in pedrom20/mupitech-player); the old
    fork (fallback for any other device_type) tagged as `-pi4-64`/`-pi5-64`."""
    from .provision import _COMPOSE_TEMPLATE_BY_DEVICE_TYPE
    if device_type in _COMPOSE_TEMPLATE_BY_DEVICE_TYPE:
        _, tag_suffix_setting, _ = _COMPOSE_TEMPLATE_BY_DEVICE_TYPE[device_type]
        return '-' + getattr(settings, tag_suffix_setting).removeprefix('latest-')
    return f'-{device_type}-64'


def _get_latest_player_version(device_type='pi4'):
    """Query GHCR OCI registry for the latest player SHA tag. Cached 5 min.

    Uses the anonymous token endpoint + tags/list API which works
    without authentication for public/org-visible packages.
    """
    tag_suffix = _player_tag_suffix(device_type)
    cache_key = f'{PLAYER_VERSION_CACHE_KEY}:{device_type}'
    cached = cache.get(cache_key)
    if cached:
        return cached

    image_name = _player_ghcr_repo(device_type)  # e.g. alex1981-tech/anthias-server or pedrom20/mupitech-player-server
    try:
        # Step 1: get anonymous bearer token
        token_resp = http_requests.get(
            f'https://ghcr.io/token?scope=repository:{image_name}:pull',
            timeout=10,
        )
        if token_resp.status_code != 200:
            return {'sha': '', 'error': f'Token endpoint returned {token_resp.status_code}'}
        token = token_resp.json().get('token', '')

        # Step 2: list tags
        tags_resp = http_requests.get(
            f'https://ghcr.io/v2/{image_name}/tags/list',
            headers={'Authorization': f'Bearer {token}'},
            timeout=10,
        )
        if tags_resp.status_code != 200:
            return {'sha': '', 'error': f'Tags API returned {tags_resp.status_code}'}

        tags = tags_resp.json().get('tags', [])
        # Collect SHA tags and version tags (last in list = newest)
        latest_sha = ''
        latest_version = ''
        for tag in tags:
            if not tag.endswith(tag_suffix) or 'latest' in tag:
                continue
            name = tag.replace(tag_suffix, '')
            if name.startswith('v') and '.' in name:
                latest_version = name  # e.g. "v1.0.0" — last wins
            else:
                latest_sha = name  # e.g. "abc1234" — last wins

        if latest_sha or latest_version:
            result = {'sha': latest_sha, 'version': latest_version}
            cache.set(cache_key, result, PLAYER_VERSION_CACHE_TTL)
            return result
        return {'sha': '', 'version': '', 'error': 'No tags found'}
    except Exception as e:
        logger.warning('Failed to check GHCR for player version: %s', e)
        return {'sha': '', 'error': str(e)}


def _safe_int(value, default, field_name='value'):
    """Parse an int from request data, returning default on None or raising 400 on bad input."""
    if value is None:
        return default
    try:
        return int(value)
    except (ValueError, TypeError):
        from rest_framework.exceptions import ValidationError
        raise ValidationError({field_name: f'Must be an integer, got: {value!r}'})


def _update_player_status(player, online, info=None):
    """Update player online status and last_status."""
    player.is_online = online
    player.last_seen = timezone.now() if online else player.last_seen
    if info:
        player.last_status = info
    player.save(update_fields=['is_online', 'last_seen', 'last_status'])


class _IsAdminOrCapableEditor(BasePermission):
    """Admin/superadmin always pass; editor passes only if an admin has
    opted this specific action's capability group back in via
    editor_capabilities.py — otherwise editors are limited to
    PlayerViewSet._CONTENT_ACTIONS."""

    def __init__(self, action):
        self.action = action

    def has_permission(self, request, view):
        role = _user_role(request.user)
        if role in ('admin', 'superadmin'):
            return True
        if role == 'editor':
            return action_allowed_for_editor(self.action)
        return False


class PlayerViewSet(viewsets.ModelViewSet):
    """ViewSet for managing Anthias players."""
    queryset = Player.objects.select_related('group').all()
    serializer_class = PlayerSerializer
    pagination_class = None
    permission_classes = [IsEditorOrReadOnly]

    def get_queryset(self):
        from access.scoping import filter_players
        return filter_players(super().get_queryset(), self.request.user)

    # Editors manage *content* on devices (assign/update/remove assets,
    # clone another device's content, skip/advance what's playing) —
    # everything about the device itself (adding/editing/removing the
    # device record, credentials, OS image, reboot/shutdown, branding)
    # is admin-only. Every other action either only reads (already
    # open to any authenticated user via IsEditorOrReadOnly's GET
    # passthrough) or is one of the content actions listed in
    # _CONTENT_ACTIONS below.
    _CONTENT_ACTIONS = (
        'asset_update', 'asset_delete', 'asset_create',
        'clone_content', 'playback_control',
    )

    # Every action below defaults to admin-only, but each maps to a
    # capability group in editor_capabilities.py that an admin can opt
    # back in for editors via Settings > Permissões — see
    # _IsAdminOrCapableEditor.
    _ADMIN_GATED_ACTIONS = (
        'create', 'update', 'partial_update', 'destroy',
        'test_connection', 'device_settings', 'reboot', 'shutdown',
        'screenshot_sidecar', 'push_branding', 'image_source',
        'migrate_image', 'rebuild_image', 'restore_image',
        'ssh_credentials', 'reveal_credentials', 'sso_login',
        'push_sso_secret', 'logo', 'standby', 'backup',
    )

    def get_permissions(self):
        if self.action in self._CONTENT_ACTIONS:
            return super().get_permissions()
        if self.action in self._ADMIN_GATED_ACTIONS:
            return [_IsAdminOrCapableEditor(self.action)]
        return super().get_permissions()

    def get_serializer_class(self):
        if self.action == 'list':
            return PlayerListSerializer
        return PlayerSerializer

    def _get_client(self, player):
        """Create an AnthiasAPIClient for the given player."""
        return AnthiasAPIClient(player)

    def perform_create(self, serializer):
        """After creating a player, try to connect and update status."""
        from history.logging import log_action
        player = serializer.save()
        log_action(self.request, 'create', 'player', target_id=player.id, target_name=player.name)
        client = self._get_client(player)
        try:
            info = client.get_info()
            _update_player_status(player, True, info)
        except Exception:
            _update_player_status(player, False)

    def perform_destroy(self, instance):
        from history.logging import log_action
        log_action(self.request, 'delete', 'player', target_id=instance.id, target_name=instance.name)
        instance.delete()

    @action(detail=True, methods=['post'], url_path='test-connection')
    def test_connection(self, request, pk=None):
        """Test connectivity to a player by calling its /v2/info endpoint."""
        player = self.get_object()
        client = self._get_client(player)
        try:
            info = client.get_info()
            _update_player_status(player, True, info)
            return Response({
                'success': True,
                'message': f'Successfully connected to {player.name}.',
                'info': info,
            })
        except PlayerConnectionError as exc:
            _update_player_status(player, False)
            return Response({
                'success': False,
                'message': str(exc),
            }, status=status.HTTP_502_BAD_GATEWAY)
        except Exception as exc:
            _update_player_status(player, False)
            logger.exception('Unexpected error testing connection to %s', player.name)
            return Response({
                'success': False,
                'message': f'Unexpected error: {exc}',
            }, status=status.HTTP_500_INTERNAL_SERVER_ERROR)

    @action(detail=True, methods=['get'])
    def info(self, request, pk=None):
        """Proxy to the player's /v2/info endpoint."""
        player = self.get_object()
        client = self._get_client(player)
        try:
            data = client.get_info()
            _update_player_status(player, True, data)
            return Response(data)
        except PlayerConnectionError as exc:
            _update_player_status(player, False)
            return Response(
                {'error': str(exc)},
                status=status.HTTP_502_BAD_GATEWAY,
            )

    @action(detail=True, methods=['get'])
    def assets(self, request, pk=None):
        """Proxy to the player's /v2/assets endpoint.

        Each asset is annotated with `playlist: {id, name}` when it was
        deployed as part of a playlist (via Playlist.deployed_assets),
        so the frontend can attribute it instead of just listing it loose.
        """
        player = self.get_object()
        client = self._get_client(player)
        try:
            data = client.get_assets()
        except PlayerConnectionError as exc:
            return Response(
                {'error': str(exc)},
                status=status.HTTP_502_BAD_GATEWAY,
            )

        from playlists.models import Playlist
        asset_to_playlist = {}
        for pl in Playlist.objects.filter(deployed_assets__has_key=str(player.id)):
            for asset_id in pl.deployed_assets.get(str(player.id), []):
                asset_to_playlist[str(asset_id)] = {'id': str(pl.id), 'name': pl.name}
        if isinstance(data, list):
            for asset in data:
                if isinstance(asset, dict) and asset.get('asset_id'):
                    asset['playlist'] = asset_to_playlist.get(str(asset['asset_id']))

        return Response(data)

    @action(detail=True, methods=['get', 'patch'], url_path='device-settings')
    def device_settings(self, request, pk=None):
        """Proxy to the player's /v2/device_settings endpoint."""
        player = self.get_object()
        client = self._get_client(player)
        try:
            if request.method == 'PATCH':
                data = client.update_device_settings(request.data)
                from history.logging import log_action
                log_action(request, 'update', 'device_settings', target_id=player.id, target_name=player.name, details=request.data)
            else:
                data = client.get_device_settings()
            self._sync_screen_rotation_cache(player, data)
            return Response(data)
        except PlayerConnectionError as exc:
            return Response(
                {'error': str(exc)},
                status=status.HTTP_502_BAD_GATEWAY,
            )

    def _sync_screen_rotation_cache(self, player, device_settings_data):
        """Keep Player.screen_rotation in sync with whatever the device
        actually reports/accepts, so the UI (device cards, screenshot
        preview) can show orientation without a live round-trip."""
        try:
            rotation = int(device_settings_data.get('screen_rotation'))
        except (TypeError, ValueError):
            return
        if rotation not in (0, 90, 180, 270):
            return
        if player.screen_rotation != rotation:
            player.screen_rotation = rotation
            player.save(update_fields=['screen_rotation'])

    @action(detail=True, methods=['post'])
    def reboot(self, request, pk=None):
        """Proxy to the player's /v2/reboot endpoint."""
        from history.logging import log_action
        player = self.get_object()
        client = self._get_client(player)
        try:
            client.reboot()
            log_action(request, 'reboot', 'player', target_id=player.id, target_name=player.name)
            return Response({
                'success': True,
                'message': f'Reboot command sent to {player.name}.',
            })
        except PlayerConnectionError as exc:
            return Response(
                {'error': str(exc)},
                status=status.HTTP_502_BAD_GATEWAY,
            )

    @action(detail=True, methods=['post'])
    def shutdown(self, request, pk=None):
        """Proxy to the player's /v2/shutdown endpoint."""
        from history.logging import log_action
        player = self.get_object()
        client = self._get_client(player)
        try:
            client.shutdown()
            log_action(request, 'shutdown', 'player', target_id=player.id, target_name=player.name)
            return Response({
                'success': True,
                'message': f'Shutdown command sent to {player.name}.',
            })
        except PlayerConnectionError as exc:
            return Response(
                {'error': str(exc)},
                status=status.HTTP_502_BAD_GATEWAY,
            )

    @action(detail=True, methods=['get'])
    def history(self, request, pk=None):
        """Get historical snapshots for a player."""
        player = self.get_object()
        limit = _safe_int(request.query_params.get('limit'), 100, 'limit')
        snapshots = player.snapshots.all()[:limit]
        serializer = PlayerSnapshotSerializer(snapshots, many=True)
        return Response(serializer.data)

    @action(detail=True, methods=['get'])
    def screenshot(self, request, pk=None):
        """Proxy to the player's /v2/screenshot endpoint. Returns PNG image."""
        player = self.get_object()
        client = self._get_client(player)
        try:
            image_data = client.get_screenshot()
            return HttpResponse(
                image_data,
                content_type='image/png',
            )
        except PlayerConnectionError as exc:
            logger.warning('Screenshot failed for %s: %s', player.name, exc)
            if exc.status_code == 404:
                # The player itself has no /v2/screenshot route — e.g. it's
                # running official Anthias instead of the fork this project
                # depends on for that endpoint (see docs/anthias-version-analysis.md).
                # Not a connectivity failure: distinguish it so the frontend
                # can show "unsupported" instead of a transient error.
                return Response(
                    {'error': str(exc), 'code': 'not_supported'},
                    status=status.HTTP_404_NOT_FOUND,
                )
            return Response(
                {'error': str(exc)},
                status=status.HTTP_502_BAD_GATEWAY,
            )
        except Exception as exc:
            logger.exception('Error getting screenshot from %s', player.name)
            return Response(
                {'error': f'Screenshot failed: {exc}'},
                status=status.HTTP_500_INTERNAL_SERVER_ERROR,
            )

    @action(detail=True, methods=['post'], url_path='screenshot-sidecar')
    def screenshot_sidecar(self, request, pk=None):
        """Capture a screenshot via a throwaway SSH/Docker sidecar, for
        official Anthias devices whose /v2/screenshot the fork-only
        endpoint doesn't exist. See players/screenshot_sidecar.py.

        ssh_user/ssh_password/ssh_port are optional if this device
        already has saved SSH credentials."""
        player = self.get_object()
        ssh_password = request.data.get('ssh_password') or (player.get_ssh_password() if player.has_ssh_credentials else '')
        if not ssh_password:
            return Response({'error': 'ssh_password is required'}, status=status.HTTP_400_BAD_REQUEST)
        ssh_user = request.data.get('ssh_user') or player.ssh_username or 'pi'
        ssh_port = _safe_int(request.data.get('ssh_port') or player.ssh_port, 22, 'ssh_port')

        from .screenshot_sidecar import ScreenshotSidecarError, capture_screenshot_via_sidecar
        try:
            image_data = capture_screenshot_via_sidecar(player, ssh_user, ssh_password, ssh_port)
        except ScreenshotSidecarError as exc:
            return Response({'error': str(exc)}, status=status.HTTP_502_BAD_GATEWAY)

        if request.data.get('save_credentials'):
            player.ssh_username = ssh_user
            player.set_ssh_password(ssh_password)
            player.ssh_port = ssh_port
            player.save(update_fields=['ssh_username', 'ssh_password_encrypted', 'ssh_port'])

        from history.logging import log_action
        log_action(request, 'screenshot_sidecar', 'player', target_id=player.id, target_name=player.name)
        return HttpResponse(image_data, content_type='image/png')

    @action(detail=True, methods=['post'], url_path='push-branding')
    def push_branding(self, request, pk=None):
        """SSH into the device once and push branding overrides: a custom
        splash-page logo and/or "no content" standby image (overriding the
        baked-in MupiTech defaults for this specific player/group/
        location), plus its identification chip data (location/group/
        name — cheap, always pushed alongside the logo).

        The purple-to-blue theme colors and Portuguese copy used to be
        pushed here too, but are now baked into the mupitech-player image
        itself (see players/branding.py's module docstring) — nothing left
        to push for those.

        ssh_user/ssh_password/ssh_port are optional if this device already
        has saved SSH credentials (see the ssh-credentials action) — those
        are used as a fallback so pushes don't require re-entering them
        every time."""
        player = self.get_object()
        ssh_password = request.data.get('ssh_password') or (player.get_ssh_password() if player.has_ssh_credentials else '')
        if not ssh_password:
            return Response({'error': 'ssh_password is required'}, status=status.HTTP_400_BAD_REQUEST)
        ssh_user = request.data.get('ssh_user') or player.ssh_username or 'pi'
        ssh_port = _safe_int(request.data.get('ssh_port') or player.ssh_port, 22, 'ssh_port')
        push_logo = request.data.get('push_logo', True)
        push_standby = request.data.get('push_standby', False)
        save_credentials = request.data.get('save_credentials', False)

        from .branding import (
            BrandingPushError, push_device_label_to_player, push_splash_logo_to_player,
            push_standby_image_to_player,
        )
        try:
            if push_logo:
                push_splash_logo_to_player(player, ssh_user, ssh_password, ssh_port)
                push_device_label_to_player(player, ssh_user, ssh_password, ssh_port)
            if push_standby:
                push_standby_image_to_player(player, ssh_user, ssh_password, ssh_port)
        except BrandingPushError as exc:
            return Response({'error': str(exc)}, status=status.HTTP_502_BAD_GATEWAY)

        if save_credentials:
            player.ssh_username = ssh_user
            player.set_ssh_password(ssh_password)
            player.ssh_port = ssh_port
            player.save(update_fields=['ssh_username', 'ssh_password_encrypted', 'ssh_port'])

        from history.logging import log_action
        log_action(
            request, 'push_branding', 'player', target_id=player.id, target_name=player.name,
            details={'logo': bool(push_logo), 'standby': bool(push_standby)},
        )
        return Response({'success': True})

    @action(detail=True, methods=['post'], url_path='image-source')
    def image_source(self, request, pk=None):
        """Read-only (POST only because it carries the SSH password in the
        body, not because it changes anything): SSH into the device and
        report which Anthias image it's currently running (our own
        mupitech-player build, the old third-party fork, unmodified
        official Anthias, or unrecognized). Used by the Fleet Manager UI
        to decide whether to offer the "migrate to MupiTech image" action."""
        player = self.get_object()
        ssh_password = request.data.get('ssh_password') or (player.get_ssh_password() if player.has_ssh_credentials else '')
        if not ssh_password:
            return Response({'error': 'ssh_password is required'}, status=status.HTTP_400_BAD_REQUEST)
        ssh_user = request.data.get('ssh_user') or player.ssh_username or 'pi'
        ssh_port = _safe_int(request.data.get('ssh_port') or player.ssh_port, 22, 'ssh_port')

        from .migrate_image import _MIGRATABLE_DEVICE_TYPES, MigrationError, discover_image_source
        try:
            source, image, has_backup = discover_image_source(player, ssh_user, ssh_password, ssh_port)
        except MigrationError as exc:
            return Response(
                {'error': str(exc), 'error_code': exc.code, 'error_params': exc.params},
                status=status.HTTP_502_BAD_GATEWAY,
            )
        return Response({
            'source': source, 'image': image, 'has_backup': has_backup,
            'can_migrate': player.device_type in _MIGRATABLE_DEVICE_TYPES and source != 'unknown',
        })

    @action(detail=True, methods=['post'], url_path='migrate-image')
    def migrate_image(self, request, pk=None):
        """Move an already-provisioned device onto a chosen image — our own
        MupiTech build (default) or genuinely unmodified official Anthias:
        the old third-party fork or whatever's currently running gets
        re-provisioned onto our compose template (previous compose file
        backed up as .bak first), pointed at the requested target's
        registry; a device already on the requested image just gets
        pulled/updated. See players/migrate_image.py."""
        player = self.get_object()
        ssh_password = request.data.get('ssh_password') or (player.get_ssh_password() if player.has_ssh_credentials else '')
        if not ssh_password:
            return Response({'error': 'ssh_password is required'}, status=status.HTTP_400_BAD_REQUEST)
        ssh_user = request.data.get('ssh_user') or player.ssh_username or 'pi'
        ssh_port = _safe_int(request.data.get('ssh_port') or player.ssh_port, 22, 'ssh_port')
        save_credentials = request.data.get('save_credentials', False)
        preserve_content = bool(request.data.get('preserve_content', False))
        target = request.data.get('target') or 'mupitech'

        from .migrate_image import MigrationError, migrate_player_to_target_image
        try:
            result = migrate_player_to_target_image(
                player, ssh_user, ssh_password, ssh_port, target=target, preserve_content=preserve_content,
            )
        except MigrationError as exc:
            return Response(
                {'error': str(exc), 'error_code': exc.code, 'error_params': exc.params},
                status=status.HTTP_502_BAD_GATEWAY,
            )

        if save_credentials:
            player.ssh_username = ssh_user
            player.set_ssh_password(ssh_password)
            player.ssh_port = ssh_port
            player.save(update_fields=['ssh_username', 'ssh_password_encrypted', 'ssh_port'])

        from history.logging import log_action
        log_action(
            request, 'migrate_image', 'player', target_id=player.id, target_name=player.name,
            details={
                'action': result['action'], 'previous_source': result['previous_source'],
                'previous_image': result['previous_image'],
                'content_restored': result.get('content_restored'),
            },
        )
        return Response({
            'success': True, 'action': result['action'],
            'previous_source': result['previous_source'], 'previous_image': result['previous_image'],
            'backup_path': result['backup_path'],
            'content_restored': result.get('content_restored'),
            'content_restore_failed': result.get('content_restore_failed'),
            'content_restore_error': result.get('content_restore_error'),
            'branding_pushed': result.get('branding_pushed'),
            'branding_failed': result.get('branding_failed'),
        })

    @action(detail=True, methods=['post'], url_path='rebuild-image')
    def rebuild_image(self, request, pk=None):
        """Wipe and reinstall a device's Docker/Anthias layer from
        scratch — every container, named volume and the host-side
        config/assets directories all get deleted, then a fresh compose
        file is rendered and started clean. A genuine factory reset for a
        device stuck in a bad state, not a lighter update/migrate. See
        players/migrate_image.py's rebuild_player."""
        player = self.get_object()
        ssh_password = request.data.get('ssh_password') or (player.get_ssh_password() if player.has_ssh_credentials else '')
        if not ssh_password:
            return Response({'error': 'ssh_password is required'}, status=status.HTTP_400_BAD_REQUEST)
        ssh_user = request.data.get('ssh_user') or player.ssh_username or 'pi'
        ssh_port = _safe_int(request.data.get('ssh_port') or player.ssh_port, 22, 'ssh_port')
        save_credentials = request.data.get('save_credentials', False)
        preserve_content = bool(request.data.get('preserve_content', False))

        from .migrate_image import MigrationError, rebuild_player
        try:
            result = rebuild_player(
                player, ssh_user, ssh_password, ssh_port, preserve_content=preserve_content,
            )
        except MigrationError as exc:
            return Response(
                {'error': str(exc), 'error_code': exc.code, 'error_params': exc.params},
                status=status.HTTP_502_BAD_GATEWAY,
            )

        if save_credentials:
            player.ssh_username = ssh_user
            player.set_ssh_password(ssh_password)
            player.ssh_port = ssh_port
            player.save(update_fields=['ssh_username', 'ssh_password_encrypted', 'ssh_port'])

        from history.logging import log_action
        log_action(
            request, 'rebuild_image', 'player', target_id=player.id, target_name=player.name,
            details={'content_restored': result.get('content_restored')},
        )
        return Response({
            'success': True, 'action': result['action'], 'backup_path': result['backup_path'],
            'content_restored': result.get('content_restored'),
            'content_restore_failed': result.get('content_restore_failed'),
            'content_restore_error': result.get('content_restore_error'),
            'branding_pushed': result.get('branding_pushed'),
            'branding_failed': result.get('branding_failed'),
        })

    @action(detail=True, methods=['post'], url_path='restore-image')
    def restore_image(self, request, pk=None):
        """Roll a device back to the compose file it had before its last
        migration to the MupiTech image, using the .bak backup that
        migrate-image left behind. Fails clearly if there's no backup."""
        player = self.get_object()
        ssh_password = request.data.get('ssh_password') or (player.get_ssh_password() if player.has_ssh_credentials else '')
        if not ssh_password:
            return Response({'error': 'ssh_password is required'}, status=status.HTTP_400_BAD_REQUEST)
        ssh_user = request.data.get('ssh_user') or player.ssh_username or 'pi'
        ssh_port = _safe_int(request.data.get('ssh_port') or player.ssh_port, 22, 'ssh_port')

        from .migrate_image import MigrationError, restore_previous_compose
        try:
            result = restore_previous_compose(player, ssh_user, ssh_password, ssh_port)
        except MigrationError as exc:
            return Response(
                {'error': str(exc), 'error_code': exc.code, 'error_params': exc.params},
                status=status.HTTP_502_BAD_GATEWAY,
            )

        from history.logging import log_action
        log_action(
            request, 'restore_image', 'player', target_id=player.id, target_name=player.name,
            details={'backup_path': result['backup_path']},
        )
        return Response({'success': True, 'backup_path': result['backup_path']})

    @action(detail=True, methods=['post'], url_path='clone-content')
    def clone_content(self, request, pk=None):
        """Copy another device's current asset list onto this one — e.g. a
        newly-added device in a location that should show the same content
        as its siblings. Reuses the same snapshot/restore helpers as the
        image-migration "preserve content" option (players/migrate_image.py),
        just between two different devices instead of before/after
        migrating the same one. Both devices need to be online (it works
        purely over their own v2 REST API, no SSH involved)."""
        target = self.get_object()
        source_id = request.data.get('source_player_id')
        if not source_id:
            return Response({'error': 'source_player_id is required'}, status=status.HTTP_400_BAD_REQUEST)
        if str(source_id) == str(target.id):
            return Response({'error': 'Source and target must be different devices.'}, status=status.HTTP_400_BAD_REQUEST)
        try:
            source = Player.objects.get(pk=source_id)
        except Player.DoesNotExist:
            return Response({'error': 'Source device not found.'}, status=status.HTTP_404_NOT_FOUND)

        from .migrate_image import snapshot_assets, restore_assets
        snapshot = snapshot_assets(source)
        if snapshot is None:
            return Response(
                {'error': f"Could not read {source.name}'s current content — is it online?"},
                status=status.HTTP_502_BAD_GATEWAY,
            )
        if not snapshot:
            return Response({'success': True, 'restored': 0, 'failed': []})

        restored, failed = restore_assets(target, snapshot)

        from history.logging import log_action
        log_action(
            request, 'clone_content', 'player', target_id=target.id, target_name=target.name,
            details={'source_player_id': str(source.id), 'source_player_name': source.name,
                     'restored': restored, 'failed': failed},
        )
        return Response({'success': True, 'restored': restored, 'failed': failed})

    @action(detail=True, methods=['post', 'delete'], url_path='ssh-credentials')
    def ssh_credentials(self, request, pk=None):
        """Save or clear this device's SSH login, used as a fallback for
        branding pushes and other SSH-based actions so they don't need to
        be re-entered every time. The password is stored encrypted and
        never returned by the API."""
        player = self.get_object()
        if request.method == 'DELETE':
            player.ssh_username = ''
            player.ssh_password_encrypted = ''
            player.ssh_port = 22
            player.save(update_fields=['ssh_username', 'ssh_password_encrypted', 'ssh_port'])
            return Response(status=204)

        ssh_user = request.data.get('ssh_user')
        ssh_password = request.data.get('ssh_password')
        if not ssh_user or not ssh_password:
            return Response({'error': 'ssh_user and ssh_password are required'}, status=400)
        ssh_port = _safe_int(request.data.get('ssh_port'), 22, 'ssh_port')

        player.ssh_username = ssh_user
        player.set_ssh_password(ssh_password)
        player.ssh_port = ssh_port
        player.save(update_fields=['ssh_username', 'ssh_password_encrypted', 'ssh_port'])

        from history.logging import log_action
        log_action(request, 'save_ssh_credentials', 'player', target_id=player.id, target_name=player.name)
        return Response({'success': True, 'has_ssh_credentials': True, 'ssh_username': ssh_user, 'ssh_port': ssh_port})

    @action(detail=True, methods=['post'], url_path='reveal-credentials')
    def reveal_credentials(self, request, pk=None):
        """Admin-only by default (opt-in for editors via the `credentials`
        capability — see editor_capabilities.py): decrypt and return this
        device's local dashboard login (Player.username/password — already
        the system-of-record credential used by services.py for API calls
        to the device, and the fallback login when SSO/the device can't
        reach the Fleet Manager). Nobody else can read this in cleartext:
        PlayerSerializer keeps `password` write_only, so this action is the
        only reveal path — gated via get_permissions() above, and further
        requires the requesting user's own current password, since exposing
        another party's stored secret is sensitive even for an admin."""
        player = self.get_object()
        if not request.user.check_password(request.data.get('password', '')):
            return Response({'error': 'Incorrect password.'}, status=400)
        if not player.username or not player.password:
            return Response({'error': 'No credentials stored for this device.'}, status=404)

        from history.logging import log_action
        log_action(request, 'reveal_credentials', 'player', target_id=player.id, target_name=player.name)
        return Response({'username': player.username, 'password': player.get_password()})

    @action(detail=True, methods=['post'], url_path='sso-login')
    def sso_login(self, request, pk=None):
        """Admin-only: mint a one-time login URL for this device's own
        local dashboard, scoped to (this player, the requesting admin)
        and valid for 60s — see players/sso.py. 404s if the device
        hasn't been provisioned with an SSO secret yet (push-sso-secret
        below)."""
        from .sso import build_sso_login_url

        player = self.get_object()
        if not player.sso_enabled:
            return Response(
                {'error': 'SSO login has been disabled for this device.'}, status=403,
            )
        url = build_sso_login_url(player, request.user)
        if not url:
            return Response(
                {'error': 'SSO has not been set up for this device yet.'}, status=404,
            )

        from history.logging import log_action
        log_action(request, 'sso_login', 'player', target_id=player.id, target_name=player.name)
        return Response({'url': url})

    @action(detail=True, methods=['post'], url_path='push-sso-secret')
    def push_sso_secret(self, request, pk=None):
        """Admin-only: (re)provision this device with an SSO secret over
        SSH, generating one first if it doesn't have one yet. Same SSH
        credential conventions as rebuild-image/ssh-credentials — an
        explicit password in the request, or the player's saved one."""
        from .sso import SSOPushError, push_sso_secret_to_player

        player = self.get_object()
        ssh_password = request.data.get('ssh_password') or (player.get_ssh_password() if player.has_ssh_credentials else '')
        if not ssh_password:
            return Response({'error': 'ssh_password is required'}, status=400)
        ssh_user = request.data.get('ssh_user') or player.ssh_username or 'pi'
        ssh_port = _safe_int(request.data.get('ssh_port') or player.ssh_port, 22, 'ssh_port')

        try:
            push_sso_secret_to_player(
                player, ssh_user, ssh_password, ssh_port,
                fm_base_url=request.build_absolute_uri('/'),
            )
        except SSOPushError as exc:
            return Response({'error': str(exc)}, status=502)

        from history.logging import log_action
        log_action(request, 'push_sso_secret', 'player', target_id=player.id, target_name=player.name)
        return Response({'success': True})

    @action(detail=True, methods=['post', 'delete'], url_path='logo')
    def logo(self, request, pk=None):
        """Upload or remove this device's own splash logo override."""
        player = self.get_object()
        from .branding import save_logo_upload

        if request.method == 'DELETE':
            if player.splash_logo:
                player.splash_logo.delete(save=True)
            return Response(status=204)

        file = request.FILES.get('logo')
        if not file:
            return Response({'error': 'logo file is required'}, status=400)
        try:
            save_logo_upload(player, file)
        except ValueError as exc:
            return Response({'error': str(exc)}, status=400)
        return Response({'success': True, 'logo_url': player.splash_logo.url})

    @action(detail=True, methods=['post', 'delete'], url_path='standby')
    def standby(self, request, pk=None):
        """Upload or remove this device's own standby image override."""
        player = self.get_object()
        from .branding import save_standby_upload

        if request.method == 'DELETE':
            if player.standby_image:
                player.standby_image.delete(save=True)
            return Response(status=204)

        file = request.FILES.get('standby')
        if not file:
            return Response({'error': 'standby file is required'}, status=400)
        try:
            save_standby_upload(player, file)
        except ValueError as exc:
            return Response({'error': str(exc)}, status=400)
        return Response({'success': True, 'standby_url': player.standby_image.url})

    @action(detail=True, methods=['post'], url_path='playback-control')
    def playback_control(self, request, pk=None):
        """Control playback on the player (next/previous)."""
        player = self.get_object()
        client = self._get_client(player)
        command = request.data.get('command')
        if command not in ('next', 'previous'):
            return Response(
                {'error': 'command must be "next" or "previous"'},
                status=status.HTTP_400_BAD_REQUEST,
            )
        try:
            client.control_asset(command)
            return Response({'success': True, 'command': command})
        except PlayerConnectionError as exc:
            return Response(
                {'error': str(exc)},
                status=status.HTTP_502_BAD_GATEWAY,
            )

    @action(detail=True, methods=['get'], url_path='now-playing')
    def now_playing(self, request, pk=None):
        """Return the most recent 'started' playback entry for this player."""
        from history.models import PlaybackLog

        player = self.get_object()
        entry = PlaybackLog.objects.filter(
            player=player, event='started',
        ).order_by('-timestamp').first()
        if not entry:
            return Response(None)
        return Response({
            'asset_id': entry.asset_id,
            'asset_name': entry.asset_name,
            'mimetype': entry.mimetype,
            'started_at': entry.timestamp.isoformat(),
        })

    @action(detail=True, methods=['post'])
    def backup(self, request, pk=None):
        """Proxy to the player's /v2/backup endpoint."""
        player = self.get_object()
        client = self._get_client(player)
        try:
            data = client.create_backup()
            return Response({
                'success': True,
                'message': f'Backup created for {player.name}.',
                'data': data,
            })
        except PlayerConnectionError as exc:
            return Response(
                {'error': str(exc)},
                status=status.HTTP_502_BAD_GATEWAY,
            )

    @action(detail=True, methods=['patch'], url_path='asset-update')
    def asset_update(self, request, pk=None):
        """Update an asset on the player."""
        player = self.get_object()
        client = self._get_client(player)
        asset_id = request.data.get('asset_id')
        if not asset_id:
            return Response(
                {'error': 'asset_id is required'},
                status=status.HTTP_400_BAD_REQUEST,
            )
        update_fields = {}
        for field in ('name', 'start_date', 'end_date'):
            if field in request.data:
                update_fields[field] = request.data[field]
        if 'duration' in request.data:
            update_fields['duration'] = _safe_int(request.data['duration'], 0, 'duration')
        if 'is_enabled' in request.data:
            val = request.data['is_enabled']
            update_fields['is_enabled'] = bool(_safe_int(val, 0, 'is_enabled')) if not isinstance(val, bool) else val
        if 'nocache' in request.data:
            val = request.data['nocache']
            update_fields['nocache'] = bool(_safe_int(val, 0, 'nocache')) if not isinstance(val, bool) else val
        # Recurring weekly schedule (day-of-week + time-of-day window) —
        # fields on the asset itself in current official Anthias, not a
        # separate "schedule slot" resource. The player's own API
        # validates the values (e.g. play_days must be non-empty,
        # play_time_from/to must be set together); this just forwards
        # whatever was provided.
        for field in ('play_days', 'play_time_from', 'play_time_to'):
            if field in request.data:
                update_fields[field] = request.data[field]
        try:
            data = client.update_asset(asset_id, update_fields)
            from history.logging import log_action
            log_action(request, 'update', 'asset', target_id=asset_id, target_name=player.name, details=update_fields)
            return Response({'success': True, 'asset': data})
        except PlayerConnectionError as exc:
            return Response(
                {'error': str(exc)},
                status=status.HTTP_502_BAD_GATEWAY,
            )
        except Exception as exc:
            logger.exception('Error updating asset on %s', player.name)
            return Response(
                {'error': f'Update failed: {exc}'},
                status=status.HTTP_500_INTERNAL_SERVER_ERROR,
            )

    @action(detail=True, methods=['post'], url_path='asset-delete')
    def asset_delete(self, request, pk=None):
        """Delete an asset from the player."""
        player = self.get_object()
        client = self._get_client(player)
        asset_id = request.data.get('asset_id')
        if not asset_id:
            return Response(
                {'error': 'asset_id is required'},
                status=status.HTTP_400_BAD_REQUEST,
            )
        try:
            client.delete_asset(asset_id)
            from history.logging import log_action
            log_action(request, 'delete', 'asset', target_id=asset_id, target_name=player.name)
            return Response({'success': True})
        except PlayerConnectionError as exc:
            return Response(
                {'error': str(exc)},
                status=status.HTTP_502_BAD_GATEWAY,
            )
        except Exception as exc:
            logger.exception('Error deleting asset on %s', player.name)
            return Response(
                {'error': f'Delete failed: {exc}'},
                status=status.HTTP_500_INTERNAL_SERVER_ERROR,
            )

    @action(detail=True, methods=['post'], url_path='asset-create')
    def asset_create(self, request, pk=None):
        """Create a new asset on the player."""
        player = self.get_object()
        client = self._get_client(player)
        required = ('name', 'uri', 'start_date', 'end_date', 'duration', 'mimetype')
        asset_data = {k: request.data.get(k) for k in required if request.data.get(k) is not None}
        if 'is_enabled' in request.data:
            asset_data['is_enabled'] = request.data['is_enabled']
        try:
            data = client.create_asset(asset_data)
            from history.logging import log_action
            log_action(request, 'create', 'asset', target_id=data.get('asset_id', ''), target_name=f"{player.name}: {asset_data.get('name', '')}")
            return Response({'success': True, 'asset': data})
        except PlayerConnectionError as exc:
            return Response(
                {'error': str(exc)},
                status=status.HTTP_502_BAD_GATEWAY,
            )
        except Exception as exc:
            logger.exception('Error creating asset on %s', player.name)
            return Response(
                {'error': f'Create failed: {exc}'},
                status=status.HTTP_500_INTERNAL_SERVER_ERROR,
            )

    @action(detail=True, methods=['post'], url_path='asset-upload')
    def asset_upload(self, request, pk=None):
        """Upload a MediaFile to the player as an asset."""
        player = self.get_object()
        media_file_id = request.data.get('media_file_id')
        if not media_file_id:
            return Response(
                {'error': 'media_file_id is required'},
                status=status.HTTP_400_BAD_REQUEST,
            )
        try:
            media_file = MediaFile.objects.get(pk=media_file_id)
        except MediaFile.DoesNotExist:
            return Response(
                {'error': 'MediaFile not found'},
                status=status.HTTP_404_NOT_FOUND,
            )

        name = request.data.get('name', media_file.name)
        duration = _safe_int(request.data.get('duration'), 10, 'duration')
        start_date = request.data.get('start_date') or None
        end_date = request.data.get('end_date') or None

        try:
            data = deploy_media_file_to_player(
                player, media_file, name=name, duration=duration,
                start_date=start_date, end_date=end_date,
                base_url=f'{request.scheme}://{request.get_host()}',
            )

            from history.logging import log_action
            log_action(request, 'deploy', 'asset', target_id=str(media_file.id), target_name=f"{player.name}: {name}")
            return Response({'success': True, 'asset': data})
        except PlayerConnectionError as exc:
            return Response(
                {'error': str(exc)},
                status=status.HTTP_502_BAD_GATEWAY,
            )
        except Exception as exc:
            logger.exception('Error uploading asset to %s', player.name)
            return Response(
                {'error': f'Upload failed: {exc}'},
                status=status.HTTP_500_INTERNAL_SERVER_ERROR,
            )

    @action(detail=True, methods=['get'], url_path=r'asset-content/(?P<asset_id>[^/.]+)')
    def asset_content(self, request, pk=None, asset_id=None):
        """Proxy asset content from the player (images, videos)."""
        import mimetypes

        player = self.get_object()
        client = self._get_client(player)
        url = f'{client.base_url}/api/v2/assets/{asset_id}/content'
        try:
            # Get asset info to determine correct content type
            asset_resp = client._request('GET', f'/api/v2/assets/{asset_id}')
            asset_info = asset_resp.json()
            uri = asset_info.get('uri', '')
            mimetype = asset_info.get('mimetype', '')

            # Determine content type from URI extension or asset mimetype
            guessed, _ = mimetypes.guess_type(uri)
            if guessed:
                content_type = guessed
            elif mimetype == 'image':
                content_type = 'image/jpeg'
            elif mimetype == 'video':
                content_type = 'video/mp4'
            else:
                content_type = 'application/octet-stream'

            kwargs = {'timeout': 30, 'stream': True}
            if client.auth:
                kwargs['auth'] = client.auth
            resp = http_requests.get(url, **kwargs)
            resp.raise_for_status()
            response = StreamingHttpResponse(
                resp.iter_content(chunk_size=8192),
                content_type=content_type,
            )
            if 'Content-Length' in resp.headers:
                response['Content-Length'] = resp.headers['Content-Length']
            response['Cache-Control'] = 'public, max-age=3600'
            return response
        except Exception:
            return Response(
                {'error': 'Content unavailable'},
                status=status.HTTP_502_BAD_GATEWAY,
            )


    # ── Player Update actions ──

    @action(detail=True, methods=['get'], url_path='update-check')
    def update_check(self, request, pk=None):
        """Check if a player update is available by comparing SHAs."""
        player = self.get_object()
        client = self._get_client(player)
        try:
            info = client.get_info()
            _update_player_status(player, True, info)
        except PlayerConnectionError as exc:
            _update_player_status(player, False)
            return Response(
                {'error': str(exc)},
                status=status.HTTP_502_BAD_GATEWAY,
            )

        current_version = info.get('anthias_version', 'unknown')
        # Parse "v1.0.0@c313f81" → version="v1.0.0", sha="c313f81"
        parts = current_version.split('@')
        current_ver_label = parts[0] if len(parts) > 1 else ''
        current_sha = parts[-1] if '@' in current_version else ''

        # Select tag suffix based on player device_type
        dt = player.device_type if player.device_type in ('pi4', 'pi5', 'x86') else 'pi4'
        latest = _get_latest_player_version(device_type=dt)
        latest_sha = latest.get('sha', '')
        latest_version = latest.get('version', '')

        # Compare by SHA first (most reliable), fall back to version label
        if current_sha and latest_sha:
            update_available = current_sha != latest_sha
        elif current_ver_label and latest_version:
            update_available = current_ver_label != latest_version
        else:
            update_available = False

        return Response({
            'current_version': current_version,
            'current_sha': current_sha,
            'latest_sha': latest_sha,
            'latest_version': latest_version,
            'update_available': update_available,
            'error': latest.get('error'),
        })

    @action(detail=True, methods=['post'], url_path='update')
    def trigger_update(self, request, pk=None):
        """Trigger Watchtower update on the player."""
        player = self.get_object()
        client = self._get_client(player)
        try:
            result = client.trigger_update()
            from history.logging import log_action
            log_action(request, 'trigger_update', 'player', target_id=player.id, target_name=player.name)
            return Response(result)
        except PlayerConnectionError as exc:
            return Response(
                {'error': str(exc)},
                status=status.HTTP_502_BAD_GATEWAY,
            )


    # ── CEC TV control ──

    @action(detail=True, methods=['get'], url_path='cec-status')
    def cec_status(self, request, pk=None):
        """Get CEC availability and TV power state from the player."""
        player = self.get_object()
        client = self._get_client(player)
        try:
            return Response(client.get_cec_status())
        except PlayerConnectionError as exc:
            return Response(
                {'error': str(exc)},
                status=status.HTTP_502_BAD_GATEWAY,
            )

    @action(detail=True, methods=['post'], url_path='cec-standby')
    def cec_standby(self, request, pk=None):
        """Send TV to standby via HDMI-CEC."""
        player = self.get_object()
        client = self._get_client(player)
        try:
            result = client.cec_standby()
            from history.logging import log_action
            log_action(request, 'cec_standby', 'player', target_id=player.id, target_name=player.name)
            return Response(result)
        except PlayerConnectionError as exc:
            return Response(
                {'error': str(exc)},
                status=status.HTTP_502_BAD_GATEWAY,
            )

    @action(detail=True, methods=['post'], url_path='cec-wake')
    def cec_wake(self, request, pk=None):
        """Wake TV via HDMI-CEC."""
        from history.logging import log_action
        player = self.get_object()
        client = self._get_client(player)
        try:
            result = client.cec_wake()
            log_action(request, 'cec_wake', 'player', target_id=player.id, target_name=player.name)
            return Response(result)
        except PlayerConnectionError as exc:
            return Response(
                {'error': str(exc)},
                status=status.HTTP_502_BAD_GATEWAY,
            )


    # ── IR remote control ──

    @action(detail=True, methods=['get'], url_path='ir-status')
    def ir_status(self, request, pk=None):
        """Get IR hardware availability from the player."""
        player = self.get_object()
        client = self._get_client(player)
        try:
            return Response(client.get_ir_status())
        except PlayerConnectionError as exc:
            return Response(
                {'error': str(exc)},
                status=status.HTTP_502_BAD_GATEWAY,
            )

    @action(detail=True, methods=['post'], url_path='ir-test')
    def ir_test(self, request, pk=None):
        """Send a test IR power code to the player."""
        player = self.get_object()
        client = self._get_client(player)
        protocol = request.data.get('protocol', '')
        scancode = request.data.get('scancode', '')
        if not protocol or not scancode:
            return Response(
                {'error': 'protocol and scancode are required'},
                status=status.HTTP_400_BAD_REQUEST,
            )
        try:
            result = client.ir_test(protocol, scancode)
            from history.logging import log_action
            log_action(
                request, 'ir_test', 'player',
                target_id=player.id, target_name=player.name,
                details={'protocol': protocol, 'scancode': scancode},
            )
            return Response(result)
        except PlayerConnectionError as exc:
            msg, http_status = format_player_error(exc)
            return Response({'error': msg, 'success': False}, status=http_status)


class BulkActionView(APIView):
    """
    Handle bulk actions across multiple players.

    POST /api/bulk/reboot/   - Reboot multiple players.
    POST /api/bulk/shutdown/ - Shut down multiple players.
    """

    def get_permissions(self):
        # Same admin-or-capable-editor gate as the single-device
        # reboot/shutdown actions on PlayerViewSet (power_control
        # capability) — a bulk action shouldn't be reachable by editors
        # when the equivalent single-device action isn't.
        return [_IsAdminOrCapableEditor(self.kwargs.get('action', ''))]

    def _execute_bulk_action(self, action_name, player_ids):
        """
        Execute a given action on multiple players.

        Args:
            action_name: The method name on AnthiasAPIClient to call.
            player_ids: List of player UUID strings.

        Returns:
            dict with results per player.
        """
        players = Player.objects.filter(id__in=player_ids)
        results = {}

        for player in players:
            client = AnthiasAPIClient(player)
            try:
                getattr(client, action_name)()
                results[str(player.id)] = {
                    'success': True,
                    'name': player.name,
                    'message': f'{action_name.capitalize()} command sent.',
                }
            except PlayerConnectionError as exc:
                results[str(player.id)] = {
                    'success': False,
                    'name': player.name,
                    'message': str(exc),
                }
            except Exception as exc:
                logger.exception(
                    'Error executing %s on player %s', action_name, player.name,
                )
                results[str(player.id)] = {
                    'success': False,
                    'name': player.name,
                    'message': f'Unexpected error: {exc}',
                }

        return results

    def post(self, request, action):
        """
        Handle bulk action requests.

        Expects JSON body: {"player_ids": ["uuid1", "uuid2", ...]}
        URL captures `action` which must be 'reboot' or 'shutdown'.
        """
        valid_actions = ('reboot', 'shutdown')
        if action not in valid_actions:
            return Response(
                {'error': f'Invalid action. Must be one of: {", ".join(valid_actions)}'},
                status=status.HTTP_400_BAD_REQUEST,
            )

        player_ids = request.data.get('player_ids', [])
        if not player_ids:
            return Response(
                {'error': 'player_ids is required and must be a non-empty list.'},
                status=status.HTTP_400_BAD_REQUEST,
            )

        results = self._execute_bulk_action(action, player_ids)
        from history.logging import log_action
        success_count = sum(1 for r in results.values() if r.get('success'))
        log_action(request, f'bulk_{action}', 'player', details={'count': len(player_ids), 'success': success_count})
        return Response({'results': results})


INVALID_MAC = 'Unable to retrieve MAC address.'


def _normalize_mac(raw):
    """Lowercase + strip a MAC address; return '' if invalid/placeholder."""
    if not raw or not isinstance(raw, str):
        return ''
    mac = raw.strip().lower()
    if mac == INVALID_MAC.lower() or len(mac) != 17:
        return ''
    return mac


@api_view(['POST'])
@permission_classes([AllowAny])
def register_player(request):
    """Phone-home endpoint: players POST here periodically to register/heartbeat."""
    token = getattr(settings, 'PLAYER_REGISTER_TOKEN', '')
    if token:
        auth_header = request.META.get('HTTP_AUTHORIZATION', '')
        if auth_header != f'Bearer {token}':
            return Response(
                {'error': 'Invalid or missing registration token'},
                status=status.HTTP_403_FORBIDDEN,
            )

    url = (request.data.get('url') or '').rstrip('/')
    name = request.data.get('name') or 'Unknown'
    info = request.data.get('info') or {}
    tailscale_ip = request.data.get('tailscale_ip') or None

    # Extract MAC: from top-level field (phone-home script) or from info dict
    mac_address = _normalize_mac(request.data.get('mac_address'))
    if not mac_address and isinstance(info, dict):
        mac_address = _normalize_mac(info.get('mac_address'))

    # Auto-detect Tailscale IP from URL if not explicitly provided
    if not tailscale_ip:
        from players.serializers import _extract_tailscale_ip
        tailscale_ip = _extract_tailscale_ip(url)

    if not url:
        return Response(
            {'error': 'url is required'},
            status=status.HTTP_400_BAD_REQUEST,
        )

    now = timezone.now()
    update_fields = ['is_online', 'last_seen', 'last_status',
                     'tailscale_ip', 'tailscale_enabled']

    # --- MAC-based lookup (stable identity) ---
    player = None
    created = False

    if mac_address:
        player = Player.objects.filter(mac_address=mac_address).first()
        if player:
            # Always clear out any OTHER row already sitting at this
            # URL (checking both the normalized form and its trailing-
            # slash variant) — not just when this player's own url is
            # changing. A stale duplicate at the same address (e.g. a
            # row predating url normalization, or created via a path
            # that bypassed Player.save()'s strip) has a url that never
            # "changes" from this MAC-matched player's point of view,
            # so the old change-gated cleanup never ran for it.
            Player.objects.filter(
                url__in=[url, f'{url}/'],
            ).exclude(pk=player.pk).delete()
            if player.url != url:
                player.url = url
                update_fields.append('url')
            player.is_online = True
            player.last_seen = now
            player.last_status = info
            if tailscale_ip:
                player.tailscale_ip = tailscale_ip
                player.tailscale_enabled = True
            player.save(update_fields=update_fields)
            logger.info('Player %s identified by MAC %s (url=%s)', player.name, mac_address, url)

    # --- Fallback: URL-based lookup (old mechanism) ---
    if player is None:
        defaults = {
            'name': name,
            'is_online': True,
            'last_seen': now,
            'last_status': info,
            'auto_registered': True,
        }
        if mac_address:
            defaults['mac_address'] = mac_address
        if tailscale_ip:
            defaults['tailscale_ip'] = tailscale_ip
            defaults['tailscale_enabled'] = True
        try:
            # Check both the normalized url and its trailing-slash
            # variant before creating — same reasoning as the MAC
            # branch above: an existing row may not be normalized yet.
            player = Player.objects.filter(url__in=[url, f'{url}/']).first()
            created = False
            if player is None:
                player = Player.objects.create(url=url, **defaults)
                created = True
            if not created:
                player.is_online = True
                player.last_seen = now
                player.last_status = info
                if mac_address and not player.mac_address:
                    player.mac_address = mac_address
                    update_fields.append('mac_address')
                if tailscale_ip:
                    player.tailscale_ip = tailscale_ip
                    player.tailscale_enabled = True
                player.save(update_fields=update_fields)
        except IntegrityError:
            # Concurrent create hit unique(url) — retry as update
            player = Player.objects.filter(url=url).first()
            if player:
                player.is_online = True
                player.last_seen = now
                player.last_status = info
                player.save(update_fields=['is_online', 'last_seen', 'last_status'])
                created = False
            else:
                return Response(
                    {'error': 'Registration conflict, please retry'},
                    status=status.HTTP_409_CONFLICT,
                )

    # Auto-detect device_type from info payload
    if isinstance(info, dict) and player.device_type in ('unknown', ''):
        device_model = info.get('device_model', '')
        device_type_env = info.get('device_type', '')
        if 'Raspberry Pi 5' in device_model or 'Compute Module 5' in device_model or device_type_env == 'pi5':
            player.device_type = 'pi5'
            player.save(update_fields=['device_type'])
        elif 'Raspberry Pi 4' in device_model or 'Compute Module 4' in device_model or device_type_env == 'pi4':
            player.device_type = 'pi4'
            player.save(update_fields=['device_type'])
        elif device_type_env == 'x86':
            # Unlike the Pi cases above, x86's device_model text isn't
            # reliably pattern-matchable (real vendor/CPU string, or a
            # generic fallback) — the player's own /api/v2/info sends
            # an explicit device_type='x86' hint instead (see
            # anthias_server/api/views/v2.py::InfoViewV2.get_device_type
            # in the mupitech-player repo). Older player builds that
            # predate this hint just keep phoning home as 'unknown'
            # until someone opens that device's Settings > Access tab,
            # which already runs the same SSH-based arch detection.
            player.device_type = 'x86'
            player.save(update_fields=['device_type'])

    # Set default SSH credentials if not yet configured
    if not player.username and not player.password:
        ssh_user = request.data.get('ssh_user') or info.get('host_user') or 'pi'
        player.username = ssh_user
        player.set_password('258456')
        player.save(update_fields=['username', 'password'])

    if created:
        return Response({'status': 'created', 'id': str(player.id)}, status=status.HTTP_201_CREATED)
    return Response({'status': 'updated', 'id': str(player.id)}, status=status.HTTP_200_OK)


@api_view(['GET'])
@permission_classes([AllowAny])
def install_phonehome(request):
    """Return a bash script that installs the phone-home systemd timer on a player."""
    import re as _re
    from urllib.parse import urlparse as _urlparse

    server = request.query_params.get('server', '').rstrip('/')
    if not server:
        return Response(
            {'error': 'server query parameter is required'},
            status=status.HTTP_400_BAD_REQUEST,
        )

    # Validate: must be a proper HTTP(S) URL with no shell metacharacters
    try:
        parsed = _urlparse(server)
        if parsed.scheme not in ('http', 'https') or not parsed.hostname:
            raise ValueError('bad scheme or host')
    except Exception:
        return Response(
            {'error': 'server must be a valid http(s) URL'},
            status=status.HTTP_400_BAD_REQUEST,
        )
    # Reject any characters that could break out of a shell double-quoted string
    if not _re.match(r'^https?://[A-Za-z0-9._:/@\[\]\-]+$', server):
        return Response(
            {'error': 'server URL contains disallowed characters'},
            status=status.HTTP_400_BAD_REQUEST,
        )

    token = getattr(settings, 'PLAYER_REGISTER_TOKEN', '')
    auth_header_line = ''
    if token:
        auth_header_line = f'\n  -H "Authorization: Bearer {token}" \\'

    script = f'''#!/bin/bash
set -e

SERVER="{server}"

# Create phone-home script
cat > /usr/local/bin/anthias-phonehome.sh << 'SCRIPT'
#!/bin/bash
SERVER="{server}"
NAME="$(hostname)"
INFO=$(curl -sf http://localhost/api/v2/info 2>/dev/null || echo '{{}}')
# /api/v2/info requires a login when the device has local auth enabled
# (auth_backend set) — this unauthenticated local curl then gets a 302
# to /login/ instead of a 4xx/5xx, which `curl -f` does NOT treat as a
# failure (only >=400 is), so it exits 0 with an empty body instead of
# falling through to the '{{}}' default above. Left unguarded, that
# empty $INFO produces `"info":` with no value in the JSON built below
# — invalid JSON, so the Fleet Manager's own /api/players/register/
# call rejects the whole heartbeat with a parse error. System stats
# just won't populate via phone-home on such a device (view them from
# its own dashboard once logged in, or via the SSH-based checks
# elsewhere) — that's an accepted gap, but the heartbeat itself must
# not break because of it.
case "$INFO" in
  '{{'*) ;;
  *) INFO='{{}}' ;;
esac

# Resolve the LAN-facing interface once (whichever owns the default
# route) and derive both the reported URL's IP and the MAC from it —
# covers any interface naming scheme (systemd predictable names like
# ens18/enp1s0 on VMs, eth0/end0 on Pis, wlan0, etc.) instead of a
# hardcoded allowlist that found nothing on non-eth0-named hardware.
# Deriving the IP this way (instead of `hostname -I`'s first token,
# whose order isn't guaranteed and can shift once Docker creates its
# own bridge networks — docker0, compose bridges — ahead of the real
# LAN interface) avoids reporting a Docker-internal IP as this
# device's URL, which register_player would then treat as a brand
# new device instead of updating the existing one.
DEFAULT_IFACE=$(ip route show default 2>/dev/null | awk '/^default/ {{print $5; exit}}')

IP=""
if [ -n "$DEFAULT_IFACE" ]; then
  IP=$(ip -4 -o addr show dev "$DEFAULT_IFACE" 2>/dev/null | awk '{{print $4}}' | cut -d/ -f1 | head -1)
fi
if [ -z "$IP" ]; then
  IP=$(hostname -I | awk '{{print $1}}')
fi
URL="http://$IP"

MAC=""
if [ -n "$DEFAULT_IFACE" ] && [ -f "/sys/class/net/$DEFAULT_IFACE/address" ]; then
  MAC=$(cat "/sys/class/net/$DEFAULT_IFACE/address")
fi
if [ -z "$MAC" ]; then
  for addr_file in /sys/class/net/*/address; do
    iface=$(basename "$(dirname "$addr_file")")
    [ "$iface" = "lo" ] && continue
    MAC=$(cat "$addr_file")
    [ -n "$MAC" ] && break
  done
fi
MAC_FIELD=""
if [ -n "$MAC" ]; then
  MAC_FIELD=",\\"mac_address\\":\\"$MAC\\""
fi

# Detect Tailscale IP if available
TS_IP=""
if command -v tailscale >/dev/null 2>&1; then
  TS_IP=$(tailscale ip -4 2>/dev/null || true)
fi
TS_FIELD=""
if [ -n "$TS_IP" ]; then
  TS_FIELD=",\\"tailscale_ip\\":\\"$TS_IP\\""
fi

curl -sf -X POST "${{SERVER}}/api/players/register/" \\
  -H "Content-Type: application/json" \\{auth_header_line}
  -d "{{\\"url\\":\\"${{URL}}\\",\\"name\\":\\"${{NAME}}\\",\\"info\\":${{INFO}}$MAC_FIELD$TS_FIELD}}"
SCRIPT
chmod +x /usr/local/bin/anthias-phonehome.sh

# Create systemd service
cat > /etc/systemd/system/anthias-phonehome.service << 'EOF'
[Unit]
Description=Anthias Phone Home
After=network-online.target
Wants=network-online.target

[Service]
Type=oneshot
ExecStart=/usr/local/bin/anthias-phonehome.sh
EOF

# Create systemd timer
cat > /etc/systemd/system/anthias-phonehome.timer << 'EOF'
[Unit]
Description=Anthias Phone Home Timer

[Timer]
OnBootSec=30s
OnUnitActiveSec=60s
AccuracySec=5s

[Install]
WantedBy=timers.target
EOF

# Enable and start
systemctl daemon-reload
systemctl enable anthias-phonehome.timer
systemctl start anthias-phonehome.timer

echo "Anthias phone-home installed and started."
echo "Timer status:"
systemctl status anthias-phonehome.timer --no-pager
'''
    return HttpResponse(script, content_type='text/plain; charset=utf-8')
