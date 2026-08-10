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

    def get_queryset(self):
        from access.scoping import filter_groups
        return filter_groups(super().get_queryset(), self.request.user)

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

    @action(detail=True, methods=['post'], url_path='push-branding')
    def push_branding(self, request, pk=None):
        """SSH into every player in this group (same credentials) and push
        the custom branding images (splash-page logo and/or standby image)."""
        group = self.get_object()
        ssh_password = request.data.get('ssh_password')
        if not ssh_password:
            return Response({'error': 'ssh_password is required'}, status=400)
        ssh_user = request.data.get('ssh_user') or 'pi'
        try:
            ssh_port = int(request.data.get('ssh_port', 22))
        except (TypeError, ValueError):
            return Response({'error': 'ssh_port must be an integer'}, status=400)
        push_logo = request.data.get('push_logo', True)
        push_standby = request.data.get('push_standby', False)

        from players.branding import (
            BrandingPushError, push_splash_logo_to_player, push_standby_image_to_player,
        )

        results = {}
        for player in group.players.all():
            try:
                if push_logo:
                    push_splash_logo_to_player(player, ssh_user, ssh_password, ssh_port)
                if push_standby:
                    push_standby_image_to_player(player, ssh_user, ssh_password, ssh_port)
                results[str(player.id)] = {'name': player.name, 'success': True}
            except BrandingPushError as exc:
                results[str(player.id)] = {'name': player.name, 'success': False, 'error': str(exc)}

        log_action(
            request, 'push_branding', 'group', target_id=group.id, target_name=group.name,
            details={'logo': bool(push_logo), 'standby': bool(push_standby), 'results': results},
        )
        return Response({'success': True, 'results': results})
