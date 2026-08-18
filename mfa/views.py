import base64
import io
import logging

import pyotp
import qrcode
from django.utils import timezone
from qrcode.image.pil import PilImage
from rest_framework.decorators import api_view, permission_classes
from rest_framework.response import Response

from fleet_manager.permissions import IsAdmin, _user_role

from . import duo, email_otp, privacyidea, provider_config
from .models import DuoEnrollment, EmailOTPDevice, MFAPolicy, PrivacyIDEAEnrollment, TOTPDevice
from .providers import enrolled_methods

logger = logging.getLogger(__name__)

_ISSUER = 'MupiTech Fleet Manager'


def _clear_force_mfa_enroll(user):
    """Clears the onboarding 'must enrol MFA' flag once any method (TOTP
    or Duo) gets confirmed — set at user creation, see access/models.py."""
    from access.models import UserAccessScope
    UserAccessScope.objects.filter(user=user, force_mfa_enroll=True).update(force_mfa_enroll=False)


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
    _clear_force_mfa_enroll(request.user)
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
def email_otp_status(request):
    device = getattr(request.user, 'email_otp_device', None)
    return Response({
        'configured': email_otp.email_otp_configured(),
        'enabled': bool(device and device.confirmed),
        'email': request.user.email,
    })


@api_view(['POST'])
def email_otp_enroll(request):
    if not email_otp.email_otp_configured():
        return Response({'error': 'Email sending is not configured on this Fleet Manager instance.'}, status=400)
    if not request.user.email:
        return Response({'error': 'Your account has no email address set.'}, status=400)
    existing = getattr(request.user, 'email_otp_device', None)
    if existing and existing.confirmed:
        return Response(
            {'error': 'Email codes are already enabled — disable it first to re-enroll.'},
            status=400,
        )

    code = email_otp.generate_code()
    if not email_otp.send_code_email(request.user, code):
        return Response({'error': "Couldn't send the email — try again shortly."}, status=502)

    EmailOTPDevice.objects.update_or_create(
        user=request.user,
        defaults={
            'confirmed': False,
            'confirmed_at': None,
            'pending_code_hash': email_otp.hash_code(code),
            'pending_code_expires_at': timezone.now() + timezone.timedelta(seconds=email_otp.CODE_TTL_SECONDS),
        },
    )
    return Response({'success': True, 'email': request.user.email})


@api_view(['POST'])
def email_otp_confirm(request):
    from history.logging import log_action

    device = getattr(request.user, 'email_otp_device', None)
    if not device or device.confirmed:
        return Response({'error': 'No pending email OTP enrolment.'}, status=400)
    if not device.pending_code_expires_at or timezone.now() > device.pending_code_expires_at:
        return Response({'error': 'The code has expired — request a new one.'}, status=400)

    code = str(request.data.get('code', ''))
    if not email_otp.code_matches(code, device.pending_code_hash):
        return Response({'error': 'Invalid code.'}, status=400)

    device.confirmed = True
    device.confirmed_at = timezone.now()
    device.pending_code_hash = ''
    device.pending_code_expires_at = None
    device.save(update_fields=['confirmed', 'confirmed_at', 'pending_code_hash', 'pending_code_expires_at'])
    _clear_force_mfa_enroll(request.user)
    log_action(request, 'email_otp_enable', 'session', target_name=request.user.username)
    return Response({'success': True})


@api_view(['POST'])
def email_otp_disable(request):
    from history.logging import log_action

    if not request.user.check_password(request.data.get('password', '')):
        return Response({'error': 'Incorrect password.'}, status=400)

    EmailOTPDevice.objects.filter(user=request.user).delete()
    log_action(request, 'email_otp_disable', 'session', target_name=request.user.username)
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
    _clear_force_mfa_enroll(request.user)
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


@api_view(['GET'])
def privacyidea_status(request):
    enrollment = getattr(request.user, 'privacyidea_enrollment', None)
    return Response({
        'configured': privacyidea.privacyidea_configured(),
        'enabled': bool(enrollment and enrollment.confirmed),
        'token_type': enrollment.token_type if enrollment and enrollment.confirmed else None,
    })


@api_view(['POST'])
def privacyidea_enroll(request):
    if not privacyidea.privacyidea_configured():
        return Response({'error': 'privacyIDEA is not configured on this Fleet Manager instance.'}, status=400)
    existing = getattr(request.user, 'privacyidea_enrollment', None)
    if existing and existing.confirmed:
        return Response(
            {'error': 'privacyIDEA is already enabled — disable it first to re-enroll.'},
            status=400,
        )

    token_type = request.data.get('token_type', 'totp')
    if token_type not in ('totp', 'push'):
        return Response({'error': 'Invalid token_type.'}, status=400)

    try:
        result = privacyidea.start_enrollment(request.user.username, request.user.email, token_type)
    except privacyidea.PrivacyIDEAError as exc:
        logger.warning('privacyIDEA enroll failed for %s: %s', request.user.username, exc)
        return Response({'error': "Couldn't reach privacyIDEA — try again shortly."}, status=502)

    PrivacyIDEAEnrollment.objects.update_or_create(
        user=request.user,
        defaults={'serial': result['serial'], 'token_type': token_type, 'confirmed': False, 'confirmed_at': None},
    )
    return Response({
        'otpauth_uri': result['otpauth_uri'],
        'qr_png_base64': _qr_png_base64(result['otpauth_uri']),
    })


@api_view(['POST'])
def privacyidea_confirm(request):
    """For a 'totp' enrolment, checks the typed `code` — unchanged from
    before. For a 'push' enrolment there's no code: the frontend polls
    this repeatedly (same pattern as mfa/views.py::duo_confirm) until
    the privacyIDEA Authenticator app finishes its own registration,
    reported here as {'status': 'waiting'} vs the {'success': True}
    both paths return once actually confirmed."""
    from history.logging import log_action

    enrollment = getattr(request.user, 'privacyidea_enrollment', None)
    if not enrollment or enrollment.confirmed:
        return Response({'error': 'No pending privacyIDEA enrolment.'}, status=400)

    if enrollment.token_type == 'push':
        try:
            active = privacyidea.check_push_rollout(enrollment.serial)
        except privacyidea.PrivacyIDEAError as exc:
            logger.warning('privacyIDEA push rollout check failed for %s: %s', request.user.username, exc)
            return Response({'error': "Couldn't reach privacyIDEA — try again shortly."}, status=502)
        if not active:
            return Response({'status': 'waiting'})
    else:
        code = str(request.data.get('code', ''))
        try:
            valid = privacyidea.verify(request.user.username, code)
        except privacyidea.PrivacyIDEAError as exc:
            logger.warning('privacyIDEA verify failed for %s: %s', request.user.username, exc)
            return Response({'error': "Couldn't reach privacyIDEA — try again shortly."}, status=502)
        if not valid:
            return Response({'error': 'Invalid code.'}, status=400)

    enrollment.confirmed = True
    enrollment.confirmed_at = timezone.now()
    enrollment.save(update_fields=['confirmed', 'confirmed_at'])
    _clear_force_mfa_enroll(request.user)
    log_action(request, 'privacyidea_enable', 'session', target_name=request.user.username)
    return Response({'success': True})


@api_view(['GET'])
@permission_classes([IsAdmin])
def provider_config_status(request):
    """Admin-only: current merged (DB override + env var fallback)
    config for every MFA provider that supports Settings-managed
    credentials — what the Settings UI's "MFA Providers" panel reads
    to render each card. Secret fields never come back as plaintext,
    see provider_config.status_for_ui()."""
    return Response({
        provider: provider_config.status_for_ui(provider)
        for provider in provider_config.FIELDS
    })


@api_view(['POST'])
@permission_classes([IsAdmin])
def provider_config_save(request, provider):
    from history.logging import log_action

    if provider not in provider_config.FIELDS:
        return Response({'error': 'Unknown provider.'}, status=404)

    provider_config.save_config(provider, request.data, updated_by=request.user)
    log_action(request, 'mfa_provider_config_save', 'session', target_name=provider)
    return Response(provider_config.status_for_ui(provider))


@api_view(['GET'])
def dual_mfa_status(request):
    """Everything the Security settings page needs to render the dual-MFA
    card: whether an admin-set role policy already forces it on this
    user (read-only from here, only an admin can change it — see
    dual_mfa_policy_save), the user's own opt-in, and whether they
    currently have enough (2+) confirmed providers for either to
    actually take effect at login. Admins additionally get the full
    role list back so the same call can drive the admin policy editor."""
    scope = getattr(request.user, 'access_scope', None)
    payload = {
        'self_opt_in': bool(scope and scope.require_dual_mfa),
        'role_required': _user_role(request.user) in MFAPolicy.get().require_dual_roles,
        'eligible': len(enrolled_methods(request.user)) >= 2,
    }
    if _user_role(request.user) in ('admin', 'superadmin'):
        payload['require_dual_roles'] = MFAPolicy.get().require_dual_roles
    return Response(payload)


@api_view(['POST'])
def dual_mfa_self_toggle(request):
    """Self-service opt-in/out — any authenticated user, no password
    reproof needed since this only ever makes login *stricter* for
    themselves, never weaker (unlike mfa_disable/duo_disable/
    privacyidea_disable, which all require the current password since
    they remove a factor)."""
    from access.models import UserAccessScope
    from history.logging import log_action

    enabled = bool(request.data.get('enabled'))
    scope, _ = UserAccessScope.objects.get_or_create(user=request.user)
    scope.require_dual_mfa = enabled
    scope.save(update_fields=['require_dual_mfa'])
    log_action(request, 'dual_mfa_self_toggle', 'session',
               target_name=request.user.username, details={'enabled': enabled})
    return Response({'success': True, 'self_opt_in': enabled})


@api_view(['POST'])
@permission_classes([IsAdmin])
def dual_mfa_policy_save(request):
    """Admin-only: which roles must always pass two MFA challenges to
    log in. See mfa/policy.py::dual_mfa_required for how this combines
    with each user's own self_opt_in above."""
    from history.logging import log_action

    roles = request.data.get('require_dual_roles', [])
    valid_roles = {'viewer', 'editor_simplificado', 'editor', 'admin', 'superadmin'}
    if not isinstance(roles, list) or not set(roles) <= valid_roles:
        return Response({'error': 'require_dual_roles must be a list of valid role names.'}, status=400)

    policy = MFAPolicy.get()
    policy.require_dual_roles = roles
    policy.updated_by = request.user
    policy.save(update_fields=['require_dual_roles', 'updated_by', 'updated_at'])
    log_action(request, 'dual_mfa_policy_save', 'session', details={'require_dual_roles': roles})
    return Response({'require_dual_roles': policy.require_dual_roles})


@api_view(['POST'])
def privacyidea_disable(request):
    from history.logging import log_action

    if not request.user.check_password(request.data.get('password', '')):
        return Response({'error': 'Incorrect password.'}, status=400)

    enrollment = getattr(request.user, 'privacyidea_enrollment', None)
    if enrollment:
        try:
            privacyidea.delete_token(enrollment.serial)
        except privacyidea.PrivacyIDEAError as exc:
            # Still remove our own record — a token privacyIDEA fails to
            # delete but that no longer verifies against anything on our
            # side is inert either way, and the operator shouldn't be
            # stuck unable to disable MFA because privacyIDEA is briefly
            # unreachable.
            logger.warning('privacyIDEA token deletion failed for %s: %s', request.user.username, exc)
        enrollment.delete()
    log_action(request, 'privacyidea_disable', 'session', target_name=request.user.username)
    return Response({'success': True})
