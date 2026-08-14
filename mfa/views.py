import base64
import io
import logging

import pyotp
import qrcode
from django.utils import timezone
from qrcode.image.pil import PilImage
from rest_framework.decorators import api_view
from rest_framework.response import Response

from . import duo
from .models import DuoEnrollment, TOTPDevice

logger = logging.getLogger(__name__)

_ISSUER = 'MupiTech Fleet Manager'


def _qr_png_base64(otpauth_uri):
    img = qrcode.make(otpauth_uri, image_factory=PilImage)
    buf = io.BytesIO()
    img.save(buf, format='PNG')
    return base64.b64encode(buf.getvalue()).decode()


@api_view(['GET'])
def mfa_status(request):
    device = getattr(request.user, 'totp_device', None)
    return Response({
        'enabled': bool(device and device.confirmed),
        'confirmed_at': device.confirmed_at if device and device.confirmed else None,
    })


@api_view(['POST'])
def mfa_enroll(request):
    existing = getattr(request.user, 'totp_device', None)
    if existing and existing.confirmed:
        return Response(
            {'error': 'MFA is already enabled — disable it first to re-enroll.'},
            status=400,
        )

    secret = pyotp.random_base32()
    device, _ = TOTPDevice.objects.update_or_create(
        user=request.user,
        defaults={'confirmed': False, 'confirmed_at': None},
    )
    device.set_secret(secret)
    device.save()

    otpauth_uri = pyotp.TOTP(secret).provisioning_uri(
        name=request.user.username, issuer_name=_ISSUER,
    )
    return Response({
        'otpauth_uri': otpauth_uri,
        'qr_png_base64': _qr_png_base64(otpauth_uri),
    })


@api_view(['POST'])
def mfa_confirm(request):
    from history.logging import log_action

    device = getattr(request.user, 'totp_device', None)
    if not device or device.confirmed:
        return Response({'error': 'No pending MFA enrolment.'}, status=400)

    code = str(request.data.get('code', ''))
    if not pyotp.TOTP(device.get_secret()).verify(code, valid_window=1):
        return Response({'error': 'Invalid code.'}, status=400)

    device.confirmed = True
    device.confirmed_at = timezone.now()
    device.save(update_fields=['confirmed', 'confirmed_at'])
    log_action(request, 'mfa_enable', 'session', target_name=request.user.username)
    return Response({'success': True})


@api_view(['POST'])
def mfa_disable(request):
    from history.logging import log_action

    if not request.user.check_password(request.data.get('password', '')):
        return Response({'error': 'Incorrect password.'}, status=400)

    TOTPDevice.objects.filter(user=request.user).delete()
    log_action(request, 'mfa_disable', 'session', target_name=request.user.username)
    return Response({'success': True})


@api_view(['GET'])
def duo_status(request):
    return Response({
        'configured': duo.duo_configured(),
        'enabled': DuoEnrollment.objects.filter(user=request.user, confirmed=True).exists(),
    })


@api_view(['POST'])
def duo_enroll(request):
    if not duo.duo_configured():
        return Response({'error': 'Duo is not configured on this Fleet Manager instance.'}, status=400)
    existing = getattr(request.user, 'duo_enrollment', None)
    if existing and existing.confirmed:
        return Response(
            {'error': 'Duo push is already enabled — disable it first to re-enroll.'},
            status=400,
        )

    try:
        result = duo.start_enrollment(request.user.username)
    except duo.DuoNotConfiguredError as exc:
        return Response({'error': str(exc)}, status=400)
    except Exception as exc:
        logger.warning('Duo enroll failed for %s: %s', request.user.username, exc)
        return Response({'error': "Couldn't reach Duo — try again shortly."}, status=502)

    DuoEnrollment.objects.update_or_create(
        user=request.user,
        defaults={
            'duo_user_id': result['user_id'],
            'duo_username': result['username'],
            'activation_code': result['activation_code'],
            'confirmed': False,
            'confirmed_at': None,
        },
    )
    return Response({
        'activation_barcode': result['activation_barcode'],
        'expiration': result['expiration'],
    })


@api_view(['POST'])
def duo_confirm(request):
    """Poll Duo for whether the operator has finished scanning the QR
    in Duo Mobile yet — the frontend calls this repeatedly (the scan
    itself happens entirely on Duo's side, there's no code to submit)."""
    from history.logging import log_action

    enrollment = getattr(request.user, 'duo_enrollment', None)
    if not enrollment or enrollment.confirmed:
        return Response({'error': 'No pending Duo enrolment.'}, status=400)

    try:
        status = duo.check_enrollment_status(enrollment.duo_user_id, enrollment.activation_code)
    except Exception as exc:
        logger.warning('Duo enroll_status failed for %s: %s', request.user.username, exc)
        return Response({'error': "Couldn't reach Duo — try again shortly."}, status=502)

    if status == 'waiting':
        return Response({'status': 'waiting'})
    if status == 'invalid':
        enrollment.delete()
        return Response({'error': 'Enrollment code expired — start again.'}, status=400)

    enrollment.confirmed = True
    enrollment.confirmed_at = timezone.now()
    enrollment.activation_code = ''
    enrollment.save(update_fields=['confirmed', 'confirmed_at', 'activation_code'])
    log_action(request, 'duo_enable', 'session', target_name=request.user.username)
    return Response({'status': 'success'})


@api_view(['POST'])
def duo_disable(request):
    from history.logging import log_action

    if not request.user.check_password(request.data.get('password', '')):
        return Response({'error': 'Incorrect password.'}, status=400)

    DuoEnrollment.objects.filter(user=request.user).delete()
    log_action(request, 'duo_disable', 'session', target_name=request.user.username)
    return Response({'success': True})
