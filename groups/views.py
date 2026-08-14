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
        """SSH into every player in this group and push branding overrides:
        a custom splash-page logo and/or standby image (the blue theme
        colors and Portuguese copy are baked into the mupitech-player
        image itself now — nothing to push for those), plus each player's
        identification chip data alongside its logo.

        ssh_user/ssh_password/ssh_port are used as a shared fallback for
        any player without its own saved SSH credentials — a player that
        has its own takes precedence, so a group can mix devices with
        different logins in one push."""
        group = self.get_object()
        default_ssh_password = request.data.get('ssh_password')
        default_ssh_user = request.data.get('ssh_user') or 'pi'
        try:
            default_ssh_port = int(request.data.get('ssh_port', 22))
        except (TypeError, ValueError):
            return Response({'error': 'ssh_port must be an integer'}, status=400)
        push_logo = request.data.get('push_logo', True)
        push_standby = request.data.get('push_standby', False)

        from players.branding import (
            BrandingPushError, push_device_label_to_player, push_splash_logo_to_player,
            push_standby_image_to_player,
        )

        results = {}
        for player in group.players.all():
            if player.has_ssh_credentials:
                ssh_user, ssh_password, ssh_port = player.ssh_username, player.get_ssh_password(), player.ssh_port
            else:
                ssh_user, ssh_password, ssh_port = default_ssh_user, default_ssh_password, default_ssh_port
            if not ssh_password:
                results[str(player.id)] = {
                    'name': player.name, 'success': False,
                    'error': 'No SSH credentials available for this device.',
                }
                continue
            try:
                if push_logo:
                    push_splash_logo_to_player(player, ssh_user, ssh_password, ssh_port)
                    push_device_label_to_player(player, ssh_user, ssh_password, ssh_port)
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

    @action(detail=True, methods=['post', 'delete'], url_path='logo')
    def logo(self, request, pk=None):
        """Upload or remove this group's own splash logo override."""
        group = self.get_object()
        from players.branding import save_logo_upload

        if request.method == 'DELETE':
            if group.splash_logo:
                group.splash_logo.delete(save=True)
            return Response(status=204)

        file = request.FILES.get('logo')
        if not file:
            return Response({'error': 'logo file is required'}, status=400)
        try:
            save_logo_upload(group, file)
        except ValueError as exc:
            return Response({'error': str(exc)}, status=400)
        return Response({'success': True, 'logo_url': group.splash_logo.url})

    @action(detail=True, methods=['post', 'delete'], url_path='standby')
    def standby(self, request, pk=None):
        """Upload or remove this group's own standby image override."""
        group = self.get_object()
        from players.branding import save_standby_upload

        if request.method == 'DELETE':
            if group.standby_image:
                group.standby_image.delete(save=True)
            return Response(status=204)

        file = request.FILES.get('standby')
        if not file:
            return Response({'error': 'standby file is required'}, status=400)
        try:
            save_standby_upload(group, file)
        except ValueError as exc:
            return Response({'error': str(exc)}, status=400)
        return Response({'success': True, 'standby_url': group.standby_image.url})
