import logging

from celery import shared_task
from django.utils import timezone

logger = logging.getLogger(__name__)


@shared_task(bind=True, max_retries=0)
def deploy_playlist(self, playlist_id):
    """Push every item of a playlist, in order, to every resolved player.

    Resolved players = playlist.target_players ∪ players in target_groups
    ∪ players in target_locations (direct or via a located group).
    """
    from players.services import PlayerConnectionError, deploy_media_file_to_player

    from .models import Playlist

    try:
        playlist = Playlist.objects.prefetch_related('items__media_file').get(pk=playlist_id)
    except Playlist.DoesNotExist:
        logger.error('Playlist %s does not exist.', playlist_id)
        return

    players = playlist.resolve_target_players()
    items = list(playlist.items.select_related('media_file').order_by('order'))

    results = {}
    for player in players:
        item_results = []
        player_ok = True
        for item in items:
            try:
                deploy_media_file_to_player(
                    player, item.media_file,
                    duration=item.duration or 10,
                )
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

    playlist.last_deploy_status = results
    playlist.last_deployed_at = timezone.now()
    playlist.save(update_fields=['last_deploy_status', 'last_deployed_at'])

    logger.info(
        'Playlist %s deployed to %d player(s).', playlist_id, len(results),
    )
