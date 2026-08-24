import os

from django.conf import settings
from django.core.cache import cache

# Global (fleet-wide, not per-player/group/location — see the plan doc's
# "Decisão de arquitetura" note) footer settings: how long between
# automatic show cycles, and the optional logo shown at the ticker's
# left edge. 0 minutes means "always visible", the pre-existing
# behavior, so installs that never touch this setting are unaffected.
FOOTER_CYCLE_INTERVAL_MINUTES_KEY = 'system:footer_cycle_interval_minutes'
FOOTER_LOGO_DIR = os.path.join(settings.MEDIA_ROOT, 'footer')
FOOTER_LOGO_FILENAME = 'footer-logo.png'


def footer_logo_path():
    return os.path.join(FOOTER_LOGO_DIR, FOOTER_LOGO_FILENAME)


def footer_cycle_interval_minutes():
    return cache.get(FOOTER_CYCLE_INTERVAL_MINUTES_KEY, 0)


def footer_logo_relative_url():
    """``/media/footer/footer-logo.png?v=<mtime>``, or None if nothing's
    uploaded — used for the admin-facing preview in Settings.

    The ``?v=`` cache-buster matters here too, not just for the device:
    the filename never changes across re-uploads, so a browser that
    already fetched the old one would otherwise keep showing it from
    its own cache after a replace, same failure mode as the device's
    applyFooterLogo() (see footer_logo_absolute_url)."""
    if not os.path.isfile(footer_logo_path()):
        return None
    version = int(os.path.getmtime(footer_logo_path()))
    return f'/media/footer/{FOOTER_LOGO_FILENAME}?v={version}'


def footer_logo_absolute_url():
    """Absolute URL the device fetches the footer logo from, or '' if
    either no logo is uploaded or FM_PUBLIC_URL isn't configured.

    The device's C++ webview has no other way to know the Fleet
    Manager's own public address (it has no outbound HTTP client to
    it at all outside this one setting) and this is built from a
    Celery task with no `request` to call build_absolute_uri() on —
    hence the dedicated env var instead of the usual per-request
    helper (see content/serializers.py for that request-based pattern,
    not applicable here).

    Carries the same ``?v=<mtime>`` cache-buster as footer_logo_relative_url
    — the device's own applyFooterLogo() skips re-fetching a URL it
    already applied, so without this, replacing the logo would
    silently keep showing the old one until the device's next
    reboot/respawn."""
    relative = footer_logo_relative_url()
    if not settings.FM_PUBLIC_URL or relative is None:
        return ''
    return f'{settings.FM_PUBLIC_URL}{relative}'


def _flatten_message(text):
    """Collapse admin-authored, possibly multi-line `message` text into
    the single line the device's ticker always renders — joins
    non-empty stripped lines with a space rather than passing raw
    newlines through (which would otherwise show up as odd gaps/breaks
    once concatenated into the ticker string)."""
    lines = [line.strip() for line in (text or '').splitlines()]
    return ' '.join(line for line in lines if line)


def compute_message_map_for_players(player_ids):
    """{str(player_id): [ordered active message texts]} for the given ids.

    Iterates active FooterMessage rows in ``order`` and appends each
    one's (flattened) message to every player it targets, so a player's
    list already comes out in the right ticker order without a separate
    sort step.
    """
    from .models import FooterMessage

    result = {str(pid): [] for pid in player_ids}
    messages = FooterMessage.objects.filter(is_active=True).order_by('order', 'created_at')
    for message in messages:
        flattened = _flatten_message(message.message)
        if not flattened:
            continue
        for player in message.resolve_target_players():
            key = str(player.id)
            if key in result:
                result[key].append(flattened)
    return result
