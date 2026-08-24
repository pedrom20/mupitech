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

    from .services import (
        compute_message_map_for_players, footer_cycle_interval_minutes,
        footer_logo_absolute_url,
    )

    player_ids = list(dict.fromkeys(player_ids))
    if not player_ids:
        return

    message_map = compute_message_map_for_players(player_ids)
    # Same for every player in this batch — resolved once rather than
    # per-player, since both are fleet-wide (see the plan doc's
    # "Decisão de arquitetura" note on why this isn't per-device).
    cycle_interval_minutes = footer_cycle_interval_minutes()
    logo_url = footer_logo_absolute_url()

    for player in Player.objects.filter(id__in=player_ids):
        texts = message_map.get(str(player.id), [])
        payload = {
            'footer_enabled': bool(texts),
            'footer_messages': texts,
            'footer_cycle_interval_minutes': cycle_interval_minutes,
            'footer_logo_url': logo_url,
        }
        try:
            AnthiasAPIClient(player).update_device_settings(payload)
        except PlayerConnectionError as exc:
            logger.warning('Could not push footer messages to %s: %s', player.name, exc)
        except Exception:
            logger.exception('Unexpected error pushing footer messages to %s', player.name)


@shared_task(bind=True, max_retries=0)
def sync_all_footer_players(self):
    """Re-push every player that currently has at least one active
    footer message — used when a fleet-wide footer setting changes
    (cycle interval, logo), which affects every one of those players
    at once rather than one message's own targets (see
    footer_messages/views.py's footer_settings/footer_logo)."""
    from players.models import Player

    from .services import compute_message_map_for_players

    all_ids = list(Player.objects.values_list('id', flat=True))
    if not all_ids:
        return
    message_map = compute_message_map_for_players(all_ids)
    affected = [pid for pid, texts in message_map.items() if texts]
    if affected:
        sync_footer_messages_for_players(affected)
