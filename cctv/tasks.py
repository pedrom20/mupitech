import logging

from celery import shared_task

logger = logging.getLogger(__name__)


@shared_task(bind=True, max_retries=0)
def check_cctv_schedules(self):
    """Proactively start/stop CCTV streams based on player schedules.

    Runs every 30s via Celery beat. Checks online players' schedules for
    CCTV assets, starts streams if needed, stops if no longer needed.
    """
    import re
    from datetime import timedelta

    from django.utils import timezone

    from players.models import Player

    from .models import CctvConfig
    from .services import get_stream_status, start_stream, stitch_grid_snapshot, stop_stream, update_thumbnail

    needed_config_ids = set()

    online_players = Player.objects.filter(is_online=True)
    for player in online_players:
        try:
            from players.services import AnthiasAPIClient
            client = AnthiasAPIClient(player)
            slots = client._get(f'{client.base_url}/api/v2/schedule-slots/')
            if not isinstance(slots, list):
                continue
            for slot in slots:
                items = slot.get('items', [])
                for item in items:
                    uri = item.get('asset_uri', '')
                    match = re.search(r'/cctv/([0-9a-f-]+)/?', uri)
                    if match:
                        needed_config_ids.add(match.group(1))
        except Exception:
            logger.debug('Failed to check schedule for player %s', player.name)

    # Start streams that are needed + refresh grid snapshots
    for config_id in needed_config_ids:
        try:
            config = CctvConfig.objects.get(pk=config_id)
            stream = get_stream_status(config_id)
            if stream['status'] != 'running':
                logger.info('Proactively starting CCTV stream %s (%s)', config_id, config.name)
                start_stream(config_id)
                config.is_active = True
                config.last_requested_at = timezone.now()
                config.save(update_fields=['is_active', 'last_requested_at'])

                # Delayed thumbnail update
                import threading
                import time

                def _thumb(cid):
                    time.sleep(5)
                    try:
                        stitch_grid_snapshot(cid)
                        update_thumbnail(cid)
                    except Exception:
                        logger.warning('Failed to update CCTV thumbnail for %s', cid, exc_info=True)

                threading.Thread(target=_thumb, args=(config_id,), daemon=True).start()
            else:
                # Running stream — refresh grid mosaic snapshot for live view
                stitch_grid_snapshot(config_id)
        except CctvConfig.DoesNotExist:
            pass
        except Exception:
            logger.exception('Failed to proactively start CCTV %s', config_id)

    # Stop streams not needed for 5+ minutes
    cutoff = timezone.now() - timedelta(minutes=5)
    active_configs = CctvConfig.objects.filter(is_active=True)
    for config in active_configs:
        config_id_str = str(config.id)
        if config_id_str not in needed_config_ids:
            if config.last_requested_at and config.last_requested_at < cutoff:
                logger.info('Auto-stopping CCTV stream %s (%s) — not needed', config_id_str, config.name)
                stop_stream(config_id_str)
                config.is_active = False
                config.save(update_fields=['is_active'])
