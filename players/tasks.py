import logging

from celery import shared_task
from django.utils import timezone

logger = logging.getLogger(__name__)


def _poll_lock_key(player_id):
    return f'poll_player_inflight_{player_id}'


@shared_task(bind=True, max_retries=0)
def poll_player(self, player_id):
    """
    Poll a single player for its current status.

    Fetches /v2/info from the player, updates is_online, last_seen,
    and last_status fields on the Player model.
    """
    from django.core.cache import cache

    from .models import Player
    from .services import AnthiasAPIClient

    try:
        player = Player.objects.get(pk=player_id)
    except Player.DoesNotExist:
        logger.warning('poll_player called for non-existent player: %s', player_id)
        cache.delete(_poll_lock_key(player_id))
        return

    client = AnthiasAPIClient(player)
    try:
        _poll_player_body(player, client)
    finally:
        # Released as soon as this poll actually finishes (success,
        # failure, or crash) — not on a fixed TTL — so poll_all_players
        # can safely skip re-dispatching this player next cycle for as
        # long as (and only as long as) its previous poll is still
        # genuinely in flight. See poll_all_players' docstring for why
        # this matters.
        cache.delete(_poll_lock_key(player_id))


def _poll_player_body(player, client):
    from .services import PlayerConnectionError

    try:
        info = client.get_info()
        player.is_online = True
        player.last_seen = timezone.now()
        player.last_status = info
        fields = ['is_online', 'last_seen', 'last_status']
        # Back online — clear any pending alert flag so the next offline
        # period sends a fresh email instead of staying silent forever.
        if player.last_offline_alert_at is not None:
            player.last_offline_alert_at = None
            fields.append('last_offline_alert_at')
        # One-time: auto-detect Tailscale IP from URL
        if not player.tailscale_ip:
            from players.serializers import _extract_tailscale_ip
            ts_ip = _extract_tailscale_ip(player.url)
            if ts_ip:
                player.tailscale_ip = ts_ip
                player.tailscale_enabled = True
                fields += ['tailscale_ip', 'tailscale_enabled']
        player.save(update_fields=fields)

        # Save snapshot for history
        from .models import PlayerSnapshot
        PlayerSnapshot.objects.create(
            player=player,
            data=info,
            assets_count=info.get('assets_count', 0),
            free_space=info.get('free_space', ''),
            load_avg=info.get('loadavg', 0.0),
            is_online=True,
        )

        logger.info('Player %s (%s) is online.', player.name, player.id)

    except PlayerConnectionError:
        player.is_online = False
        player.save(update_fields=['is_online'])

        from .models import PlayerSnapshot
        PlayerSnapshot.objects.create(
            player=player,
            is_online=False,
        )

        logger.info('Player %s (%s) is offline.', player.name, player.id)

    # Track playback in a separate try/except — errors here must NOT
    # affect the player's online status which was already saved above.
    try:
        _track_playback(player, client)
    except Exception:
        logger.exception(
            'Error tracking playback for player %s (%s), player status unaffected.',
            player.name, player.id,
        )


def _track_playback(player, client):
    """Fetch viewlog from player and store new entries."""
    from history.models import PlaybackLog

    try:
        since = player.last_viewlog_fetch or None
        entries = client.get_viewlog(since=since)
    except Exception:
        logger.debug('Could not fetch viewlog for %s', player.name)
        return

    if not entries:
        return

    latest_ts = None
    logs_to_create = []
    for entry in entries:
        if not isinstance(entry, dict):
            logger.warning('Skipping malformed viewlog entry for %s: %r', player.name, entry)
            continue
        started_at = entry.get('started_at', '')
        if not started_at:
            continue
        logs_to_create.append(PlaybackLog(
            player=player,
            asset_id=entry.get('asset_id', ''),
            asset_name=entry.get('asset_name', ''),
            mimetype=entry.get('mimetype', ''),
            event='started',
            timestamp=started_at,
        ))
        if not latest_ts or started_at > latest_ts:
            latest_ts = started_at

    if logs_to_create:
        PlaybackLog.objects.bulk_create(logs_to_create, ignore_conflicts=True)

    update_fields = []
    if latest_ts:
        player.last_viewlog_fetch = latest_ts
        update_fields.append('last_viewlog_fetch')
    if not player.history_tracking_since:
        player.history_tracking_since = timezone.now()
        update_fields.append('history_tracking_since')
    if update_fields:
        player.save(update_fields=update_fields)


@shared_task
def poll_all_players():
    """
    Poll all registered players for their current status.

    Dispatches a poll_player task for each player in the database —
    but only for players whose *previous* poll_player has actually
    finished (per-player lock, released by poll_player itself in a
    finally block, TTL below as a crash safety net only). Without this,
    an offline/slow player (each retry-laden poll can take up to ~90s
    against PLAYER_POLL_INTERVAL's default 60s cadence) gets a fresh
    poll_player enqueued on top of its still-running previous one every
    cycle, forever — the shared 'celery' queue backlog grows without
    bound (observed: 2000+ pending messages), starving out every other
    task on that queue, including user-triggered ones like
    playlists.tasks.deploy_playlist, for hours. The old lock here only
    ever guarded the dispatch loop itself (milliseconds), not each
    player's actual poll duration, so it never prevented this.
    """
    from django.core.cache import cache
    from .models import Player

    lock_id = 'poll_all_players_lock'
    # TTL as safety net; lock is released explicitly after dispatch
    if not cache.add(lock_id, 'locked', timeout=300):
        logger.info('poll_all_players skipped — previous cycle still running.')
        return

    try:
        player_ids = list(Player.objects.values_list('id', flat=True))
        dispatched = 0
        skipped = 0

        for player_id in player_ids:
            player_id = str(player_id)
            # Safety-net TTL only — poll_player's own finally block is
            # what actually releases this the moment it's done.
            if not cache.add(_poll_lock_key(player_id), 1, timeout=180):
                skipped += 1
                continue
            poll_player.delay(player_id)
            dispatched += 1

        logger.info(
            'Polling cycle: %d dispatched, %d skipped (previous poll still in flight).',
            dispatched, skipped,
        )
    finally:
        cache.delete(lock_id)


@shared_task
def check_offline_players():
    """Email admins a summary of devices offline longer than the configured
    threshold. Each qualifying device is only alerted on once per offline
    period (last_offline_alert_at), reset when it comes back online in
    poll_player — so this doesn't re-send every run for the same outage."""
    from datetime import timedelta

    from django.db.models import Q

    from fleet_manager.alerts import get_alert_settings, send_offline_alert_emails

    from .models import Player

    conf = get_alert_settings()
    if not conf['enabled']:
        return

    threshold_minutes = conf['threshold_minutes']
    cutoff = timezone.now() - timedelta(minutes=threshold_minutes)

    qualifying = Player.objects.filter(
        is_online=False,
        last_offline_alert_at__isnull=True,
    ).filter(
        Q(last_seen__lte=cutoff) | Q(last_seen__isnull=True, created_at__lte=cutoff)
    )

    players_to_alert = list(qualifying)
    if not players_to_alert:
        return

    send_offline_alert_emails(players_to_alert)

    now = timezone.now()
    for player in players_to_alert:
        player.last_offline_alert_at = now
    Player.objects.bulk_update(players_to_alert, ['last_offline_alert_at'])


@shared_task(bind=True, max_retries=0, time_limit=1800, soft_time_limit=1700)
def sync_local_registry(self):
    """Pull/tag/push the MupiTech player images into the local registry
    mirror (players/provision.py uses it for newly-provisioned devices
    once enabled). Can take a while — several GB across 9 images — hence
    the generous time limit. Triggered manually from Settings, not
    scheduled periodically."""
    from fleet_manager.registry_mirror import mirror_all_images
    mirror_all_images()
