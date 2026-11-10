"""Admin-only reports: fleet SLA (uptime), content/playlist activity,
user activity — each a GET with optional ?start=YYYY-MM-DD&end=YYYY-MM-DD
(default: last 30 days), aggregated server-side rather than handing the
frontend raw rows (those already exist elsewhere — the Audit Log page for
AuditLog, the Content page's lifetime playback_stats for PlaybackLog).
"""

import datetime
import logging

from django.db.models import Count, Q
from django.utils import timezone
from rest_framework.decorators import api_view, permission_classes
from rest_framework.response import Response

from fleet_manager.permissions import IsAdmin

logger = logging.getLogger(__name__)

_DEFAULT_RANGE_DAYS = 30


def _parse_range(request):
    """Returns (start, end) as timezone-aware datetimes spanning whole
    local days — 'end' is exclusive (start of the day after the one
    requested), so a same-day range still includes that entire day."""
    end_str = request.query_params.get('end')
    start_str = request.query_params.get('start')

    tz = timezone.get_current_timezone()
    today = timezone.localdate()

    if end_str:
        try:
            end_date = datetime.date.fromisoformat(end_str)
        except ValueError:
            from rest_framework.exceptions import ValidationError
            raise ValidationError({'end': f'Must be YYYY-MM-DD, got: {end_str!r}'})
    else:
        end_date = today

    if start_str:
        try:
            start_date = datetime.date.fromisoformat(start_str)
        except ValueError:
            from rest_framework.exceptions import ValidationError
            raise ValidationError({'start': f'Must be YYYY-MM-DD, got: {start_str!r}'})
    else:
        start_date = end_date - datetime.timedelta(days=_DEFAULT_RANGE_DAYS - 1)

    start = timezone.make_aware(datetime.datetime.combine(start_date, datetime.time.min), tz)
    end = timezone.make_aware(datetime.datetime.combine(end_date + datetime.timedelta(days=1), datetime.time.min), tz)
    return start, end


@api_view(['GET'])
@permission_classes([IsAdmin])
def sla(request):
    """Uptime % per device over the period, from players.PlayerSnapshot
    (one row per 60s poll — see players/tasks.py::poll_player). No
    transition-event log exists, so this counts online vs total snapshots
    rather than measuring actual downtime durations."""
    from players.models import Player, PlayerSnapshot

    start, end = _parse_range(request)

    rows = (
        PlayerSnapshot.objects
        .filter(timestamp__gte=start, timestamp__lt=end)
        .values('player_id')
        .annotate(
            online=Count('id', filter=Q(is_online=True)),
            total=Count('id'),
        )
    )
    by_player = {row['player_id']: row for row in rows}

    players = Player.objects.select_related('group', 'location').all()
    devices = []
    fleet_online = 0
    fleet_total = 0
    for player in players:
        counts = by_player.get(player.id)
        online = counts['online'] if counts else 0
        total = counts['total'] if counts else 0
        fleet_online += online
        fleet_total += total
        # A group's own location takes precedence over a player's direct
        # one — same rule players/models.py::Player.location documents.
        location = player.group.location if player.group and player.group.location else player.location
        devices.append({
            'player_id': player.id,
            'player_name': player.name,
            'group_id': player.group_id,
            'group_name': player.group.name if player.group else None,
            'location_id': location.id if location else None,
            'location_name': location.name if location else None,
            'online_snapshots': online,
            'total_snapshots': total,
            'uptime_pct': round(online / total * 100, 2) if total else None,
        })

    return Response({
        'start': start.date().isoformat(),
        'end': (end - datetime.timedelta(days=1)).date().isoformat(),
        'fleet_uptime_pct': round(fleet_online / fleet_total * 100, 2) if fleet_total else None,
        'devices': devices,
    })


@api_view(['GET'])
@permission_classes([IsAdmin])
def content(request):
    """Content/playlist activity over the period: top assets by playback
    time (same LEAD()-window technique as history/views.py::playback_stats,
    bounded by date here instead of lifetime), uploads, and playlist
    deploys."""
    from django.db import connection

    from content.models import MediaFile
    from history.models import AuditLog

    start, end = _parse_range(request)

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
            WHERE event = 'started' AND timestamp >= %s AND timestamp < %s
        ) sub
        WHERE dur IS NOT NULL AND dur > 0 AND dur < 86400
        GROUP BY base_name
        ORDER BY total_seconds DESC
        LIMIT 20
    """
    with connection.cursor() as cur:
        cur.execute(sql, [start, end])
        rows = cur.fetchall()
    top_content = [{'name': row[0], 'seconds': round(row[1])} for row in rows]

    uploads = MediaFile.objects.filter(created_at__gte=start, created_at__lt=end).count()
    deploys = AuditLog.objects.filter(
        target_type='playlist', action='deploy', timestamp__gte=start, timestamp__lt=end,
    ).count()

    return Response({
        'start': start.date().isoformat(),
        'end': (end - datetime.timedelta(days=1)).date().isoformat(),
        'top_content': top_content,
        'uploads': uploads,
        'playlist_deploys': deploys,
    })


@api_view(['GET'])
@permission_classes([IsAdmin])
def users(request):
    """User activity over the period, from history.AuditLog — logins per
    day (trend), top users by action count, and a breakdown by action
    type. The row-by-row equivalent already exists on the Audit Log page
    (history/views.py::audit_list); this is the rolled-up view."""
    from django.db.models.functions import TruncDate

    from history.models import AuditLog

    start, end = _parse_range(request)
    qs = AuditLog.objects.filter(timestamp__gte=start, timestamp__lt=end)

    logins_by_day = (
        qs.filter(action='login')
        .annotate(day=TruncDate('timestamp'))
        .values('day')
        .annotate(count=Count('id'))
        .order_by('day')
    )

    top_users = (
        qs.exclude(user__isnull=True)
        .values('user_id', 'user__username')
        .annotate(count=Count('id'))
        .order_by('-count')[:10]
    )

    by_action = (
        qs.values('action')
        .annotate(count=Count('id'))
        .order_by('-count')
    )

    return Response({
        'start': start.date().isoformat(),
        'end': (end - datetime.timedelta(days=1)).date().isoformat(),
        'logins_by_day': [{'date': r['day'].isoformat(), 'count': r['count']} for r in logins_by_day],
        'top_users': [
            {'user_id': r['user_id'], 'username': r['user__username'], 'count': r['count']}
            for r in top_users
        ],
        'by_action': [{'action': r['action'], 'count': r['count']} for r in by_action],
    })
