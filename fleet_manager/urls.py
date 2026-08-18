import json
import logging

from django.conf import settings
from django.contrib import admin
from django.contrib.auth import authenticate, login, logout
from django.contrib.auth.decorators import login_required
from django.core.exceptions import ValidationError
from django.http import JsonResponse
from django.shortcuts import get_object_or_404, render
from django.urls import include, path, re_path
from django.views.decorators.http import require_POST
from django.views.generic import TemplateView
from django.views.static import serve
from rest_framework.authtoken.views import obtain_auth_token
from django_ratelimit.decorators import ratelimit
from rest_framework.decorators import api_view, permission_classes
from rest_framework.permissions import AllowAny
from rest_framework.response import Response

logger = logging.getLogger(__name__)


def _client_ip(request):
    """Real end-user IP behind nginx's reverse proxy — same precedence
    history/logging.py's own audit-log extraction already uses.
    REMOTE_ADDR alone would always be nginx's own address."""
    return (
        request.META.get('HTTP_X_FORWARDED_FOR', '').split(',')[0].strip()
        or request.META.get('REMOTE_ADDR')
    )

from rest_framework.routers import DefaultRouter

from fleet_manager.permissions import _user_role
from fleet_manager.system_views import (
    alert_settings,
    alert_test_email,
    alert_test_offline_email,
    branding_delete_logo,
    branding_delete_standby,
    branding_push_all,
    branding_settings,
    branding_upload_logo,
    branding_upload_standby,
    editor_permissions,
    fm_theme_delete_partner_logo,
    fm_theme_settings,
    fm_theme_upload_partner_logo,
    registry_settings,
    registry_sync,
    registry_sync_status,
    run_setup,
    setup_required,
    system_features,
    system_settings,
    system_telemetry,
    system_update,
    system_update_check,
    system_version,
    tailscale_settings,
)
from fleet_manager.user_views import UserViewSet
from fleet_manager.weather_view import weather_widget

user_router = DefaultRouter()
user_router.register('users', UserViewSet)


# Every @ratelimit below takes an explicit group= — django-ratelimit
# defaults the group to the decorated callable's own __qualname__ when
# omitted, but @api_view's as_view() doesn't preserve that (every
# function-based DRF view here resolves to the same generic
# 'View.as_view.<locals>.view', confirmed by printing it directly).
# Without group=, any two views sharing the same key type + rate string
# silently share one rate-limit bucket instead of getting their own —
# e.g. auth_login and auth_password_reset_request both used to be
# key='ip', rate='5/m', so exhausting one exhausted the other. Each
# group= here is just the view's own name, which is guaranteed unique
# within this module.
@ratelimit(group='auth_login', key='ip', rate='5/m', method='POST', block=True)
@api_view(['POST'])
@permission_classes([AllowAny])
def auth_login(request):
    from history.logging import log_action
    from mfa.policy import dual_mfa_required
    from mfa.providers import enrolled_methods, push_methods

    data = request.data
    user = authenticate(
        request,
        username=data.get('username'),
        password=data.get('password'),
    )
    if user is not None:
        # available_methods is every provider (see mfa/providers.py) this
        # user has a confirmed enrollment with, in priority order — push
        # methods first, since they're a single tap with no code to type.
        # Whichever fires, do NOT call login() yet: that would establish
        # a real session on password alone and defeat MFA. The challenge
        # lives in the (Redis-backed) cache, not a signed token: a signed
        # token isn't single-use without a shared store anyway (need
        # somewhere to record "already consumed"), and a cache entry
        # gives that for free via cache.delete() in the matching verify
        # endpoint.
        available_methods = enrolled_methods(user)
        if available_methods:
            import secrets

            from django.core.cache import cache

            method = available_methods[0]
            # dual_required only actually applies with 2+ enrolled
            # providers — a policy demanding two factors degrades to one
            # for a user who's only ever set up a single method, rather
            # than locking them out entirely (see mfa/policy.py).
            dual_required = dual_mfa_required(user) and len(available_methods) >= 2
            # Every provider's own verify endpoint only ever looks at
            # entry['user_id'] — none check 'method' — so the same
            # challenge_id already works for any of them. available_methods
            # just tells the frontend what it's allowed to offer as a
            # "use a different method" switch when a user has more than
            # one enrolled.
            challenge_id = secrets.token_urlsafe(32)
            cache.set(
                f'mfa_challenge:{challenge_id}',
                {
                    'user_id': user.id, 'attempts': 0, 'method': method,
                    'dual_required': dual_required, 'passed_methods': [],
                },
                timeout=300,
            )
            return Response({
                'mfa_required': True,
                'stage': 1,
                'challenge_id': challenge_id,
                'method': method,
                'available_methods': available_methods,
                'push_methods': push_methods(user),
                'dual_required': dual_required,
            })
        login(request, user)
        log_action(request, 'login', 'session', target_name=user.username)
        return Response({'success': True, 'username': user.username})
    log_action(request, 'login_failed', 'session', target_name=data.get('username', ''))
    return Response(
        {'detail': 'Invalid credentials'},
        status=401,
    )


@ratelimit(group='auth_mfa_verify', key='ip', rate='10/m', method='POST', block=True)
@ratelimit(group='auth_mfa_verify', key='post:challenge_id', rate='8/5m', method='POST', block=True)
@api_view(['POST'])
@permission_classes([AllowAny])
def auth_mfa_verify(request):
    import pyotp
    from django.core.cache import cache

    from history.logging import log_action
    from mfa.challenge import register_factor_success
    from mfa.models import TOTPDevice

    challenge_id = request.data.get('challenge_id', '')
    cache_key = f'mfa_challenge:{challenge_id}'
    entry = cache.get(cache_key)
    if not entry:
        return Response({'detail': 'Challenge expired or invalid — please log in again.'}, status=400)

    device = TOTPDevice.objects.filter(user_id=entry['user_id'], confirmed=True).first()
    code = str(request.data.get('code', ''))
    if device and pyotp.TOTP(device.get_secret()).verify(code, valid_window=1):
        return register_factor_success(request, challenge_id, entry, 'totp')

    # Wrong code: bump the attempt counter and drop the challenge after a
    # few failures so a caller can't keep guessing against the same
    # challenge_id forever even from a fresh IP (the rate limits above
    # only bound a single IP / a single challenge_id's *request rate*,
    # not the total number of guesses across sources).
    entry['attempts'] += 1
    if entry['attempts'] >= 5:
        cache.delete(cache_key)
    else:
        cache.set(cache_key, entry, timeout=300)
    log_action(request, 'login_failed', 'session', details={'mfa': True})
    return Response({'detail': 'Invalid code.'}, status=401)


@ratelimit(group='auth_privacyidea_verify', key='ip', rate='10/m', method='POST', block=True)
@ratelimit(group='auth_privacyidea_verify', key='post:challenge_id', rate='8/5m', method='POST', block=True)
@api_view(['POST'])
@permission_classes([AllowAny])
def auth_privacyidea_verify(request):
    """Companion to auth_mfa_verify for the privacyIDEA case — same
    challenge/cache mechanics, just checks the code against privacyIDEA's
    own /validate/check instead of a locally-stored TOTP secret."""
    from django.core.cache import cache

    from history.logging import log_action
    from mfa import privacyidea
    from mfa.challenge import register_factor_success
    from mfa.models import PrivacyIDEAEnrollment

    challenge_id = request.data.get('challenge_id', '')
    cache_key = f'mfa_challenge:{challenge_id}'
    entry = cache.get(cache_key)
    if not entry:
        return Response({'detail': 'Challenge expired or invalid — please log in again.'}, status=400)

    enrollment = PrivacyIDEAEnrollment.objects.filter(user_id=entry['user_id'], confirmed=True).first()
    code = str(request.data.get('code', ''))
    if enrollment:
        try:
            valid = privacyidea.verify(enrollment.user.username, code)
        except privacyidea.PrivacyIDEAError as exc:
            logger.warning('privacyIDEA login verify failed: %s', exc)
            return Response({'detail': "Couldn't reach privacyIDEA — try again shortly."}, status=502)
        if valid:
            return register_factor_success(request, challenge_id, entry, 'privacyidea')

    # Same attempt-counter pattern as auth_mfa_verify.
    entry['attempts'] += 1
    if entry['attempts'] >= 5:
        cache.delete(cache_key)
    else:
        cache.set(cache_key, entry, timeout=300)
    log_action(request, 'login_failed', 'session', details={'mfa': 'privacyidea'})
    return Response({'detail': 'Invalid code.'}, status=401)


@ratelimit(group='auth_duo_verify', key='ip', rate='10/m', method='POST', block=True)
@ratelimit(group='auth_duo_verify', key='post:challenge_id', rate='5/5m', method='POST', block=True)
@api_view(['POST'])
@permission_classes([AllowAny])
def auth_duo_verify(request):
    """Companion to auth_mfa_verify for the Duo-push case: no code to
    check, this just triggers the push and blocks (up to Duo's own
    ~60s default) until the operator approves/denies or it times out —
    see mfa/duo.py::push_auth. Rate limits are looser than the TOTP
    verify's since there's no code to brute-force here; they exist
    purely to stop someone spamming push notifications at a user."""
    from django.core.cache import cache

    from history.logging import log_action
    from mfa import duo
    from mfa.challenge import register_factor_success
    from mfa.models import DuoEnrollment

    challenge_id = request.data.get('challenge_id', '')
    cache_key = f'mfa_challenge:{challenge_id}'
    entry = cache.get(cache_key)
    if not entry:
        return Response({'detail': 'Challenge expired or invalid — please log in again.'}, status=400)

    enrollment = DuoEnrollment.objects.filter(user_id=entry['user_id'], confirmed=True).first()
    if not enrollment:
        cache.delete(cache_key)
        return Response({'detail': 'Duo push is not set up for this account.'}, status=400)

    try:
        result = duo.push_auth(enrollment.duo_user_id, ipaddr=_client_ip(request))
    except Exception as exc:
        logger.warning('Duo push_auth failed: %s', exc)
        return Response({'detail': "Couldn't reach Duo — try again."}, status=502)

    if result.get('result') == 'allow':
        return register_factor_success(request, challenge_id, entry, 'duo')

    if result.get('status') == 'timeout':
        # Let the frontend retry (send another push) without forcing a
        # fresh password entry — the challenge is still good.
        log_action(request, 'login_failed', 'session', details={'mfa': 'duo', 'status': 'timeout'})
        return Response({'detail': 'timeout', 'status_msg': result.get('status_msg', '')}, status=401)

    # Explicit deny (or any other terminal state) — deliberately does
    # NOT delete the shared challenge_id: a user with more than one
    # method enrolled (e.g. Duo *and* privacyIDEA) needs it to survive
    # so switchMethod() in login.tsx can still verify against it. This
    # used to delete it here, which meant Duo denying/timing out first
    # (it's the default/first-priority method) silently broke every
    # other enrolled method for the rest of that login attempt — the
    # challenge just looked "expired" no matter what the user tried
    # next. The challenge's own 300s TTL (auth_login) and the
    # post:challenge_id rate limit above are what actually bound this.
    log_action(request, 'login_failed', 'session', details={'mfa': 'duo', 'status': result.get('status')})
    return Response({'detail': 'denied', 'status_msg': result.get('status_msg', '')}, status=401)


@ratelimit(group='auth_privacyidea_push_verify', key='ip', rate='10/m', method='POST', block=True)
@ratelimit(group='auth_privacyidea_push_verify', key='post:challenge_id', rate='5/5m', method='POST', block=True)
@api_view(['POST'])
@permission_classes([AllowAny])
def auth_privacyidea_push_verify(request):
    """Companion to auth_duo_verify for a privacyIDEA push enrolment —
    same shape (one blocking call, retry-on-timeout), but implemented
    as our own poll loop underneath since privacyIDEA's /validate/check
    returns immediately with a transaction_id rather than blocking on
    its own infrastructure like Duo's /auth does — see
    mfa/privacyidea.py::trigger_and_wait_push."""
    from django.core.cache import cache

    from history.logging import log_action
    from mfa import privacyidea
    from mfa.challenge import register_factor_success
    from mfa.models import PrivacyIDEAEnrollment

    challenge_id = request.data.get('challenge_id', '')
    cache_key = f'mfa_challenge:{challenge_id}'
    entry = cache.get(cache_key)
    if not entry:
        return Response({'detail': 'Challenge expired or invalid — please log in again.'}, status=400)

    enrollment = PrivacyIDEAEnrollment.objects.filter(
        user_id=entry['user_id'], confirmed=True, token_type='push',
    ).first()
    if not enrollment:
        cache.delete(cache_key)
        return Response({'detail': 'privacyIDEA push is not set up for this account.'}, status=400)

    try:
        result = privacyidea.trigger_and_wait_push(enrollment.user.username)
    except privacyidea.PrivacyIDEAError as exc:
        logger.warning('privacyIDEA push verify failed: %s', exc)
        return Response({'detail': "Couldn't reach privacyIDEA — try again."}, status=502)

    if result.get('result') == 'allow':
        return register_factor_success(request, challenge_id, entry, 'privacyidea', log_label='privacyidea-push')

    if result.get('result') == 'timeout':
        log_action(request, 'login_failed', 'session', details={'mfa': 'privacyidea-push', 'status': 'timeout'})
        return Response({'detail': 'timeout'}, status=401)

    # Same reasoning as auth_duo_verify's deny branch above — don't
    # delete the shared challenge on a deny, or switching to another
    # enrolled method afterward breaks with a false "expired" error.
    log_action(request, 'login_failed', 'session', details={'mfa': 'privacyidea-push', 'status': 'denied'})
    return Response({'detail': 'denied'}, status=401)


@ratelimit(group='auth_email_otp_send', key='ip', rate='10/m', method='POST', block=True)
@ratelimit(group='auth_email_otp_send', key='post:challenge_id', rate='3/5m', method='POST', block=True)
@api_view(['POST'])
@permission_classes([AllowAny])
def auth_email_otp_send(request):
    """Triggers (or re-triggers, via a 'resend' action) an email-OTP
    challenge — the side-effecting half of the email method, companion
    to auth_duo_verify/auth_privacyidea_push_verify in that sense, but
    it doesn't block waiting for approval: it just emails a fresh code
    and lets the frontend fall through to the normal code-entry UI,
    checked by auth_email_otp_verify below. The code's hash is stashed
    in the shared challenge cache entry (not on EmailOTPDevice) so it's
    scoped to this one login attempt and expires with the challenge's
    own TTL — nothing extra to clean up."""
    from django.core.cache import cache

    from mfa import email_otp
    from mfa.models import EmailOTPDevice

    challenge_id = request.data.get('challenge_id', '')
    cache_key = f'mfa_challenge:{challenge_id}'
    entry = cache.get(cache_key)
    if not entry:
        return Response({'detail': 'Challenge expired or invalid — please log in again.'}, status=400)

    device = EmailOTPDevice.objects.filter(user_id=entry['user_id'], confirmed=True).select_related('user').first()
    if not device:
        return Response({'detail': 'Email codes are not set up for this account.'}, status=400)

    code = email_otp.generate_code()
    if not email_otp.send_code_email(device.user, code):
        return Response({'detail': "Couldn't send the email — try again shortly."}, status=502)

    entry['email_code_hash'] = email_otp.hash_code(code)
    cache.set(cache_key, entry, timeout=300)
    return Response({'sent': True})


@ratelimit(group='auth_email_otp_verify', key='ip', rate='10/m', method='POST', block=True)
@ratelimit(group='auth_email_otp_verify', key='post:challenge_id', rate='8/5m', method='POST', block=True)
@api_view(['POST'])
@permission_classes([AllowAny])
def auth_email_otp_verify(request):
    """Companion to auth_mfa_verify for the email-OTP case — same
    attempt-counter mechanics, checking the code's hash stashed in the
    challenge entry by auth_email_otp_send above instead of a
    pre-shared secret."""
    from django.core.cache import cache

    from history.logging import log_action
    from mfa import email_otp
    from mfa.challenge import register_factor_success

    challenge_id = request.data.get('challenge_id', '')
    cache_key = f'mfa_challenge:{challenge_id}'
    entry = cache.get(cache_key)
    if not entry:
        return Response({'detail': 'Challenge expired or invalid — please log in again.'}, status=400)

    code = str(request.data.get('code', ''))
    if email_otp.code_matches(code, entry.get('email_code_hash', '')):
        return register_factor_success(request, challenge_id, entry, 'email')

    # Same attempt-counter pattern as auth_mfa_verify.
    entry['attempts'] += 1
    if entry['attempts'] >= 5:
        cache.delete(cache_key)
    else:
        cache.set(cache_key, entry, timeout=300)
    log_action(request, 'login_failed', 'session', details={'mfa': 'email'})
    return Response({'detail': 'Invalid code.'}, status=401)


@ratelimit(group='auth_device_login', key='ip', rate='20/m', method='POST', block=True)
@ratelimit(group='auth_device_login', key='post:player_id', rate='10/m', method='POST', block=True)
@api_view(['POST'])
@permission_classes([AllowAny])
def auth_device_login(request):
    """Verifies Fleet Manager credentials typed directly into a device's
    own login page (as opposed to the FM-initiated SSO button, which
    signs a token the other direction — see players/sso.py). Does NOT
    establish a session here; the device is the one logging someone in
    locally, this just answers "are these FM credentials valid, and for
    what role" using the same per-device shared secret SSO already
    provisions (proves the caller really is that device, not just
    anyone on the LAN guessing passwords against this endpoint).

    An MFA-enrolled user gets the same {mfa_required, challenge_id, ...}
    shape auth_login returns — the device's own login page relays this
    into its own challenge/verify screen, then calls the *same* verify
    endpoints below (auth_mfa_verify / auth_duo_verify / etc.) a browser
    would. Those endpoints special-case a challenge created here (see
    the 'device_login' cache flag) to skip establishing an FM session
    and return the role instead — see mfa/challenge.py.
    """
    from django.core import signing
    from django.core.cache import cache

    from history.logging import log_action
    from mfa.policy import dual_mfa_required
    from mfa.providers import enrolled_methods, push_methods
    from players.models import Player
    from players.sso import DEVICE_AUTH_PROOF_MAX_AGE, DEVICE_AUTH_PROOF_SALT

    player_id = request.data.get('player_id', '')
    proof = request.data.get('proof', '')
    username = request.data.get('username', '')
    password = request.data.get('password', '')

    try:
        player = Player.objects.get(pk=player_id)
    except (Player.DoesNotExist, ValueError, ValidationError):
        return Response({'detail': 'Invalid device.'}, status=400)

    secret = player.get_sso_secret()
    if not secret:
        return Response({'detail': 'Invalid device.'}, status=400)

    try:
        payload = signing.loads(proof, key=secret, salt=DEVICE_AUTH_PROOF_SALT, max_age=DEVICE_AUTH_PROOF_MAX_AGE)
    except signing.BadSignature:
        return Response({'detail': 'Invalid device.'}, status=400)
    if payload.get('player_id') != str(player.id):
        return Response({'detail': 'Invalid device.'}, status=400)

    # Same brute-force counter pattern as auth_mfa_verify — bounds total
    # guesses against one username from this device beyond what the
    # per-minute rate limits above already restrict.
    attempts_key = f'device_login_attempts:{player.id}:{username}'
    if cache.get(attempts_key, 0) >= 8:
        return Response({'detail': 'Too many attempts — try again later.'}, status=429)

    user = authenticate(request, username=username, password=password)
    if user is None:
        cache.set(attempts_key, cache.get(attempts_key, 0) + 1, timeout=300)
        log_action(request, 'login_failed', 'session', target_name=username,
                   details={'via': 'device_login', 'player': player.name})
        return Response({'detail': 'Invalid credentials.'}, status=401)

    methods = enrolled_methods(user)
    if methods:
        import secrets

        dual_required = dual_mfa_required(user) and len(methods) >= 2
        method = methods[0]
        challenge_id = secrets.token_urlsafe(32)
        cache.set(
            f'mfa_challenge:{challenge_id}',
            {
                'user_id': user.id, 'attempts': 0, 'method': method,
                'dual_required': dual_required, 'passed_methods': [],
                'device_login': True,
            },
            timeout=300,
        )
        return Response({
            'mfa_required': True,
            'stage': 1,
            'challenge_id': challenge_id,
            'method': method,
            'available_methods': methods,
            'push_methods': push_methods(user),
            'dual_required': dual_required,
        })

    cache.delete(attempts_key)
    log_action(request, 'login', 'session', target_name=user.username,
               details={'via': 'device_login', 'player': player.name})
    return Response({'success': True, 'username': user.username, 'role': _user_role(user)})


@api_view(['POST'])
def auth_logout(request):
    from history.logging import log_action
    log_action(request, 'logout', 'session', target_name=request.user.username)
    logout(request)
    return Response({'success': True})


@api_view(['GET'])
@permission_classes([AllowAny])
def auth_status(request):
    if request.user.is_authenticated:
        return Response({
            'authenticated': True,
            'username': request.user.username,
            'role': _user_role(request.user),
        })
    return Response({'authenticated': False})


def _send_password_reset_email(request, user):
    from django.contrib.auth.tokens import default_token_generator
    from django.utils.encoding import force_bytes
    from django.utils.http import urlsafe_base64_encode

    from fleet_manager.alerts import is_email_configured, send_email
    from fleet_manager.email_branding import branded_email_html

    if not is_email_configured():
        logger.warning('Password reset requested for %s but email is not configured.', user.username)
        return

    uid = urlsafe_base64_encode(force_bytes(user.pk))
    token = default_token_generator.make_token(user)
    origin = f'{request.scheme}://{request.get_host()}'
    reset_url = f'{origin}/reset-password?uid={uid}&token={token}'

    subject = '[MupiTech] Redefinir password'
    text_body = (
        f'Foi pedida uma redefinição de password para a conta {user.username}.\n\n'
        f'Se foi você, aceda a este link para definir uma nova password (válido por algumas horas):\n{reset_url}\n\n'
        'Se não foi você, pode ignorar este email — a sua password mantém-se inalterada.'
    )
    intro_html = (
        f'<p style="margin:0 0 16px 0;font-size:14px;color:#4b5563;">'
        f'Foi pedida uma redefinição de password para a conta <strong>{user.username}</strong>. '
        f'Se foi você, clique no botão abaixo para definir uma nova password. O link é válido por algumas horas.</p>'
        f'<p style="margin:0 0 16px 0;">'
        f'<a href="{reset_url}" style="display:inline-block;background:#0082C8;color:#ffffff;text-decoration:none;'
        f'padding:10px 20px;border-radius:6px;font-size:14px;font-weight:600;">Redefinir password</a></p>'
        f'<p style="margin:0;font-size:12px;color:#8a8f98;">Se não foi você, pode ignorar este email — '
        f'a sua password mantém-se inalterada.</p>'
    )
    html_body, images = branded_email_html(
        subject, intro_html, '',
        footer_html='Este é um email automático do MupiTech Gestor de Mupis Digitais.',
    )

    try:
        send_email([user.email], subject, text_body, html_body, images=images)
    except Exception:
        logger.exception('Failed to send password reset email to %s.', user.username)


@ratelimit(group='auth_password_reset_request', key='ip', rate='5/m', method='POST', block=True)
@ratelimit(group='auth_password_reset_request', key='post:email', rate='3/30m', method='POST', block=True)
@api_view(['POST'])
@permission_classes([AllowAny])
def auth_password_reset_request(request):
    """Always answers {success: True} regardless of whether the email
    matches an account — confirming/denying that here would let anyone
    enumerate registered usernames/emails one guess at a time."""
    from django.contrib.auth.models import User

    from history.logging import log_action

    email = (request.data.get('email') or '').strip()
    if email:
        user = User.objects.filter(email__iexact=email, is_active=True).first()
        if user:
            _send_password_reset_email(request, user)
            log_action(request, 'password_reset_request', 'session', target_name=user.username)
    return Response({'success': True})


@ratelimit(group='auth_password_reset_confirm', key='ip', rate='10/m', method='POST', block=True)
@api_view(['POST'])
@permission_classes([AllowAny])
def auth_password_reset_confirm(request):
    from django.contrib.auth.models import User
    from django.contrib.auth.tokens import default_token_generator
    from django.utils.encoding import force_str
    from django.utils.http import urlsafe_base64_decode

    from history.logging import log_action

    uid = request.data.get('uid', '')
    token = request.data.get('token', '')
    new_password = request.data.get('new_password', '')

    if len(new_password) < 8:
        return Response({'error': 'A password tem de ter pelo menos 8 caracteres.'}, status=400)

    try:
        user_id = force_str(urlsafe_base64_decode(uid))
        user = User.objects.get(pk=user_id, is_active=True)
    except (User.DoesNotExist, ValueError, TypeError, OverflowError, ValidationError):
        return Response({'error': 'Este link é inválido ou já expirou.'}, status=400)

    if not default_token_generator.check_token(user, token):
        return Response({'error': 'Este link é inválido ou já expirou.'}, status=400)

    user.set_password(new_password)
    user.save(update_fields=['password'])
    log_action(request, 'password_reset_confirm', 'session', target_name=user.username)
    return Response({'success': True})


from django.views.decorators.clickjacking import xframe_options_sameorigin


@xframe_options_sameorigin
def cctv_player_view(request, config_id):
    from django.utils import timezone

    from cctv.services import get_stream_status, start_stream
    from cctv.models import CctvConfig
    config = get_object_or_404(CctvConfig.objects.prefetch_related('cameras'), pk=config_id)
    # Track that someone is watching — prevents Celery auto-stop
    CctvConfig.objects.filter(pk=config.pk).update(last_requested_at=timezone.now())
    # Auto-start stream when page is opened
    status = get_stream_status(str(config.id))
    if status.get('status') != 'running':
        try:
            start_stream(str(config.id))
        except Exception:
            logger.warning('Failed to auto-start CCTV stream %s', config_id, exc_info=True)

    from cctv.services import has_web_sources, _calc_grid
    import json

    grid_mode = config.display_mode == 'mosaic' and has_web_sources(config)
    cameras = list(config.cameras.all())
    cols, rows = _calc_grid(len(cameras))

    cameras_json = json.dumps([
        {
            'index': i,
            'name': cam.name or f'Camera {i + 1}',
            'url': cam.rtsp_url,
            'source_type': cam.source_type,
        }
        for i, cam in enumerate(cameras)
    ])

    return render(request, 'cctv_player.html', {
        'config_id': str(config.id),
        'config_name': config.name,
        'display_mode': config.display_mode,
        'rotation_interval': config.rotation_interval,
        'camera_count': len(cameras),
        'grid_mode': grid_mode,
        'grid_cols': cols,
        'grid_rows': rows,
        'cameras_json': cameras_json,
    })


urlpatterns = [
    path('manage-d8f2a1/', admin.site.urls),
    path('api/auth/login/', auth_login),
    path('api/auth/mfa/verify/', auth_mfa_verify),
    path('api/auth/mfa/duo-verify/', auth_duo_verify),
    path('api/auth/mfa/privacyidea-verify/', auth_privacyidea_verify),
    path('api/auth/mfa/privacyidea-push-verify/', auth_privacyidea_push_verify),
    path('api/auth/mfa/email-send/', auth_email_otp_send),
    path('api/auth/mfa/email-verify/', auth_email_otp_verify),
    path('api/auth/device-login/', auth_device_login),
    path('api/auth/logout/', auth_logout),
    path('api/auth/status/', auth_status),
    path('api/auth/password-reset/', auth_password_reset_request),
    path('api/auth/password-reset-confirm/', auth_password_reset_confirm),
    path('api/auth/token/', obtain_auth_token, name='api-token'),
    path('api/system/version/', system_version),
    path('api/system/features/', system_features),
    path('api/system/setup-required/', setup_required),
    path('api/system/setup/', run_setup),
    path('api/system/update-check/', system_update_check),
    path('api/system/update/', system_update),
    path('api/system/settings/', system_settings),
    path('api/system/telemetry/', system_telemetry),
    path('api/system/tailscale/', tailscale_settings),
    path('api/system/alerts/', alert_settings),
    path('api/system/alerts/test/', alert_test_email),
    path('api/system/alerts/test-offline/', alert_test_offline_email),
    path('api/system/editor-permissions/', editor_permissions),
    path('api/system/registry/', registry_settings),
    path('api/system/registry/sync/', registry_sync),
    path('api/system/registry/sync-status/', registry_sync_status),
    path('api/system/branding/', branding_settings),
    path('api/system/branding/logo/', branding_upload_logo),
    path('api/system/branding/logo/delete/', branding_delete_logo),
    path('api/system/branding/standby/', branding_upload_standby),
    path('api/system/branding/standby/delete/', branding_delete_standby),
    path('api/system/branding/push-all/', branding_push_all),
    path('api/system/theme/', fm_theme_settings),
    path('api/system/theme/partner-logo/', fm_theme_upload_partner_logo),
    path('api/system/theme/partner-logo/delete/', fm_theme_delete_partner_logo),
    path('api/', include(user_router.urls)),
    path('api/', include('history.urls')),
    path('api/', include('locations.urls')),
    path('api/', include('playlists.urls')),
    path('api/', include('groups.urls')),
    path('api/', include('content.urls')),
    path('api/', include('cctv.urls')),
    path('api/', include('players.urls')),
    path('api/', include('deploy.urls')),
    path('api/', include('mfa.urls')),
    re_path(r'^media/(?P<path>.*)$', serve, {'document_root': settings.MEDIA_ROOT}),
    path('cctv/<uuid:config_id>/', cctv_player_view, name='cctv-player'),
    path('tools/weather/', weather_widget, name='weather-widget'),
    path('', TemplateView.as_view(template_name='index.html'), name='index'),
    path('<path:path>', TemplateView.as_view(template_name='index.html')),
]
