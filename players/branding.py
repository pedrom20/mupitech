"""Push the fleet-wide custom splash logo to a device over SSH.

Anthias's idle "splash" screen reads its logo from a plain static file
(settings['splash_logo_url'], default /static/img/logo-full-splash.svg)
served directly by WhiteNoise's StaticFilesStorage — not baked into any
compiled Qt resource. Overwriting that file inside the running
anthias-server container and restarting it is enough to rebrand it,
no image rebuild needed. See docs/anthias-version-analysis.md.
"""

import base64
import os
from urllib.parse import urlparse

from django.conf import settings

from .provision import _shell_quote, _ssh_run

REMOTE_TMP_PATH = '/tmp/mupitech-splash-logo.svg'
CONTAINER_STATIC_PATH = '/usr/src/app/staticfiles/img/logo-full-splash.svg'
BRANDING_DIR = os.path.join(settings.MEDIA_ROOT, 'branding')
BRANDING_LOGO_FILENAME = 'splash-logo.svg'
# Bundled MupiTech logo, pushed when no custom one has been uploaded —
# "remove custom logo" reverts to this rather than leaving nothing to push.
DEFAULT_LOGO_PATH = os.path.join(settings.BASE_DIR, 'static', 'img', 'logo.svg')


class BrandingPushError(Exception):
    """Raised when pushing the custom splash logo to a device fails."""


def wrap_raster_as_svg(file_obj, filename):
    """Wrap a PNG/JPEG upload in a minimal SVG container.

    The device always expects a file named logo-full-splash.svg (Anthias's
    default splash_logo_url) — wrapping the raster bytes as a data: URI
    inside an <svg><image> lets any format be served under that fixed
    name without a real (and lossy) vector-tracing conversion.
    """
    from PIL import Image

    file_obj.seek(0)
    with Image.open(file_obj) as img:
        width, height = img.size
    file_obj.seek(0)
    raw = file_obj.read()

    ext = 'png' if filename.lower().endswith('.png') else 'jpeg'
    encoded = base64.b64encode(raw).decode('ascii')
    svg = (
        f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {width} {height}" '
        f'width="{width}" height="{height}">'
        f'<image width="{width}" height="{height}" '
        f'href="data:image/{ext};base64,{encoded}"/></svg>'
    )
    return svg.encode('utf-8')


def get_logo_path():
    """Absolute path to the logo that would be pushed: the uploaded
    fleet-wide custom one if set, otherwise the bundled MupiTech default.
    """
    custom = os.path.join(BRANDING_DIR, BRANDING_LOGO_FILENAME)
    return custom if os.path.isfile(custom) else DEFAULT_LOGO_PATH


def push_splash_logo_to_player(player, ssh_user, ssh_password, ssh_port=22, timeout=15):
    """SSH into `player`'s host and replace its Anthias splash-page logo."""
    import paramiko

    logo_path = get_logo_path()

    host = urlparse(player.url).hostname
    if not host:
        raise BrandingPushError(f"Could not determine host from player URL: {player.url}")

    ssh = paramiko.SSHClient()
    ssh.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    try:
        ssh.connect(host, port=ssh_port, username=ssh_user, password=ssh_password, timeout=timeout)
    except Exception as exc:
        raise BrandingPushError(f'SSH connection failed: {exc}') from exc

    try:
        sftp = ssh.open_sftp()
        try:
            sftp.put(logo_path, REMOTE_TMP_PATH)
        finally:
            sftp.close()

        out, _, _ = _ssh_run(
            ssh,
            "docker ps --format '{{.Names}}' --filter name=anthias-server",
            timeout=timeout,
        )
        container = next((line for line in out.strip().splitlines() if line.strip()), '')
        if not container:
            raise BrandingPushError(
                'Could not find a running anthias-server container on this device.'
            )

        _ssh_run(
            ssh,
            f'docker cp {REMOTE_TMP_PATH} {_shell_quote(container)}:{CONTAINER_STATIC_PATH}',
            timeout=timeout,
        )
        _ssh_run(ssh, f'docker restart {_shell_quote(container)}', timeout=timeout)
        _ssh_run(ssh, f'rm -f {REMOTE_TMP_PATH}', timeout=timeout, check=False)
    except BrandingPushError:
        raise
    except Exception as exc:
        raise BrandingPushError(str(exc)) from exc
    finally:
        ssh.close()
