from rest_framework import viewsets
from rest_framework.decorators import action
from rest_framework.response import Response

from fleet_manager.permissions import IsEditorOrReadOnly
from history.logging import log_action
from players.services import AnthiasAPIClient, PlayerConnectionError

from .models import Group
from .serializers import GroupSerializer

VALID_ROTATIONS = (0, 90, 180, 270)


class GroupViewSet(viewsets.ModelViewSet):
    """ViewSet for managing player groups."""
    queryset = Group.objects.all()
    serializer_class = GroupSerializer
    pagination_class = None
    permission_classes = [IsEditorOrReadOnly]

    @action(detail=True, methods=['post'], url_path='apply-rotation')
    def apply_rotation(self, request, pk=None):
        """Apply the same screen_rotation to every player in this group."""
        group = self.get_object()
        try:
            rotation = int(request.data.get('screen_rotation'))
        except (TypeError, ValueError):
            return Response({'error': 'screen_rotation is required and must be an integer'}, status=400)
        if rotation not in VALID_ROTATIONS:
            return Response({'error': f'screen_rotation must be one of {VALID_ROTATIONS}'}, status=400)

        results = {}
        for player in group.players.all():
            client = AnthiasAPIClient(player)
            try:
                client.update_device_settings({'screen_rotation': rotation})
                results[str(player.id)] = {'name': player.name, 'success': True}
            except PlayerConnectionError as exc:
                results[str(player.id)] = {'name': player.name, 'success': False, 'error': str(exc)}
            except Exception as exc:
                results[str(player.id)] = {'name': player.name, 'success': False, 'error': str(exc)}

        log_action(
            request, 'apply_rotation', 'group', target_id=group.id, target_name=group.name,
            details={'screen_rotation': rotation, 'results': results},
        )
        return Response({'success': True, 'rotation': rotation, 'results': results})
