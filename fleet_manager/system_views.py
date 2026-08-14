import logging
import os
import re
import subprocess
import threading
import time

import psutil
import requests
from django.conf import settings
from django.core.cache import cache
from rest_framework.decorators import api_view, permission_classes
from rest_framework.response import Response

from fleet_manager.permissions import IsAdmin, IsSuperAdmin

logger = logging.getLogger(__name__)

GITHUB_REPO = os.environ.get('UPDATE_CHECK_GITHUB_REPO', 'pedrom20/mupiteck')
UPDATE_CHECK_CACHE_KEY = 'system:latest_version'
UPDATE_CHECK_CACHE_TTL = 300  # 5 minutes
AUTO_UPDATE_CACHE_KEY = 'system:auto_update'

# Tailscale settings keys
TS_ENABLED_KEY = 'system:tailscale_enabled'
TS_AUTHKEY_KEY = 'system:tailscale_authkey'
TS_FM_IP_KEY = 'system:tailscale_fm_ip'


def _parse_version(version_str):
    """Parse version string like '1.2.3' into tuple (1, 2, 3) for comparison."""
    match = re.match(r'v?(\d+)\.(\d+)\.(\d+)', str(version_str))
    if match:
        return tuple(int(x) for x in match.groups())
    return (0, 0, 0)


def _fetch_latest_version():
    """Fetch latest version from GitHub releases, fallback to tags."""
    headers = {'Accept': 'application/vnd.github.v3+json'}

    # Try releases first
    try:
        resp = requests.get(
            f'https://api.github.com/repos/{GITHUB_REPO}/releases/latest',
            headers=headers,
            timeout=10,
        )
        if resp.status_code == 200:
            data = resp.json()
            return {
                'version': data.get('tag_name', '').lstrip('v'),
                'html_url': data.get('html_url', ''),
                'published_at': data.get('published_at', ''),
            }
    except requests.RequestException:
        pass

    # Fallback to tags
    try:
        resp = requests.get(
            f'https://api.github.com/repos/{GITHUB_REPO}/tags',
            headers=headers,
            timeout=10,
        )
        if resp.status_code == 200:
            tags = resp.json()
            if tags:
                tag_name = tags[0].get('name', '').lstrip('v')
                return {
                    'version': tag_name,
                    'html_url': f'https://github.com/{GITHUB_REPO}/releases/tag/{tags[0].get("name", "")}',
                    'published_at': '',
                }
    except requests.RequestException:
        pass

    return None


@api_view(['GET'])
def system_version(request):
    """Return current app version and build date."""
    return Response({
        'version': settings.APP_VERSION,
        'build_date': settings.BUILD_DATE,
    })


@api_view(['GET'])
def system_features(request):
    """Return which optional features are enabled for this deployment."""
    return Response(settings.FEATURES)


@api_view(['GET'])
def system_update_check(request):
    """Check GitHub for newer version. Cached for 5 minutes."""
    force = request.query_params.get('force', '').lower() in ('1', 'true')

    if not force:
        cached = cache.get(UPDATE_CHECK_CACHE_KEY)
        if cached is not None:
            # Recalculate update_available with current version
            # (cache may have been set by a previous container version)
            cached['current_version'] = settings.APP_VERSION
            if cached.get('latest_version'):
                cached['update_available'] = (
                    _parse_version(cached['latest_version'])
                    > _parse_version(settings.APP_VERSION)
                )
            return Response(cached)

    current = settings.APP_VERSION
    latest_info = _fetch_latest_version()

    if latest_info is None:
        return Response({
            'current_version': current,
            'latest_version': None,
            'update_available': False,
            'error': 'Failed to check for updates',
        })

    latest = latest_info['version']
    update_available = _parse_version(latest) > _parse_version(current)

    result = {
        'current_version': current,
        'latest_version': latest,
        'update_available': update_available,
        'release_url': latest_info.get('html_url', ''),
        'published_at': latest_info.get('published_at', ''),
    }

    cache.set(UPDATE_CHECK_CACHE_KEY, result, UPDATE_CHECK_CACHE_TTL)
    return Response(result)


def _get_docker_client():
    """Get Docker SDK client connected via mounted socket."""
    import docker
    return docker.from_env()


def _get_updater_container(client):
    """Find the updater sidecar by the label docker compose sets on every
    container it creates, rather than a hardcoded container name.

    The name docker compose actually assigns is <project>-updater-1,
    where <project> is whatever COMPOSE_PROJECT_NAME (or the -p flag, or
    Portainer's own stack name) resolved to at deploy time — it does
    *not* have to match this file's own `name: mupitech-fleet-manager`
    (Portainer's stack name wins if the stack was deployed under a
    different one, e.g. plain "mupitech"). A hardcoded
    'mupitech-fleet-manager-updater-1' silently 503'd "Cannot reach
    updater service" on any deployment where the two disagree — this
    works under any project name.
    """
    matches = client.containers.list(
        filters={'label': 'com.docker.compose.service=updater'},
    )
    return matches[0] if matches else None


def _trigger_compose_update():
    """Pull new images and recreate services via docker compose in updater sidecar."""
    try:
        client = _get_docker_client()
        updater = _get_updater_container(client)
        if updater is None:
            logger.error('Compose update failed: updater sidecar not found')
            return
        # Resolve the *real* compose project name from the updater
        # container's own label instead of assuming one — see
        # _get_updater_container's docstring. `docker compose -p` pins
        # every command in this chain to that project, so `pull`/`up`
        # target the actual running stack even if it was deployed under
        # a project name this repo's docker-compose.yml doesn't itself
        # declare.
        project = updater.labels.get('com.docker.compose.project', '')
        project_flag = f'-p {project} ' if project else ''
        cmd = (
            f'docker compose {project_flag}pull web celery-worker celery-transcode celery-beat && '
            f'docker compose {project_flag}up -d --no-deps --no-build web celery-worker celery-transcode celery-beat'
        )
        updater.exec_run(['sh', '-c', cmd], workdir='/project', detach=True)
    except Exception as e:
        logger.error('Compose update failed: %s', e)


@api_view(['POST'])
def system_update(request):
    """Trigger update via docker compose in updater sidecar.

    Sends response immediately, then triggers compose pull + up in background.
    This prevents the response from being lost when compose recreates
    this container during the update.
    """
    try:
        client = _get_docker_client()
        updater = _get_updater_container(client)
        if updater is None:
            return Response(
                {'success': False, 'message': 'Cannot reach updater service'},
                status=503,
            )
        if updater.status != 'running':
            return Response(
                {'success': False, 'message': 'Updater service is not running'},
                status=503,
            )
    except Exception:
        return Response(
            {'success': False, 'message': 'Cannot reach updater service'},
            status=503,
        )

    # Clear update cache so the check refreshes after container restart
    cache.delete(UPDATE_CHECK_CACHE_KEY)

    from history.logging import log_action
    log_action(request, 'trigger_update', 'system')

    # Trigger in background so response reaches client before container restart
    threading.Thread(target=_trigger_compose_update, daemon=True).start()
    return Response({'success': True, 'message': 'Update triggered'})


@api_view(['GET', 'PATCH'])
def system_settings(request):
    """Get or update system settings (auto_update toggle)."""
    if request.method == 'GET':
        auto_update = cache.get(AUTO_UPDATE_CACHE_KEY, True)
        return Response({'auto_update': auto_update})

    auto_update = request.data.get('auto_update')
    if auto_update is not None:
        cache.set(AUTO_UPDATE_CACHE_KEY, bool(auto_update), None)
        from history.logging import log_action
        log_action(request, 'update', 'settings', target_name='auto_update', details={'auto_update': bool(auto_update)})
    return Response({'auto_update': cache.get(AUTO_UPDATE_CACHE_KEY, True)})


@api_view(['GET'])
def system_telemetry(request):
    """Return server telemetry: CPU, memory, disk, uptime, temperature."""
    # CPU
    cpu_percent = psutil.cpu_percent(interval=0.5)
    cpu_count = psutil.cpu_count(logical=True)
    cpu_freq = psutil.cpu_freq()
    cpu_freq_mhz = round(cpu_freq.current) if cpu_freq else None

    # CPU temperature
    cpu_temp = None
    try:
        temps = psutil.sensors_temperatures()
        if temps:
            for name in ('coretemp', 'cpu_thermal', 'k10temp', 'zenpower'):
                if name in temps and temps[name]:
                    cpu_temp = temps[name][0].current
                    break
            if cpu_temp is None:
                first = next(iter(temps.values()), [])
                if first:
                    cpu_temp = first[0].current
    except (AttributeError, StopIteration):
        pass

    # Memory
    mem = psutil.virtual_memory()

    # Disk
    disk = psutil.disk_usage('/')

    # Uptime
    uptime_seconds = int(time.time() - psutil.boot_time())

    hostname = os.environ.get('FM_HOSTNAME', '')
    if not hostname:
        try:
            with open('/etc/host_hostname', 'r') as f:
                hostname = f.read().strip()
        except FileNotFoundError:
            import socket
            hostname = socket.gethostname()

    return Response({
        'cpu_percent': cpu_percent,
        'cpu_count': cpu_count,
        'cpu_freq_mhz': cpu_freq_mhz,
        'cpu_temp': round(cpu_temp, 1) if cpu_temp is not None else None,
        'memory_total_gb': round(mem.total / (1024 ** 3), 1),
        'memory_used_gb': round(mem.used / (1024 ** 3), 1),
        'memory_percent': mem.percent,
        'disk_total_gb': round(disk.total / (1024 ** 3), 1),
        'disk_used_gb': round(disk.used / (1024 ** 3), 1),
        'disk_percent': disk.percent,
        'uptime_seconds': uptime_seconds,
        'version': settings.APP_VERSION,
        'build_date': settings.BUILD_DATE,
        'hostname': hostname,
    })


def _get_fernet():
    """Return a Fernet instance for encrypting Tailscale auth key."""
    import base64
    import hashlib
    from cryptography.fernet import Fernet
    key = hashlib.sha256(settings.SECRET_KEY.encode()).digest()
    return Fernet(base64.urlsafe_b64encode(key))


def _detect_tailscale_ip():
    """Try to detect the local Tailscale IPv4 address."""
    try:
        result = subprocess.run(
            ['tailscale', 'ip', '-4'],
            capture_output=True, text=True, timeout=5,
        )
        if result.returncode == 0:
            return result.stdout.strip()
    except (FileNotFoundError, subprocess.TimeoutExpired):
        pass
    return ''


def _get_tailscale_status():
    """Check if Tailscale is connected."""
    try:
        result = subprocess.run(
            ['tailscale', 'status', '--json'],
            capture_output=True, text=True, timeout=5,
        )
        if result.returncode == 0:
            import json
            data = json.loads(result.stdout)
            backend = data.get('BackendState', '')
            return 'connected' if backend == 'Running' else 'disconnected'
    except (FileNotFoundError, subprocess.TimeoutExpired, ValueError, KeyError):
        pass
    return 'not_installed'


@api_view(['GET', 'PATCH'])
@permission_classes([IsSuperAdmin])
def tailscale_settings(request):
    """Get or update Tailscale VPN settings. Superadmin only — not even admin."""
    if request.method == 'GET':
        detected_ip = _detect_tailscale_ip()
        ts_status = _get_tailscale_status()
        has_authkey = bool(cache.get(TS_AUTHKEY_KEY))
        return Response({
            'tailscale_enabled': cache.get(TS_ENABLED_KEY, False),
            'has_authkey': has_authkey,
            'fm_tailscale_ip': cache.get(TS_FM_IP_KEY, '') or detected_ip,
            'detected_ip': detected_ip,
            'status': ts_status,
        })

    # PATCH
    ts_enabled = request.data.get('tailscale_enabled')
    if ts_enabled is not None:
        cache.set(TS_ENABLED_KEY, bool(ts_enabled), None)

    authkey = request.data.get('authkey')
    if authkey is not None:
        if authkey:
            f = _get_fernet()
            encrypted = f.encrypt(authkey.encode()).decode()
            cache.set(TS_AUTHKEY_KEY, encrypted, None)
        else:
            cache.delete(TS_AUTHKEY_KEY)

    fm_ip = request.data.get('fm_tailscale_ip')
    if fm_ip is not None:
        cache.set(TS_FM_IP_KEY, fm_ip, None)

    from history.logging import log_action
    log_action(request, 'update', 'settings', target_name='tailscale', details={k: v for k, v in request.data.items() if k != 'authkey'})

    detected_ip = _detect_tailscale_ip()
    return Response({
        'tailscale_enabled': cache.get(TS_ENABLED_KEY, False),
        'has_authkey': bool(cache.get(TS_AUTHKEY_KEY)),
        'fm_tailscale_ip': cache.get(TS_FM_IP_KEY, '') or detected_ip,
        'detected_ip': detected_ip,
        'status': _get_tailscale_status(),
    })


@api_view(['GET', 'PATCH'])
@permission_classes([IsSuperAdmin])
def alert_settings(request):
    """Get or update device-offline email alert settings.

    SMTP password is write-only — GET reports has_password instead of the
    actual value, same pattern as Tailscale's authkey.
    """
    from fleet_manager.alerts import (
        ALERTS_ENABLED_KEY, ALERTS_FROM_EMAIL_KEY, ALERTS_SMTP_HOST_KEY,
        ALERTS_SMTP_PASSWORD_KEY, ALERTS_SMTP_PORT_KEY, ALERTS_SMTP_USE_TLS_KEY,
        ALERTS_SMTP_USERNAME_KEY, ALERTS_THRESHOLD_MINUTES_KEY, DEFAULT_THRESHOLD_MINUTES,
    )

    def _current():
        return {
            'enabled': cache.get(ALERTS_ENABLED_KEY, False),
            'threshold_minutes': cache.get(ALERTS_THRESHOLD_MINUTES_KEY, DEFAULT_THRESHOLD_MINUTES),
            'smtp_host': cache.get(ALERTS_SMTP_HOST_KEY, ''),
            'smtp_port': cache.get(ALERTS_SMTP_PORT_KEY, 587),
            'smtp_username': cache.get(ALERTS_SMTP_USERNAME_KEY, ''),
            'has_password': bool(cache.get(ALERTS_SMTP_PASSWORD_KEY)),
            'use_tls': cache.get(ALERTS_SMTP_USE_TLS_KEY, True),
            'from_email': cache.get(ALERTS_FROM_EMAIL_KEY, ''),
        }

    if request.method == 'GET':
        return Response(_current())

    data = request.data
    if 'enabled' in data:
        cache.set(ALERTS_ENABLED_KEY, bool(data['enabled']), None)
    if 'threshold_minutes' in data:
        try:
            cache.set(ALERTS_THRESHOLD_MINUTES_KEY, max(1, int(data['threshold_minutes'])), None)
        except (TypeError, ValueError):
            return Response({'error': 'threshold_minutes must be an integer'}, status=400)
    if 'smtp_host' in data:
        cache.set(ALERTS_SMTP_HOST_KEY, data['smtp_host'] or '', None)
    if 'smtp_port' in data:
        try:
            cache.set(ALERTS_SMTP_PORT_KEY, int(data['smtp_port']), None)
        except (TypeError, ValueError):
            return Response({'error': 'smtp_port must be an integer'}, status=400)
    if 'smtp_username' in data:
        cache.set(ALERTS_SMTP_USERNAME_KEY, data['smtp_username'] or '', None)
    if 'smtp_password' in data:
        password = data['smtp_password']
        if password:
            encrypted = _get_fernet().encrypt(password.encode()).decode()
            cache.set(ALERTS_SMTP_PASSWORD_KEY, encrypted, None)
        else:
            cache.delete(ALERTS_SMTP_PASSWORD_KEY)
    if 'use_tls' in data:
        cache.set(ALERTS_SMTP_USE_TLS_KEY, bool(data['use_tls']), None)
    if 'from_email' in data:
        cache.set(ALERTS_FROM_EMAIL_KEY, data['from_email'] or '', None)

    from history.logging import log_action
    log_action(request, 'update', 'settings', target_name='alerts',
               details={k: v for k, v in data.items() if k != 'smtp_password'})

    return Response(_current())


@api_view(['POST'])
@permission_classes([IsSuperAdmin])
def alert_test_email(request):
    """Send a one-off test email using the currently-saved SMTP settings."""
    to_email = request.data.get('to_email') or request.user.email
    if not to_email:
        return Response({'error': 'No email address to send the test to.'}, status=400)

    from fleet_manager.alerts import send_test_email
    try:
        send_test_email(to_email)
    except Exception as exc:
        return Response({'success': False, 'error': str(exc)}, status=400)
    return Response({'success': True})


@api_view(['GET', 'PATCH'])
@permission_classes([IsSuperAdmin])
def registry_settings(request):
    """Get or update the local Docker registry mirror config (enable +
    host:port). Superadmin only, same tier as Tailscale/Alerts — this
    changes what devices pull their images from."""
    from fleet_manager.registry_mirror import (
        REGISTRY_ENABLED_KEY, REGISTRY_HOST_KEY, get_registry_settings,
    )

    if request.method == 'GET':
        return Response(get_registry_settings())

    data = request.data
    if 'enabled' in data:
        cache.set(REGISTRY_ENABLED_KEY, bool(data['enabled']), None)
    if 'host' in data:
        cache.set(REGISTRY_HOST_KEY, (data['host'] or '').strip(), None)

    from history.logging import log_action
    log_action(request, 'update', 'settings', target_name='registry_mirror', details=dict(data))

    return Response(get_registry_settings())


@api_view(['POST'])
@permission_classes([IsSuperAdmin])
def registry_sync(request):
    """Trigger the local registry mirror sync in the background."""
    from fleet_manager.registry_mirror import get_registry_settings, get_sync_status
    conf = get_registry_settings()
    if not conf['enabled'] or not conf['host']:
        return Response({'error': 'Enable the mirror and set a host first.'}, status=400)

    status_now = get_sync_status()
    if status_now['state'] == 'running':
        return Response({'error': 'A sync is already running.'}, status=409)

    from players.tasks import sync_local_registry
    sync_local_registry.delay()

    from history.logging import log_action
    log_action(request, 'sync_registry', 'system')

    return Response({'success': True})


@api_view(['GET'])
@permission_classes([IsSuperAdmin])
def registry_sync_status(request):
    from fleet_manager.registry_mirror import get_sync_status
    return Response(get_sync_status())


# Fleet-wide custom branding assets, pushed to devices via SSH (players/branding.py).
# Stored as plain files on the shared media volume — no DB model needed for
# a couple of fleet-wide assets. Constants live in players.branding; imported
# here rather than redefined so the two never drift apart.
from players.branding import (
    BRANDING_DIR, BRANDING_LOGO_FILENAME, STANDBY_FILENAME,
    convert_to_png, wrap_raster_as_svg,
)


def _branding_logo_path():
    return os.path.join(BRANDING_DIR, BRANDING_LOGO_FILENAME)


def _branding_standby_path():
    return os.path.join(BRANDING_DIR, STANDBY_FILENAME)


@api_view(['GET'])
def branding_settings(request):
    """Branding asset status: splash logo (custom vs. bundled default) and standby image."""
    logo_exists = os.path.isfile(_branding_logo_path())
    standby_exists = os.path.isfile(_branding_standby_path())
    return Response({
        'has_custom_logo': logo_exists,
        'logo_url': f'{settings.MEDIA_URL}branding/{BRANDING_LOGO_FILENAME}' if logo_exists else '/static/img/logo.svg',
        'has_standby_image': standby_exists,
        'standby_url': f'{settings.MEDIA_URL}branding/{STANDBY_FILENAME}' if standby_exists else None,
    })


@api_view(['POST'])
@permission_classes([IsAdmin])
def branding_upload_logo(request):
    """Upload the fleet-wide custom splash logo (SVG, PNG or JPEG)."""
    logo = request.FILES.get('logo')
    if not logo:
        return Response({'error': 'logo file is required'}, status=400)

    name_lower = logo.name.lower()
    os.makedirs(BRANDING_DIR, exist_ok=True)

    if name_lower.endswith('.svg'):
        with open(_branding_logo_path(), 'wb') as f:
            for chunk in logo.chunks():
                f.write(chunk)
    elif name_lower.endswith(('.png', '.jpg', '.jpeg')):
        try:
            svg_bytes = wrap_raster_as_svg(logo, logo.name)
        except Exception as exc:
            return Response({'error': f'Could not process image: {exc}'}, status=400)
        with open(_branding_logo_path(), 'wb') as f:
            f.write(svg_bytes)
    else:
        return Response({'error': 'Only SVG, PNG or JPEG files are supported'}, status=400)

    from history.logging import log_action
    log_action(request, 'upload', 'branding_logo')

    return Response({
        'success': True,
        'logo_url': f'{settings.MEDIA_URL}branding/{BRANDING_LOGO_FILENAME}',
    })


@api_view(['DELETE'])
@permission_classes([IsAdmin])
def branding_delete_logo(request):
    """Remove the fleet-wide custom splash logo (does not affect devices it was already pushed to)."""
    path = _branding_logo_path()
    if os.path.isfile(path):
        os.remove(path)
        from history.logging import log_action
        log_action(request, 'delete', 'branding_logo')
    return Response(status=204)


@api_view(['POST'])
@permission_classes([IsAdmin])
def branding_upload_standby(request):
    """Upload the fleet-wide "no content" standby image (PNG, JPEG or an
    animated GIF).

    A static image is always converted to real PNG bytes at the fixed
    standby.png path the device expects; an animated GIF is kept as-is
    (see players.branding.convert_to_png — the viewer's webview plays
    GIFs natively, decoding by content rather than the .png filename).
    SVG isn't accepted here (unlike the logo) — Pillow can't rasterize
    vectors, and standby.png is loaded by the viewer as a plain raster
    image, not through a browser that could render one.
    """
    image = request.FILES.get('standby')
    if not image:
        return Response({'error': 'standby file is required'}, status=400)

    name_lower = image.name.lower()
    if not name_lower.endswith(('.png', '.jpg', '.jpeg', '.gif')):
        return Response({'error': 'Only PNG, JPEG or GIF files are supported'}, status=400)

    os.makedirs(BRANDING_DIR, exist_ok=True)
    try:
        image_bytes = convert_to_png(image, add_margin=True)
    except Exception as exc:
        return Response({'error': f'Could not process image: {exc}'}, status=400)
    with open(_branding_standby_path(), 'wb') as f:
        f.write(image_bytes)

    from history.logging import log_action
    log_action(request, 'upload', 'branding_standby')

    return Response({
        'success': True,
        'standby_url': f'{settings.MEDIA_URL}branding/{STANDBY_FILENAME}',
    })


@api_view(['DELETE'])
@permission_classes([IsAdmin])
def branding_delete_standby(request):
    """Remove the fleet-wide custom standby image (does not affect devices it was already pushed to)."""
    path = _branding_standby_path()
    if os.path.isfile(path):
        os.remove(path)
        from history.logging import log_action
        log_action(request, 'delete', 'branding_standby')
    return Response(status=204)


@api_view(['POST'])
@permission_classes([IsAdmin])
def branding_push_all(request):
    """SSH into every already-added player and (re)push its resolved
    branding — used to roll out a fleet-wide branding change to devices
    that were added before it, without visiting each one.

    ssh_user/ssh_password/ssh_port are used as a shared fallback for any
    player without its own saved SSH credentials — a player that has its
    own takes precedence, so devices with different logins can be pushed
    in one go."""
    from players.branding import (
        BrandingPushError, push_device_label_to_player, push_splash_logo_to_player,
        push_standby_image_to_player, get_standby_path,
    )
    from players.models import Player

    default_ssh_password = request.data.get('ssh_password')
    default_ssh_user = request.data.get('ssh_user') or 'pi'
    try:
        default_ssh_port = int(request.data.get('ssh_port', 22))
    except (TypeError, ValueError):
        return Response({'error': 'ssh_port must be an integer'}, status=400)
    push_logo = request.data.get('push_logo', True)
    push_standby = request.data.get('push_standby', False)

    results = {}
    for player in Player.objects.all():
        if player.has_ssh_credentials:
            ssh_user, ssh_password, ssh_port = player.ssh_username, player.get_ssh_password(), player.ssh_port
        else:
            ssh_user, ssh_password, ssh_port = default_ssh_user, default_ssh_password, default_ssh_port
        if not ssh_password:
            results[str(player.id)] = {
                'name': player.name, 'success': False,
                'error': 'No SSH credentials available for this device.',
            }
            continue
        try:
            if push_logo:
                push_splash_logo_to_player(player, ssh_user, ssh_password, ssh_port)
                push_device_label_to_player(player, ssh_user, ssh_password, ssh_port)
            if push_standby and get_standby_path(player):
                push_standby_image_to_player(player, ssh_user, ssh_password, ssh_port)
            results[str(player.id)] = {'name': player.name, 'success': True}
        except BrandingPushError as exc:
            results[str(player.id)] = {'name': player.name, 'success': False, 'error': str(exc)}

    from history.logging import log_action
    log_action(
        request, 'push_branding_all', 'system',
        details={'logo': bool(push_logo), 'standby': bool(push_standby), 'results': results},
    )
    return Response({'success': True, 'results': results})


@api_view(['GET'])
def fm_theme_settings(request):
    """The Fleet Manager's own UI theme — currently just an optional
    partner/reseller logo shown alongside the MupiTech wordmark in the
    navbar (e.g. "MupiTech | [partner logo]"). Distinct from
    /api/system/branding/, which is about what gets pushed to player
    devices, not this app's own interface."""
    from players.models import FleetManagerTheme

    theme = FleetManagerTheme.get_solo()
    return Response({
        'partner_logo_url': theme.partner_logo.url if theme.partner_logo else None,
    })


@api_view(['POST'])
@permission_classes([IsAdmin])
def fm_theme_upload_partner_logo(request):
    """Upload the partner/reseller logo shown next to MupiTech in the navbar."""
    from players.models import FleetManagerTheme

    logo = request.FILES.get('logo')
    if not logo:
        return Response({'error': 'logo file is required'}, status=400)
    name_lower = logo.name.lower()
    if not name_lower.endswith(('.svg', '.png', '.jpg', '.jpeg')):
        return Response({'error': 'Only SVG, PNG or JPEG files are supported'}, status=400)

    theme = FleetManagerTheme.get_solo()
    theme.partner_logo.save(logo.name, logo, save=True)

    from history.logging import log_action
    log_action(request, 'upload', 'fm_theme_partner_logo')

    return Response({'success': True, 'partner_logo_url': theme.partner_logo.url})


@api_view(['DELETE'])
@permission_classes([IsAdmin])
def fm_theme_delete_partner_logo(request):
    """Remove the partner/reseller logo — the navbar reverts to showing just MupiTech."""
    from players.models import FleetManagerTheme

    theme = FleetManagerTheme.get_solo()
    if theme.partner_logo:
        theme.partner_logo.delete(save=True)
        from history.logging import log_action
        log_action(request, 'delete', 'fm_theme_partner_logo')
    return Response(status=204)
