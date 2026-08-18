from rest_framework import viewsets
from rest_framework.decorators import action, api_view, permission_classes
from rest_framework.permissions import BasePermission
from rest_framework.response import Response

from fleet_manager.permissions import IsAdmin, IsEditorOrReadOnly
from history.logging import log_action

from .models import Playlist
from .serializers import PlaylistSerializer
from .settings import is_target_editing_restricted, set_target_editing_restricted
from .tasks import deploy_playlist


class _ReadableByAnyAdminWrite(BasePermission):
    """Any authenticated user can GET (the frontend needs this to decide
    whether to show the playlist target-picker to an editor at all —
    see canEditTargets in playlist-list.tsx); only an admin can PATCH."""

    def has_permission(self, request, view):
        if not request.user or not request.user.is_authenticated:
            return False
        if request.method == 'GET':
            return True
        return IsAdmin().has_permission(request, view)


@api_view(['GET', 'PATCH'])
@permission_classes([_ReadableByAnyAdminWrite])
def playlist_settings(request):
    """Whether editors are restricted from changing which devices a
    playlist targets (see settings.py) — readable by anyone, editable
    by an admin only."""
    if request.method == 'PATCH' and 'restrict_targets_to_admin' in request.data:
        set_target_editing_restricted(request.data['restrict_targets_to_admin'])
        log_action(
            request, 'update', 'settings', target_name='playlists',
            details={'restrict_targets_to_admin': bool(request.data['restrict_targets_to_admin'])},
        )
    return Response({'restrict_targets_to_admin': is_target_editing_restricted()})


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
