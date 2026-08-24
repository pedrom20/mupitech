import os

from django.core.cache import cache
from rest_framework import viewsets
from rest_framework.decorators import api_view, permission_classes
from rest_framework.response import Response

from fleet_manager.permissions import IsAdmin, IsEditorOrReadOnly
from history.logging import log_action

from .models import FooterMessage
from .serializers import FooterMessageSerializer
from .services import (
    FOOTER_CYCLE_INTERVAL_MINUTES_KEY, FOOTER_LOGO_DIR, FOOTER_LOGO_FILENAME,
    footer_cycle_interval_minutes, footer_logo_path,
)
from .tasks import sync_all_footer_players, sync_footer_messages_for_players


class FooterMessageViewSet(viewsets.ModelViewSet):
    """ViewSet for managing footer ticker messages shown on devices."""
    queryset = FooterMessage.objects.prefetch_related(
        'target_players', 'target_groups', 'target_locations',
    ).all()
    serializer_class = FooterMessageSerializer
    pagination_class = None
    permission_classes = [IsEditorOrReadOnly]

    def perform_create(self, serializer):
        message = serializer.save()
        log_action(self.request, 'create', 'footer_message', target_id=message.id, target_name=message.title[:50])
        player_ids = list(message.resolve_target_players().values_list('id', flat=True))
        if player_ids:
            sync_footer_messages_for_players.delay(player_ids)

    def perform_update(self, serializer):
        instance = serializer.instance
        previous_player_ids = set(instance.resolve_target_players().values_list('id', flat=True))
        message = serializer.save()
        log_action(self.request, 'update', 'footer_message', target_id=message.id, target_name=message.title[:50])
        new_player_ids = set(message.resolve_target_players().values_list('id', flat=True))
        affected = list(previous_player_ids | new_player_ids)
        if affected:
            sync_footer_messages_for_players.delay(affected)

    def perform_destroy(self, instance):
        player_ids = list(instance.resolve_target_players().values_list('id', flat=True))
        log_action(self.request, 'delete', 'footer_message', target_id=instance.id, target_name=instance.title[:50])
        instance.delete()
        if player_ids:
            sync_footer_messages_for_players.delay(player_ids)


def _footer_settings_response():
    has_logo = os.path.isfile(footer_logo_path())
    return {
        'cycle_interval_minutes': footer_cycle_interval_minutes(),
        'has_logo': has_logo,
        'logo_url': f'/media/footer/{FOOTER_LOGO_FILENAME}' if has_logo else None,
    }


@api_view(['GET', 'PATCH'])
@permission_classes([IsAdmin])
def footer_settings(request):
    """Get or update the fleet-wide footer settings: how many minutes
    between automatic show cycles (0 = always visible, the pre-existing
    behavior) and whether a logo is currently uploaded."""
    if request.method == 'GET':
        return Response(_footer_settings_response())

    try:
        minutes = int(request.data.get('cycle_interval_minutes', 0))
    except (TypeError, ValueError):
        return Response({'error': 'cycle_interval_minutes must be an integer'}, status=400)
    if minutes < 0:
        return Response({'error': 'cycle_interval_minutes must be >= 0'}, status=400)

    cache.set(FOOTER_CYCLE_INTERVAL_MINUTES_KEY, minutes, None)
    log_action(request, 'update', 'footer_settings', details={'cycle_interval_minutes': minutes})
    sync_all_footer_players.delay()

    return Response(_footer_settings_response())


@api_view(['POST', 'DELETE'])
@permission_classes([IsAdmin])
def footer_logo(request):
    """Upload or remove the fleet-wide footer logo (PNG/JPEG/GIF —
    converted to a real PNG, same as the standby-image slot; see
    players.branding.convert_to_png)."""
    from players.branding import convert_to_png

    if request.method == 'DELETE':
        if os.path.isfile(footer_logo_path()):
            os.remove(footer_logo_path())
            log_action(request, 'delete', 'footer_logo')
            sync_all_footer_players.delay()
        return Response(status=204)

    file = request.FILES.get('logo')
    if not file:
        return Response({'error': 'logo file is required'}, status=400)
    if not file.name.lower().endswith(('.png', '.jpg', '.jpeg', '.gif')):
        return Response({'error': 'Only PNG, JPEG or GIF files are supported'}, status=400)

    try:
        image_bytes = convert_to_png(file)
    except Exception as exc:
        return Response({'error': f'Could not process image: {exc}'}, status=400)

    os.makedirs(FOOTER_LOGO_DIR, exist_ok=True)
    with open(footer_logo_path(), 'wb') as f:
        f.write(image_bytes)

    log_action(request, 'upload', 'footer_logo')
    sync_all_footer_players.delay()

    return Response({'success': True, 'logo_url': f'/media/footer/{FOOTER_LOGO_FILENAME}'})
