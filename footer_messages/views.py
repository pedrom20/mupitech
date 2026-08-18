from rest_framework import viewsets

from fleet_manager.permissions import IsEditorOrReadOnly
from history.logging import log_action

from .models import FooterMessage
from .serializers import FooterMessageSerializer
from .tasks import sync_footer_messages_for_players


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
        log_action(self.request, 'create', 'footer_message', target_id=message.id, target_name=message.text[:50])
        player_ids = list(message.resolve_target_players().values_list('id', flat=True))
        if player_ids:
            sync_footer_messages_for_players.delay(player_ids)

    def perform_update(self, serializer):
        instance = serializer.instance
        previous_player_ids = set(instance.resolve_target_players().values_list('id', flat=True))
        message = serializer.save()
        log_action(self.request, 'update', 'footer_message', target_id=message.id, target_name=message.text[:50])
        new_player_ids = set(message.resolve_target_players().values_list('id', flat=True))
        affected = list(previous_player_ids | new_player_ids)
        if affected:
            sync_footer_messages_for_players.delay(affected)

    def perform_destroy(self, instance):
        player_ids = list(instance.resolve_target_players().values_list('id', flat=True))
        log_action(self.request, 'delete', 'footer_message', target_id=instance.id, target_name=instance.text[:50])
        instance.delete()
        if player_ids:
            sync_footer_messages_for_players.delay(player_ids)
