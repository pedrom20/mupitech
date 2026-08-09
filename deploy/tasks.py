import logging

from celery import shared_task

logger = logging.getLogger(__name__)


@shared_task(bind=True, max_retries=0)
def execute_deploy(self, deploy_task_id):
    """
    Execute a deploy task: iterate over all target players and create
    the asset on each one via the Anthias API client.

    Args:
        deploy_task_id: UUID string of the DeployTask to execute.
    """
    from deploy.models import DeployTask
    from players.services import AnthiasAPIClient, PlayerConnectionError

    try:
        deploy_task = DeployTask.objects.get(pk=deploy_task_id)
    except DeployTask.DoesNotExist:
        logger.error('DeployTask %s does not exist.', deploy_task_id)
        return

    deploy_task.status = 'running'
    deploy_task.progress = {}
    deploy_task.save(update_fields=['status', 'progress'])

    target_players = deploy_task.target_players.all()
    total = target_players.count()
    succeeded = 0
    failed = 0

    PROGRESS_BATCH_SIZE = 5
    processed = 0

    for player in target_players:
        client = AnthiasAPIClient(player)
        try:
            # If a file was uploaded, send it first, then create the asset.
            if deploy_task.file_path:
                with deploy_task.file_path.open('rb') as f:
                    upload_result = client.upload_file(f)
                logger.info(
                    'Uploaded file to player %s: %s', player.name, upload_result,
                )

            # Create the asset on the player using the provided asset_data.
            if deploy_task.asset_data:
                result = client.create_asset(deploy_task.asset_data)
                logger.info(
                    'Created asset on player %s: %s', player.name, result,
                )

            deploy_task.progress[str(player.id)] = {
                'status': 'success',
                'name': player.name,
            }
            succeeded += 1

        except PlayerConnectionError as exc:
            deploy_task.progress[str(player.id)] = {
                'status': 'failed',
                'name': player.name,
                'error': str(exc),
            }
            failed += 1
            logger.warning(
                'Failed to deploy to player %s: %s', player.name, exc,
            )

        except Exception as exc:
            deploy_task.progress[str(player.id)] = {
                'status': 'failed',
                'name': player.name,
                'error': str(exc),
            }
            failed += 1
            logger.exception(
                'Unexpected error deploying to player %s.', player.name,
            )

        processed += 1
        # Batch progress saves to reduce write amplification.
        if processed % PROGRESS_BATCH_SIZE == 0:
            deploy_task.save(update_fields=['progress'])

    # Final save to flush any remaining progress.
    deploy_task.save(update_fields=['progress'])

    # Determine final status.
    if failed == 0:
        deploy_task.status = 'completed'
    elif succeeded == 0:
        deploy_task.status = 'failed'
    else:
        # Partial success - mark as completed (progress has per-player details).
        deploy_task.status = 'completed'

    deploy_task.save(update_fields=['status'])
    logger.info(
        'DeployTask %s finished: %d/%d succeeded, %d/%d failed.',
        deploy_task_id, succeeded, total, failed, total,
    )


@shared_task(bind=True, max_retries=0)
def check_cctv_schedules(self):
    """Proactively start/stop CCTV streams based on player schedules.

    Runs every 30s via Celery beat. Checks online players' schedules for
    CCTV assets, starts streams if needed, stops if no longer needed.
    """
    import re
    from datetime import timedelta

    from django.utils import timezone

    from deploy.cctv_service import get_stream_status, start_stream, stitch_grid_snapshot, stop_stream, update_thumbnail
    from deploy.models import CctvConfig
    from players.models import Player

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
