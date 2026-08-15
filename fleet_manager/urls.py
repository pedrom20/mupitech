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

from rest_framework.routers import DefaultRouter

from fleet_manager.permissions import _user_role
from fleet_manager.system_views import (
    alert_settings,
    alert_test_email,
    branding_delete_logo,
    branding_delete_standby,
    branding_push_all,
    branding_settings,
    branding_upload_logo,
    branding_upload_standby,
    fm_theme_delete_partner_logo,
    fm_theme_settings,
    fm_theme_upload_partner_logo,
    registry_settings,
    registry_sync,
    registry_sync_status,
    system_features,
    system_settings,
    system_telemetry,
    system_update,
    system_update_check,
    system_version,
    tailscale_settings,
)
from fleet_manager.user_views import UserViewSet

user_router = DefaultRouter()
user_router.register('users', UserViewSet)


@ratelimit(key='ip', rate='5/m', method='POST', block=True)
@api_view(['POST'])
@permission_classes([AllowAny])
def auth_login(request):
    from history.logging import log_action
    from mfa.models import DuoEnrollment, TOTPDevice

    data = request.data
    user = authenticate(
        request,
        username=data.get('username'),
        password=data.get('password'),
    )
    if user is not None:
        # Duo push takes priority when a user has both — it's a single
        # tap, no code to type. Whichever fires, do NOT call login() yet:
        # that would establish a real session on password alone and
        # defeat MFA. The challenge lives in the (Redis-backed) cache,
        # not a signed token: a signed token isn't single-use without a
        # shared store anyway (need somewhere to record "already
        # consumed"), and a cache entry gives that for free via
        # cache.delete() in the matching verify endpoint.
        has_duo = DuoEnrollment.objects.filter(user=user, confirmed=True).exists()
        has_totp = TOTPDevice.objects.filter(user=user, confirmed=True).exists()
        if has_duo or has_totp:
            import secrets

            from django.core.cache import cache

            method = 'duo' if has_duo else 'totp'
            # Both verify endpoints only ever look at entry['user_id'] —
            # neither checks 'method' — so the same challenge_id already
            # works for either one. available_methods just tells the
            # frontend what it's allowed to offer as a "use a different
            # method" switch when a user has both enrolled.
            available_methods = [m for m, has in (('duo', has_duo), ('totp', has_totp)) if has]
            challenge_id = secrets.token_urlsafe(32)
            cache.set(
                f'mfa_challenge:{challenge_id}',
                {'user_id': user.id, 'attempts': 0, 'method': method},
                timeout=300,
            )
            return Response({
                'mfa_required': True,
                'challenge_id': challenge_id,
                'method': method,
                'available_methods': available_methods,
            })
        login(request, user)
        log_action(request, 'login', 'session', target_name=user.username)
        return Response({'success': True, 'username': user.username})
    log_action(request, 'login_failed', 'session', target_name=data.get('username', ''))
    return Response(
        {'detail': 'Invalid credentials'},
        status=401,
    )


@ratelimit(key='ip', rate='10/m', method='POST', block=True)
@ratelimit(key='post:challenge_id', rate='8/5m', method='POST', block=True)
@api_view(['POST'])
@permission_classes([AllowAny])
def auth_mfa_verify(request):
    import pyotp
    from django.contrib.auth.models import User
    from django.core.cache import cache
    from django.utils import timezone

    from history.logging import log_action
    from mfa.models import TOTPDevice

    challenge_id = request.data.get('challenge_id', '')
    cache_key = f'mfa_challenge:{challenge_id}'
    entry = cache.get(cache_key)
    if not entry:
        return Response({'detail': 'Challenge expired or invalid — please log in again.'}, status=400)

    device = TOTPDevice.objects.filter(user_id=entry['user_id'], confirmed=True).first()
    code = str(request.data.get('code', ''))
    if device and pyotp.TOTP(device.get_secret()).verify(code, valid_window=1):
        cache.delete(cache_key)
        user = User.objects.get(pk=entry['user_id'])
        login(request, user)
        device.last_used_at = timezone.now()
        device.save(update_fields=['last_used_at'])
        log_action(request, 'login', 'session', target_name=user.username, details={'mfa': True})
        return Response({'success': True, 'username': user.username})

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


@ratelimit(key='ip', rate='10/m', method='POST', block=True)
@ratelimit(key='post:challenge_id', rate='5/5m', method='POST', block=True)
@api_view(['POST'])
@permission_classes([AllowAny])
def auth_duo_verify(request):
    """Companion to auth_mfa_verify for the Duo-push case: no code to
    check, this just triggers the push and blocks (up to Duo's own
    ~60s default) until the operator approves/denies or it times out —
    see mfa/duo.py::push_auth. Rate limits are looser than the TOTP
    verify's since there's no code to brute-force here; they exist
    purely to stop someone spamming push notifications at a user."""
    from django.contrib.auth.models import User
    from django.core.cache import cache
    from django.utils import timezone

    from history.logging import log_action
    from mfa import duo
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
        result = duo.push_auth(enrollment.duo_user_id)
    except Exception as exc:
        logger.warning('Duo push_auth failed: %s', exc)
        return Response({'detail': "Couldn't reach Duo — try again."}, status=502)

    if result.get('result') == 'allow':
        cache.delete(cache_key)
        user = User.objects.get(pk=entry['user_id'])
        login(request, user)
        enrollment.last_used_at = timezone.now()
        enrollment.save(update_fields=['last_used_at'])
        log_action(request, 'login', 'session', target_name=user.username, details={'mfa': 'duo'})
        return Response({'success': True, 'username': user.username})

    if result.get('status') == 'timeout':
        # Let the frontend retry (send another push) without forcing a
        # fresh password entry — the challenge is still good.
        log_action(request, 'login_failed', 'session', details={'mfa': 'duo', 'status': 'timeout'})
        return Response({'detail': 'timeout', 'status_msg': result.get('status_msg', '')}, status=401)

    # Explicit deny (or any other terminal state) — don't allow retrying
    # the same challenge; force a fresh login.
    cache.delete(cache_key)
    log_action(request, 'login_failed', 'session', details={'mfa': 'duo', 'status': result.get('status')})
    return Response({'detail': 'denied', 'status_msg': result.get('status_msg', '')}, status=401)


@ratelimit(key='ip', rate='20/m', method='POST', block=True)
@ratelimit(key='post:player_id', rate='10/m', method='POST', block=True)
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

    No MFA support here — a device without a browser-based challenge
    flow can't complete TOTP/Duo verification, so an MFA-enrolled user
    is told to use the FM-initiated SSO button instead.
    """
    from django.core import signing
    from django.core.cache import cache

    from history.logging import log_action
    from mfa.models import DuoEnrollment, TOTPDevice
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

    has_mfa = (
        DuoEnrollment.objects.filter(user=user, confirmed=True).exists()
        or TOTPDevice.objects.filter(user=user, confirmed=True).exists()
    )
    if has_mfa:
        return Response({'detail': 'mfa_required'}, status=409)

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
    path('api/auth/device-login/', auth_device_login),
    path('api/auth/logout/', auth_logout),
    path('api/auth/status/', auth_status),
    path('api/auth/token/', obtain_auth_token, name='api-token'),
    path('api/system/version/', system_version),
    path('api/system/features/', system_features),
    path('api/system/update-check/', system_update_check),
    path('api/system/update/', system_update),
    path('api/system/settings/', system_settings),
    path('api/system/telemetry/', system_telemetry),
    path('api/system/tailscale/', tailscale_settings),
    path('api/system/alerts/', alert_settings),
    path('api/system/alerts/test/', alert_test_email),
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
    path('', TemplateView.as_view(template_name='index.html'), name='index'),
    path('<path:path>', TemplateView.as_view(template_name='index.html')),
]
