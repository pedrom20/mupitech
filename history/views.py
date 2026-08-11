import logging

from rest_framework import status
from rest_framework.decorators import api_view
from rest_framework.response import Response

from fleet_manager.permissions import _user_role

from .models import AuditLog, PlaybackLog
from .serializers import AuditLogSerializer, PlaybackLogSerializer

logger = logging.getLogger(__name__)


def _safe_int(value, default, field_name='value'):
    """Parse an int from request data, returning default on None or raising 400 on bad input."""
    if value is None:
        return default
    try:
        return int(value)
    except (ValueError, TypeError):
        from rest_framework.exceptions import ValidationError
        raise ValidationError({field_name: f'Must be an integer, got: {value!r}'})


@api_view(['GET'])
def audit_list(request):
    """Paginated audit log with filters. Admin-only."""
    if _user_role(request.user) not in ('admin', 'superadmin'):
        return Response({'detail': 'Admin access required.'}, status=status.HTTP_403_FORBIDDEN)

    qs = AuditLog.objects.select_related('user').all()

    # Filters
    user_id = request.query_params.get('user')
    if user_id:
        qs = qs.filter(user_id=user_id)

    action = request.query_params.get('action')
    if action:
        qs = qs.filter(action=action)

    target_type = request.query_params.get('target_type')
    if target_type:
        qs = qs.filter(target_type=target_type)

    date_from = request.query_params.get('from')
    if date_from:
        qs = qs.filter(timestamp__gte=date_from)

    date_to = request.query_params.get('to')
    if date_to:
        qs = qs.filter(timestamp__lte=date_to)

    # Pagination
    try:
        page = int(request.query_params.get('page', 1))
    except (ValueError, TypeError):
        page = 1
    try:
        page_size = int(request.query_params.get('page_size', 50))
    except (ValueError, TypeError):
        page_size = 50
    page_size = min(page_size, 200)

    total = qs.count()
    offset = (page - 1) * page_size
    entries = qs[offset:offset + page_size]

    serializer = AuditLogSerializer(entries, many=True)

    return Response({
        'results': serializer.data,
        'total': total,
        'page': page,
        'page_size': page_size,
    })


@api_view(['GET'])
def playback_log(request):
    """Get playback log entries with optional filters."""
    from players.models import Player

    qs = PlaybackLog.objects.select_related('player').all()

    player_id = request.query_params.get('player')
    if player_id:
        qs = qs.filter(player_id=player_id)

    date_from = request.query_params.get('date_from')
    if date_from:
        qs = qs.filter(timestamp__gte=date_from)

    date_to = request.query_params.get('date_to')
    if date_to:
        qs = qs.filter(timestamp__lte=date_to)

    content = request.query_params.get('content')
    if content:
        qs = qs.filter(asset_name=content)

    # Pagination
    page = _safe_int(request.query_params.get('page'), 1, 'page')
    page_size = _safe_int(request.query_params.get('page_size'), 50, 'page_size')
    total = qs.count()
    offset = (page - 1) * page_size
    entries = qs[offset:offset + page_size]

    serializer = PlaybackLogSerializer(entries, many=True)

    # Tracking info per player
    tracking_info = {}
    if player_id:
        try:
            p = Player.objects.get(pk=player_id)
            tracking_info[str(p.id)] = {
                'name': p.name,
                'tracking_since': p.history_tracking_since.isoformat() if p.history_tracking_since else None,
            }
        except Player.DoesNotExist:
            logger.debug('Player %s not found for tracking info', player_id)
    else:
        for p in Player.objects.filter(history_tracking_since__isnull=False):
            tracking_info[str(p.id)] = {
                'name': p.name,
                'tracking_since': p.history_tracking_since.isoformat() if p.history_tracking_since else None,
            }

    # Distinct asset names for filter dropdown
    asset_names = list(
        PlaybackLog.objects.values_list('asset_name', flat=True)
        .distinct().order_by('asset_name')
    )

    return Response({
        'results': serializer.data,
        'total': total,
        'page': page,
        'page_size': page_size,
        'tracking_info': tracking_info,
        'asset_names': asset_names,
    })


@api_view(['GET'])
def playback_stats(request):
    """Return total playback duration per asset base name (in seconds).

    Uses SQL LEAD() window function to compute duration between consecutive
    'started' events per player.  The last event per player is skipped
    (no way to know when it ended).

    Groups by base name (without extension) so that e.g. 'video.MOV' uploaded
    as MediaFile matches 'video.mp4' logged by the player after transcoding.
    """
    from django.db import connection

    sql = """
        SELECT base_name, SUM(dur) AS total_seconds
        FROM (
            SELECT
                CASE
                    WHEN asset_name LIKE '%%.%%'
                    THEN LEFT(asset_name, LENGTH(asset_name) - LENGTH(SUBSTRING(asset_name FROM '\\.[^.]*$')))
                    ELSE asset_name
                END AS base_name,
                EXTRACT(EPOCH FROM
                    LEAD(timestamp) OVER (PARTITION BY player_id ORDER BY timestamp)
                    - timestamp
                ) AS dur
            FROM players_playbacklog
            WHERE event = 'started'
        ) sub
        WHERE dur IS NOT NULL AND dur > 0 AND dur < 86400
        GROUP BY base_name
    """
    with connection.cursor() as cur:
        cur.execute(sql)
        rows = cur.fetchall()

    stats = {row[0]: round(row[1]) for row in rows}
    return Response({'stats': stats})
