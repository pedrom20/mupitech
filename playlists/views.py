from rest_framework import viewsets
from rest_framework.decorators import action
from rest_framework.response import Response

from fleet_manager.permissions import IsEditorOrReadOnly
from history.logging import log_action

from .models import Playlist
from .serializers import PlaylistSerializer
from .tasks import deploy_playlist


class PlaylistViewSet(viewsets.ModelViewSet):
    """ViewSet for managing content playlists and deploying them."""
    queryset = Playlist.objects.prefetch_related(
        'items__media_file', 'target_players', 'target_groups', 'target_locations',
    ).all()
    serializer_class = PlaylistSerializer
    pagination_class = None
    permission_classes = [IsEditorOrReadOnly]

    def perform_create(self, serializer):
        playlist = serializer.save()
        log_action(self.request, 'create', 'playlist', target_id=playlist.id, target_name=playlist.name)

    def perform_update(self, serializer):
        playlist = serializer.save()
        log_action(self.request, 'update', 'playlist', target_id=playlist.id, target_name=playlist.name)

    def perform_destroy(self, instance):
        log_action(self.request, 'delete', 'playlist', target_id=instance.id, target_name=instance.name)
        instance.delete()

    @action(detail=True, methods=['post'])
    def deploy(self, request, pk=None):
        """Push this playlist's content to all its resolved players (async)."""
        playlist = self.get_object()
        target_count = playlist.resolve_target_players().count()
        if target_count == 0:
            return Response({'error': 'This playlist has no target players, groups or locations.'}, status=400)

        deploy_playlist.delay(str(playlist.id))
        log_action(request, 'deploy', 'playlist', target_id=playlist.id, target_name=playlist.name, details={'target_count': target_count})
        return Response({'success': True, 'target_count': target_count})

    @action(detail=True, methods=['post'], url_path='remove-from-devices')
    def remove_from_devices(self, request, pk=None):
        """The reverse of "Apply to": un-target the given players/groups/
        locations AND delete whatever this playlist deployed on them —
        just editing target_players/groups/locations down (the normal
        PATCH) leaves stale content behind forever, since deploy_playlist
        only ever visits *currently* targeted players and would never
        revisit one that's been removed to clean it up."""
        from players.models import Player
        from players.services import AnthiasAPIClient, resolve_players_from_targets

        from fleet_manager.permissions import _user_role
        if _user_role(request.user) == 'editor_simplificado':
            return Response(
                {'error': 'Only an admin can change which devices this playlist targets.'}, status=403,
            )

        playlist = self.get_object()
        player_ids = request.data.get('player_ids', [])
        group_ids = request.data.get('group_ids', [])
        location_ids = request.data.get('location_ids', [])
        if not (player_ids or group_ids or location_ids):
            return Response({'error': 'Provide at least one of player_ids, group_ids or location_ids.'}, status=400)

        players = resolve_players_from_targets(player_ids, group_ids, location_ids)
        deployed_assets = dict(playlist.deployed_assets)
        cleaned = []
        for player in players:
            asset_ids = deployed_assets.pop(str(player.id), None)
            if asset_ids:
                client = AnthiasAPIClient(player)
                for asset_id in asset_ids:
                    try:
                        client.delete_asset(asset_id)
                    except Exception:
                        pass
            cleaned.append(str(player.id))

        playlist.deployed_assets = deployed_assets
        playlist.target_players.remove(*Player.objects.filter(id__in=player_ids))
        if group_ids:
            from groups.models import Group
            playlist.target_groups.remove(*Group.objects.filter(id__in=group_ids))
        if location_ids:
            from locations.models import Location
            playlist.target_locations.remove(*Location.objects.filter(id__in=location_ids))
        playlist.save(update_fields=['deployed_assets'])

        log_action(
            request, 'update', 'playlist', target_id=playlist.id, target_name=playlist.name,
            details={'removed_from': len(cleaned)},
        )
        return Response(self.get_serializer(playlist).data)
