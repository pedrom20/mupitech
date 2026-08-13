import logging

from celery import shared_task
from django.utils import timezone

logger = logging.getLogger(__name__)


@shared_task(bind=True, max_retries=0)
def deploy_playlist(self, playlist_id, start_date=None, end_date=None):
    """Push every item of a playlist, in order, to every resolved player.

    Resolved players = playlist.target_players ∪ players in target_groups
    ∪ players in target_locations (direct or via a located group).

    start_date/end_date (ISO strings) bound when each item is actually
    shown on the device, same meaning as a single-asset schedule (see
    players.services.deploy_media_file_to_player) — used by the
    Scheduling page (content.models.ScheduledDeployment) to schedule a
    whole playlist instead of one piece of content. A plain "Deploy"
    from the Playlists page calls this with neither, matching the
    previous always-immediate/always-on behaviour.
    """
    from players.services import AnthiasAPIClient, PlayerConnectionError, deploy_media_file_to_player

    from .models import Playlist

    try:
        playlist = Playlist.objects.prefetch_related('items__media_file').get(pk=playlist_id)
    except Playlist.DoesNotExist:
        logger.error('Playlist %s does not exist.', playlist_id)
        return

    players = playlist.resolve_target_players()
    items = list(playlist.items.select_related('media_file').order_by('order'))

    results = {}
    deployed_assets = {}
    for player in players:
        # Remove the assets this playlist created on the previous deploy,
        # so re-deploying replaces its content instead of duplicating it.
        previous_asset_ids = playlist.deployed_assets.get(str(player.id), [])
        if previous_asset_ids:
            client = AnthiasAPIClient(player)
            for asset_id in previous_asset_ids:
                try:
                    client.delete_asset(asset_id)
                except Exception:
                    pass

        item_results = []
        new_asset_ids = []
        player_ok = True
        for item in items:
            try:
                asset = deploy_media_file_to_player(
                    player, item.media_file,
                    duration=item.duration or 10,
                    start_date=start_date, end_date=end_date,
                )
                if asset and asset.get('asset_id'):
                    new_asset_ids.append(asset['asset_id'])
                item_results.append({'media_file': str(item.media_file_id), 'status': 'success'})
            except PlayerConnectionError as exc:
                player_ok = False
                item_results.append({'media_file': str(item.media_file_id), 'status': 'failed', 'error': str(exc)})
            except Exception as exc:
                player_ok = False
                item_results.append({'media_file': str(item.media_file_id), 'status': 'failed', 'error': str(exc)})
                logger.exception('Unexpected error deploying playlist item to %s', player.name)

        results[str(player.id)] = {
            'name': player.name,
            'success': player_ok,
            'items': item_results,
        }
        deployed_assets[str(player.id)] = new_asset_ids

    playlist.last_deploy_status = results
    playlist.deployed_assets = deployed_assets
    playlist.last_deployed_at = timezone.now()
    playlist.save(update_fields=['last_deploy_status', 'deployed_assets', 'last_deployed_at'])

    logger.info(
        'Playlist %s deployed to %d player(s).', playlist_id, len(results),
    )
