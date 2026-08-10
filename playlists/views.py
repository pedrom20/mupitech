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
