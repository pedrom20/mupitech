"""Device-initiated pairing: a fresh device that has never talked to
this Fleet Manager before asks to join, an admin approves it from the
Fleet Manager's own UI (already an authenticated, MFA-satisfied
session), and the device provisions its own SSO secret directly —
no SSH round-trip, no admin needing to already know the device's IP
or SSH credentials up front. See players/models.py::PendingPairing for
the full design rationale.
"""
import logging
import secrets

from django.utils import timezone
from django_ratelimit.decorators import ratelimit
from rest_framework.decorators import api_view, permission_classes
from rest_framework.permissions import AllowAny
from rest_framework.response import Response

from fleet_manager.permissions import IsAdmin

from .models import PendingPairing, Player
from .views import _normalize_mac

logger = logging.getLogger(__name__)

# Excludes visually-ambiguous characters (0/O, 1/I/L) — this code is
# read off a screen and typed/compared by a human, unlike poll_token
# which only ever moves between machines.
_CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'


def _generate_pairing_code():
    return ''.join(secrets.choice(_CODE_ALPHABET) for _ in range(6))


@ratelimit(group='pairing_request', key='ip', rate='10/m', method='POST', block=True)
@api_view(['POST'])
@permission_classes([AllowAny])
def pairing_request(request):
    """A device calls this to start pairing. No prior credential of any
    kind is needed — that's the whole point of this flow — so this is
    deliberately the least-trusted endpoint here, rate-limited by IP."""
    device_name = (request.data.get('device_name') or '').strip()
    mac_address = _normalize_mac(request.data.get('mac_address'))
    url = (request.data.get('url') or '').strip().rstrip('/')

    pairing = PendingPairing.objects.create(
        poll_token=secrets.token_urlsafe(32),
        pairing_code=_generate_pairing_code(),
        device_name=device_name,
        mac_address=mac_address,
        url=url,
    )
    return Response({
        'pairing_id': str(pairing.id),
        'pairing_code': pairing.pairing_code,
        'poll_token': pairing.poll_token,
        'ttl_minutes': PendingPairing.TTL_MINUTES,
    })


@ratelimit(group='pairing_status', key='ip', rate='60/m', method='GET', block=True)
@api_view(['GET'])
@permission_classes([AllowAny])
def pairing_status(request, pairing_id):
    """Polled by the device while it waits for an admin to act.
    poll_token is the only thing that makes this safe to leave
    unauthenticated — pairing_id alone also appears in the admin's
    pending list, but only whoever received poll_token back from
    pairing_request can read status or collect the finished secret."""
    token = request.GET.get('poll_token', '')
    try:
        pairing = PendingPairing.objects.get(pk=pairing_id)
    except (PendingPairing.DoesNotExist, ValueError, TypeError):
        return Response({'error': 'Not found.'}, status=404)

    if not token or not secrets.compare_digest(token, pairing.poll_token):
        return Response({'error': 'Not found.'}, status=404)

    if pairing.is_expired:
        return Response({'status': 'expired'})

    if pairing.status == 'approved' and pairing.player_id:
        player = pairing.player
        return Response({
            'status': 'approved',
            'fm_player_id': str(player.id),
            'fm_base_url': f'{request.scheme}://{request.get_host()}',
            'sso_secret': player.get_sso_secret(),
        })

    return Response({'status': pairing.status})


@api_view(['GET'])
@permission_classes([IsAdmin])
def pairing_list(request):
    """Everything still awaiting a decision — the Fleet Manager's own
    'Pending Devices' panel polls this. Expired rows are reported here
    too (rather than silently vanishing) so an admin who was mid-review
    understands why approving now fails, instead of the row just
    disappearing with no explanation."""
    pairings = PendingPairing.objects.filter(status='pending').order_by('-created_at')
    return Response([
        {
            'id': str(p.id),
            'pairing_code': p.pairing_code,
            'device_name': p.device_name,
            'mac_address': p.mac_address,
            'url': p.url,
            'created_at': p.created_at,
            'is_expired': p.is_expired,
        }
        for p in pairings
    ])


@api_view(['POST'])
@permission_classes([IsAdmin])
def pairing_approve(request, pairing_id):
    from history.logging import log_action

    try:
        pairing = PendingPairing.objects.get(pk=pairing_id, status='pending')
    except (PendingPairing.DoesNotExist, ValueError, TypeError):
        return Response({'error': 'Pending pairing request not found.'}, status=404)

    if pairing.is_expired:
        return Response({'error': 'This pairing request has expired — ask the device to try again.'}, status=400)

    if not pairing.url:
        return Response({'error': 'This device reported no reachable URL — cannot register it.'}, status=400)

    # Reuse an existing Player with the same MAC (a device that was
    # removed and is re-pairing) rather than creating a duplicate row —
    # same identity rule register_player's phone-home path already
    # follows for the same reason.
    player = None
    if pairing.mac_address:
        player = Player.objects.filter(mac_address=pairing.mac_address).first()
    if player is None:
        player = Player.objects.filter(url=pairing.url).first()
    if player is None:
        player = Player.objects.create(
            name=pairing.device_name or 'Novo dispositivo',
            url=pairing.url,
            mac_address=pairing.mac_address,
        )

    if not player.get_sso_secret():
        player.set_sso_secret(secrets.token_urlsafe(32))
        player.save(update_fields=['sso_secret_encrypted'])

    pairing.status = 'approved'
    pairing.approved_by = request.user
    pairing.approved_at = timezone.now()
    pairing.player = player
    pairing.save(update_fields=['status', 'approved_by', 'approved_at', 'player'])

    log_action(request, 'pairing_approve', 'player', target_id=player.id, target_name=player.name)
    return Response({'success': True, 'player_id': str(player.id), 'player_name': player.name})


@api_view(['POST'])
@permission_classes([IsAdmin])
def pairing_reject(request, pairing_id):
    from history.logging import log_action

    try:
        pairing = PendingPairing.objects.get(pk=pairing_id, status='pending')
    except (PendingPairing.DoesNotExist, ValueError, TypeError):
        return Response({'error': 'Pending pairing request not found.'}, status=404)

    pairing.status = 'rejected'
    pairing.approved_by = request.user
    pairing.approved_at = timezone.now()
    pairing.save(update_fields=['status', 'approved_by', 'approved_at'])

    log_action(request, 'pairing_reject', 'player', target_name=pairing.device_name or pairing.pairing_code)
    return Response({'success': True})
