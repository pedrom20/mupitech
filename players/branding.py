"""Push per-fleet/group/location/player branding overrides to a device.

The MupiTech brand (blue palette, Portuguese copy, MupiTech logo/standby
defaults) is baked directly into the mupitech-player image's source as
of the fork's "gravar marca MupiTech na propria imagem" change — a
freshly (re)provisioned device is already correctly branded with no push
needed. This module now only covers two things that genuinely can't be
baked into a single shared image at build time:

  - A CUSTOM logo/standby image, overriding the baked-in MupiTech
    default for a specific fleet/group/location/player. Still pushed by
    overwriting a file inside the running anthias-server container
    (settings['splash_logo_url'], default /static/img/logo-full-splash.svg;
    STANDBY_SCREEN in anthias_viewer/constants.py, always
    /static/img/standby.png) — both served directly by WhiteNoise's
    StaticFilesStorage. This still lives in the container's writable
    layer, so a container recreate (image update, Watchtower
    auto-update) reverts an override back to the baked-in MupiTech
    default — never back to Anthias's own branding, which is the actual
    failure mode this whole redesign was for.
  - The per-device identification chip (location/group/name) — see
    push_device_label_to_player below, which writes straight to a host
    path the compose file bind-mounts in, so it DOES survive a container
    recreate.

See docs/anthias-version-analysis.md.
"""

import base64
import json as _json
import os
from urllib.parse import urlparse

from django.conf import settings

from .provision import _home_layout, _shell_quote, _ssh_run

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

# Video standby (mp4/webm) — a distinct fixed filename per extension so
# switching from one video format (or from an image) to the other
# doesn't leave a stale file the viewer might pick up instead; see the
# `also_remove` cleanup in push_standby_image_to_player.
STANDBY_VIDEO_EXTENSIONS = ('.mp4', '.webm')
CONTAINER_STANDBY_VIDEO_PATHS = {
    '.mp4': '/usr/src/app/staticfiles/img/standby.mp4',
    '.webm': '/usr/src/app/staticfiles/img/standby.webm',
}
REMOTE_TMP_STANDBY_VIDEO_PATHS = {
    '.mp4': '/tmp/mupitech-standby-video.mp4',
    '.webm': '/tmp/mupitech-standby-video.webm',
}


def is_video_standby_path(path):
    return path.lower().endswith(STANDBY_VIDEO_EXTENSIONS)


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
    """Convert an uploaded PNG/JPEG/GIF to real image bytes for the
    standby slot.

    An animated GIF is passed through unchanged rather than rasterized —
    the viewer's C++ webview already plays animated GIFs natively via
    QMovie (anthias_webview/src/view.cpp: tryLoadAsAnimatedGif), decoding
    by the actual byte signature rather than the file extension, so
    serving GIF bytes under the fixed standby.png filename/URL still
    animates correctly on the device (and in a plain browser <img> tag
    for previews here — same content-sniffing behaviour). The safety-
    margin treatment below is static-image-only: re-flowing it across
    every frame of an animated GIF isn't worth the complexity for what's
    a cosmetic border.

    Any other upload (including a non-animated/single-frame GIF) is
    rasterized to a real PNG same as before.
    """
    from PIL import Image

    file_obj.seek(0)
    with Image.open(file_obj) as img:
        if getattr(img, 'is_animated', False):
            file_obj.seek(0)
            return file_obj.read()
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
    for filename in (STANDBY_FILENAME, 'standby.mp4', 'standby.webm'):
        path = os.path.join(BRANDING_DIR, filename)
        if os.path.isfile(path):
            return path
    return None


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
    """Save a PNG/JPEG/GIF/MP4/WEBM upload as `instance.standby_image`
    (a Group, Location or Player) — an animated GIF is kept as-is (see
    convert_to_png), a static image is converted to real PNG bytes, and
    a video is stored byte-for-byte under a fixed name matching its own
    extension (no transcoding — the device plays it directly via a
    looping <video> tag, see mupitech-player's standby-video view).
    Raises ValueError on an unsupported format."""
    from django.core.files.base import ContentFile

    name_lower = uploaded_file.name.lower()
    if name_lower.endswith(STANDBY_VIDEO_EXTENSIONS):
        ext = '.mp4' if name_lower.endswith('.mp4') else '.webm'
        instance.standby_image.save(f'standby{ext}', uploaded_file, save=True)
        return
    if not name_lower.endswith(('.png', '.jpg', '.jpeg', '.gif')):
        raise ValueError('Only PNG, JPEG, GIF, MP4 or WEBM files are supported')
    image_bytes = convert_to_png(uploaded_file, add_margin=True)
    instance.standby_image.save('standby.png', ContentFile(image_bytes), save=True)


def _push_file_to_player(player, ssh_user, ssh_password, ssh_port, timeout,
                          local_path, remote_tmp_path, container_path,
                          also_remove=None, also_restart=None):
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
        # Clear out any other standby-slot file the container might
        # already have (e.g. a previous video override when this push
        # is an image, or the other video extension) — the standby
        # slot is meant to hold exactly one file at a time; leaving a
        # stale one behind would make the viewer's own detection
        # (checks for standby.mp4/webm before falling back to the
        # image) pick the wrong one.
        for stale_path in (also_remove or []):
            _ssh_run(
                ssh,
                f'docker exec {_shell_quote(container)} rm -f {stale_path}',
                timeout=timeout, check=False,
            )
        _ssh_run(ssh, f'docker restart {_shell_quote(container)}', timeout=timeout)

        # anthias-viewer is a separate container/process from
        # anthias-server — it resolves and caches which standby asset
        # to show (image vs video) once, in its own memory, the first
        # time the playlist goes empty (see _standby_target in
        # anthias_viewer/__init__.py). Restarting anthias-server alone
        # never invalidates that cache, so a newly-pushed standby
        # override silently never appears until the device's next full
        # reboot. Best-effort: a missing/stopped viewer container (or a
        # push that doesn't need this, like the splash logo) is fine to
        # skip, not fail the whole push over.
        for extra_name in (also_restart or []):
            out2, _, _ = _ssh_run(
                ssh, f"docker ps --format '{{{{.Names}}}}' --filter name={_shell_quote(extra_name)}",
                timeout=timeout, check=False,
            )
            extra_container = next((line for line in out2.strip().splitlines() if line.strip()), '')
            if extra_container:
                _ssh_run(ssh, f'docker restart {_shell_quote(extra_container)}', timeout=timeout, check=False)

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
    """SSH into `player`'s host and replace its "no content" standby
    slot — an image (PNG/animated GIF) or a video (MP4/WEBM).

    Same group/location/fleet-wide precedence as the logo, but raises
    BrandingPushError if nothing is set at any level — unlike the logo
    there's no bundled default (a good placeholder needs real design
    input, not just this app's own icon stretched to fill it).
    """
    standby_path = get_standby_path(player)
    if not standby_path:
        raise BrandingPushError('No custom standby image has been uploaded yet.')

    if is_video_standby_path(standby_path):
        ext = os.path.splitext(standby_path)[1].lower()
        container_path = CONTAINER_STANDBY_VIDEO_PATHS[ext]
        remote_tmp_path = REMOTE_TMP_STANDBY_VIDEO_PATHS[ext]
        also_remove = [CONTAINER_STANDBY_PATH] + [
            p for e, p in CONTAINER_STANDBY_VIDEO_PATHS.items() if e != ext
        ]
    else:
        container_path = CONTAINER_STANDBY_PATH
        remote_tmp_path = REMOTE_TMP_STANDBY_PATH
        also_remove = list(CONTAINER_STANDBY_VIDEO_PATHS.values())

    _push_file_to_player(
        player, ssh_user, ssh_password, ssh_port, timeout,
        local_path=standby_path,
        remote_tmp_path=remote_tmp_path,
        container_path=container_path,
        also_remove=also_remove,
        also_restart=['anthias-viewer'],
    )


def push_device_label_to_player(player, ssh_user, ssh_password, ssh_port=22, timeout=15):
    """SSH into `player`'s host and write its identification chip data
    (location/group/device name — shown as a small pill in the
    bottom-right corner of the splash-page) directly to the host path
    the compose file bind-mounts into the container.

    Deliberately NOT pushed into the container's writable layer like
    the logo/standby overrides above: this file needs to survive a
    container recreate (image update, Watchtower auto-update), which a
    host bind mount does and the writable layer doesn't. See
    provision.py's _touch_device_label_placeholder (guarantees the host
    file exists before it's ever bind-mounted — an absent host file
    would make Docker mount an empty directory there instead) and the
    mupitech-device-label.json volume entry in the
    docker-compose-player-*.yml templates.

    No container restart needed — splash-page.html's own inline script
    fetches this fresh (cache: 'no-store') on every page load.
    """
    import paramiko

    host = urlparse(player.url).hostname
    if not host:
        raise BrandingPushError(f"Could not determine host from player URL: {player.url}")

    data = {}
    location = player.effective_location
    if location and location.name:
        data['location'] = location.name
    if player.group_id and player.group.name:
        data['group'] = player.group.name
    if player.name:
        data['name'] = player.name

    layout = _home_layout(player.device_type)
    label_path = f'/home/{ssh_user}/{layout["config_dir"]}/mupitech-device-label.json'

    ssh = paramiko.SSHClient()
    ssh.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    try:
        ssh.connect(host, port=ssh_port, username=ssh_user, password=ssh_password, timeout=timeout)
    except Exception as exc:
        raise BrandingPushError(f'SSH connection failed: {exc}') from exc

    try:
        sftp = ssh.open_sftp()
        try:
            with sftp.file(label_path, 'w') as f:
                f.write(_json.dumps(data))
        finally:
            sftp.close()
    except Exception as exc:
        raise BrandingPushError(str(exc)) from exc
    finally:
        ssh.close()
