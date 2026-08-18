import logging

from celery import shared_task

logger = logging.getLogger(__name__)


@shared_task(bind=True, max_retries=0)
def sync_footer_messages_for_players(self, player_ids):
    """Push each player's resolved footer ticker text down as a device
    setting (``footer_enabled``/``footer_messages``), reusing the same
    ``/api/v2/device_settings`` channel every other per-device setting
    goes through. ``player_ids`` should include both a message's targets
    before and after an edit, so a player just removed from a message
    still gets its footer disabled instead of being left stuck on stale
    text (see footer_messages/views.py).
    """
    from players.models import Player
    from players.services import AnthiasAPIClient, PlayerConnectionError

    from .services import compute_message_map_for_players

    player_ids = list(dict.fromkeys(player_ids))
    if not player_ids:
        return

    message_map = compute_message_map_for_players(player_ids)

    for player in Player.objects.filter(id__in=player_ids):
        texts = message_map.get(str(player.id), [])
        payload = {
            'footer_enabled': bool(texts),
            'footer_messages': texts,
        }
        try:
            AnthiasAPIClient(player).update_device_settings(payload)
        except PlayerConnectionError as exc:
            logger.warning('Could not push footer messages to %s: %s', player.name, exc)
        except Exception:
            logger.exception('Unexpected error pushing footer messages to %s', player.name)
