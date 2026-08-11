"""Push fleet-wide custom branding assets to a device over SSH.

Anthias reads two branding-relevant images as plain static files, both
served directly by WhiteNoise's StaticFilesStorage — neither is baked
into any compiled Qt resource:
  - settings['splash_logo_url'] (default /static/img/logo-full-splash.svg)
    — logo on the network/IP "splash" screen shown on first boot / no
    server configured yet.
  - STANDBY_SCREEN (anthias_viewer/constants.py, always
    /static/img/standby.png) — shown whenever there is no content
    scheduled to play (the "black screen" between/without assets).

Overwriting these files inside the running anthias-server container
and restarting it is enough to rebrand them, no image rebuild needed.
See docs/anthias-version-analysis.md.
"""

import base64
import os
import re
from urllib.parse import urlparse

from django.conf import settings

from .provision import _shell_quote, _ssh_run

BRANDING_DIR = os.path.join(settings.MEDIA_ROOT, 'branding')

BRANDING_LOGO_FILENAME = 'splash-logo.svg'
CONTAINER_LOGO_PATH = '/usr/src/app/staticfiles/img/logo-full-splash.svg'
REMOTE_TMP_LOGO_PATH = '/tmp/mupitech-splash-logo.svg'
# Bundled MupiTech logo, pushed when no custom one has been uploaded —
# "remove custom logo" reverts to this rather than leaving nothing to push.
DEFAULT_LOGO_PATH = os.path.join(settings.BASE_DIR, 'static', 'img', 'logo.svg')

STANDBY_FILENAME = 'standby-image.png'
CONTAINER_STANDBY_PATH = '/usr/src/app/staticfiles/img/standby.png'
REMOTE_TMP_STANDBY_PATH = '/tmp/mupitech-standby-image.png'

CONTAINER_CSS_PATH = '/usr/src/app/staticfiles/dist/css/anthias.css'

# The splash-page is a server-rendered Django template (not a collected
# static file), so it lives under the app's source tree rather than
# staticfiles/ — see src/anthias_server/app/templates/splash-page.html
# in Screenly/Anthias, copied verbatim into /usr/src/app/ by the image's
# `COPY . /usr/src/app/`.
CONTAINER_SPLASH_TEMPLATE_PATH = '/usr/src/app/src/anthias_server/app/templates/splash-page.html'
# Anthias's splash-page ships hardcoded English copy with no i18n of its
# own. Translated here (and its two "Anthias" brand mentions swapped for
# MupiTech, consistent with the logo/color rebrand) via the same in-place
# sed used for the CSS colors above — the strings are unique substrings
# of the template, so a plain substitution is reliable without needing
# the device's real file contents.
SPLASH_TRANSLATION_REPLACEMENTS = [
    ('<html lang="en">', '<html lang="pt">'),
    ('<title>Welcome to Anthias</title>', '<title>Bem-vindo ao MupiTech</title>'),
    ('alt="Anthias"', 'alt="MupiTech"'),
    ('Detecting network&hellip;', 'A detetar rede&hellip;'),
    ('Ready to manage', 'Pronto a gerir'),
    ('Open this on your phone or laptop', 'Abra isto no seu telemóvel ou computador'),
    (
        'Point a browser at one of the addresses below, or scan the QR code.',
        'Aceda a um dos endereços abaixo no navegador, ou leia o código QR.',
    ),
    ('Scan to manage', 'Ler para gerir'),
]
# Official Anthias's $anthias-purple-1..5 (src/anthias_server/app/static/sass/_variables.scss)
# and the splash-page's two radial-gradient glows, mapped to this project's
# own blue palette (static/sass/_variables.scss). Sass's --style=compressed
# output preserves color literals verbatim (no auto hex-shortening), so a
# plain in-place sed on the already-compiled CSS is reliable — no rebuild,
# no re-uploading the whole file.
THEME_COLOR_REPLACEMENTS = [
    ('#270035', '#04182B'),   # $anthias-purple-1 (--color-bg, splash gradient start)
    ('#492955', '#0C3A5C'),   # $anthias-purple-2 (--color-active)
    ('#52335D', '#005096'),   # $anthias-purple-3 (--color-bg-elevated)
    ('#D4CCD7', '#CFE3F0'),   # $anthias-purple-4
    ('#8819C7', '#0082C8'),   # $anthias-purple-5
    ('#0f0019', '#04182B'),   # --color-bg-deep (splash background-color)
    ('#503061', '#0d3f66'),   # --color-active-tint (gradient stop)
    ('rgba(124, 48, 205,', 'rgba(0, 130, 200,'),  # splash radial glow 1
    ('rgba(91, 32, 144,', 'rgba(12, 58, 92,'),    # splash radial glow 2
]


class BrandingPushError(Exception):
    """Raised when pushing a branding asset to a device fails."""


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


STANDBY_MARGIN_RATIO = 0.2  # 20% padding on each side, so it doesn't bleed to the screen edges


def convert_to_png(file_obj, add_margin=False, margin_ratio=STANDBY_MARGIN_RATIO):
    """Convert an uploaded SVG/PNG/JPEG to real PNG bytes.

    Unlike the logo, standby.png's fixed filename is loaded by the
    viewer as a plain raster image — serving SVG bytes under a .png
    name isn't reliable there, so this always rasterizes to real PNG.

    With add_margin=True (used for the standby image), the picture is
    scaled down and centered on a black canvas with a safety margin
    instead of filling every pixel edge-to-edge.
    """
    from PIL import Image

    file_obj.seek(0)
    with Image.open(file_obj) as img:
        if add_margin:
            img = _with_safety_margin(img, margin_ratio)
        buf = _png_bytes(img)
    return buf


def _with_safety_margin(img, margin_ratio):
    """Return a new image with `img` centered on a black canvas of the
    same size, scaled down to leave `margin_ratio` of padding on each side.
    """
    from PIL import Image

    img = img.convert('RGBA')
    width, height = img.size
    scale = 1 - (2 * margin_ratio)
    inner_width = max(1, round(width * scale))
    inner_height = max(1, round(height * scale))
    resized = img.resize((inner_width, inner_height), Image.LANCZOS)

    canvas = Image.new('RGBA', (width, height), (0, 0, 0, 255))
    offset = ((width - inner_width) // 2, (height - inner_height) // 2)
    canvas.paste(resized, offset, resized)
    return canvas


def _png_bytes(img):
    import io
    buf = io.BytesIO()
    img.convert('RGBA').save(buf, format='PNG')
    return buf.getvalue()


def get_logo_path(player=None):
    """Absolute path to the logo that would be pushed for `player`.

    Precedence: the player's own logo, then its group's, then its
    effective location's, then the fleet-wide custom logo, then the
    bundled MupiTech default. Passing no player skips straight to the
    fleet-wide resolution (used by the Settings page preview).
    """
    if player is not None:
        if player.splash_logo:
            return player.splash_logo.path
        if player.group_id and player.group.splash_logo:
            return player.group.splash_logo.path
        location = player.effective_location
        if location and location.splash_logo:
            return location.splash_logo.path
    custom = os.path.join(BRANDING_DIR, BRANDING_LOGO_FILENAME)
    return custom if os.path.isfile(custom) else DEFAULT_LOGO_PATH


def get_standby_path(player=None):
    """Absolute path to the standby image that would be pushed for
    `player`, or None if nothing is set at any level (device, group,
    location, fleet-wide) — same precedence as get_logo_path, but with
    no bundled default.
    """
    if player is not None:
        if player.standby_image:
            return player.standby_image.path
        if player.group_id and player.group.standby_image:
            return player.group.standby_image.path
        location = player.effective_location
        if location and location.standby_image:
            return location.standby_image.path
    path = os.path.join(BRANDING_DIR, STANDBY_FILENAME)
    return path if os.path.isfile(path) else None


def save_logo_upload(instance, uploaded_file):
    """Save an SVG/PNG/JPEG upload as `instance.splash_logo` (a Group or
    Location). Raises ValueError on an unsupported format."""
    from django.core.files.base import ContentFile

    name_lower = uploaded_file.name.lower()
    if name_lower.endswith('.svg'):
        instance.splash_logo.save('logo.svg', uploaded_file, save=True)
    elif name_lower.endswith(('.png', '.jpg', '.jpeg')):
        svg_bytes = wrap_raster_as_svg(uploaded_file, uploaded_file.name)
        instance.splash_logo.save('logo.svg', ContentFile(svg_bytes), save=True)
    else:
        raise ValueError('Only SVG, PNG or JPEG files are supported')


def save_standby_upload(instance, uploaded_file):
    """Save a PNG/JPEG upload as `instance.standby_image` (a Group or
    Location), always converted to real PNG bytes. Raises ValueError on
    an unsupported format."""
    from django.core.files.base import ContentFile

    name_lower = uploaded_file.name.lower()
    if not name_lower.endswith(('.png', '.jpg', '.jpeg')):
        raise ValueError('Only PNG or JPEG files are supported')
    png_bytes = convert_to_png(uploaded_file, add_margin=True)
    instance.standby_image.save('standby.png', ContentFile(png_bytes), save=True)


def _push_file_to_player(player, ssh_user, ssh_password, ssh_port, timeout,
                          local_path, remote_tmp_path, container_path):
    import paramiko

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
            sftp.put(local_path, remote_tmp_path)
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
            f'docker cp {remote_tmp_path} {_shell_quote(container)}:{container_path}',
            timeout=timeout,
        )
        _ssh_run(ssh, f'docker restart {_shell_quote(container)}', timeout=timeout)
        _ssh_run(ssh, f'rm -f {remote_tmp_path}', timeout=timeout, check=False)
    except BrandingPushError:
        raise
    except Exception as exc:
        raise BrandingPushError(str(exc)) from exc
    finally:
        ssh.close()


def push_splash_logo_to_player(player, ssh_user, ssh_password, ssh_port=22, timeout=15):
    """SSH into `player`'s host and replace its Anthias splash-page logo.

    Uses the most specific logo set for this player: its group's, else
    its location's, else the fleet-wide one, else the bundled default.
    """
    _push_file_to_player(
        player, ssh_user, ssh_password, ssh_port, timeout,
        local_path=get_logo_path(player),
        remote_tmp_path=REMOTE_TMP_LOGO_PATH,
        container_path=CONTAINER_LOGO_PATH,
    )


def push_standby_image_to_player(player, ssh_user, ssh_password, ssh_port=22, timeout=15):
    """SSH into `player`'s host and replace its "no content" standby image.

    Same group/location/fleet-wide precedence as the logo, but raises
    BrandingPushError if nothing is set at any level — unlike the logo
    there's no bundled default (a good placeholder needs real design
    input, not just this app's own icon stretched to fill it).
    """
    standby_path = get_standby_path(player)
    if not standby_path:
        raise BrandingPushError('No custom standby image has been uploaded yet.')
    _push_file_to_player(
        player, ssh_user, ssh_password, ssh_port, timeout,
        local_path=standby_path,
        remote_tmp_path=REMOTE_TMP_STANDBY_PATH,
        container_path=CONTAINER_STANDBY_PATH,
    )


def _sed_search_escape(value):
    """Escape a plain string for safe use as a sed search pattern."""
    return re.sub(r'([\\.*/\[\]^$])', r'\\\1', value)


def _sed_replacement_escape(value):
    """Escape a plain string for safe use as a sed replacement (sed gives
    `&` and `/` special meaning there; search-only metacharacters like
    `.`/`*` don't apply)."""
    return re.sub(r'([\\&/])', r'\\\1', value)


def _sed_patch_container_file(player, ssh_user, ssh_password, ssh_port, timeout,
                               container_path, replacements):
    """SSH into `player`'s host and run an in-place sed on `container_path`
    inside the running anthias-server container, then restart it."""
    import paramiko

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

        sed_expr = ' '.join(
            f"-e {_shell_quote(f's/{_sed_search_escape(old)}/{_sed_replacement_escape(new)}/g')}"
            for old, new in replacements
        )
        _ssh_run(
            ssh,
            f'docker exec {_shell_quote(container)} sed -i {sed_expr} {container_path}',
            timeout=timeout,
        )
        _ssh_run(ssh, f'docker restart {_shell_quote(container)}', timeout=timeout)
    except BrandingPushError:
        raise
    except Exception as exc:
        raise BrandingPushError(str(exc)) from exc
    finally:
        ssh.close()


def push_theme_color_to_player(player, ssh_user, ssh_password, ssh_port=22, timeout=15):
    """SSH into `player`'s host and replace Anthias's purple theme colors
    (splash-page background gradient, active-state accents) with this
    project's blue palette, via an in-place sed on the already-compiled
    anthias.css — no rebuild, no re-uploading the whole file.
    """
    _sed_patch_container_file(
        player, ssh_user, ssh_password, ssh_port, timeout,
        container_path=CONTAINER_CSS_PATH,
        replacements=THEME_COLOR_REPLACEMENTS,
    )


def push_splash_translation_to_player(player, ssh_user, ssh_password, ssh_port=22, timeout=15):
    """SSH into `player`'s host and translate the splash-page's hardcoded
    English copy to Portuguese (and its "Anthias" brand mentions to
    MupiTech), via an in-place sed on the server-rendered template.
    """
    _sed_patch_container_file(
        player, ssh_user, ssh_password, ssh_port, timeout,
        container_path=CONTAINER_SPLASH_TEMPLATE_PATH,
        replacements=SPLASH_TRANSLATION_REPLACEMENTS,
    )
