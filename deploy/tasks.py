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
