"""Shared branded HTML shell for outbound alert emails.

The logo is inlined as a base64 data: URI rather than referenced by URL —
this app is frequently self-hosted with no public domain, and even when
one exists, most mail clients block remotely-fetched images by default
until the user opts in, which would defeat the point of a branded email.
A data: URI always renders regardless of network reachability.

Shows MupiTech's own mark plus an optional partner/reseller logo
(players.models.FleetManagerTheme), mirroring how the Fleet Manager's
own navbar shows both side by side rather than one replacing the other.
"""
import base64
import mimetypes
from html import escape
from pathlib import Path

_FAVICON_PATH = Path(__file__).resolve().parent.parent / 'static' / 'img' / 'favicon.svg'

BRAND_NAVY = '#04182B'
BRAND_YELLOW = '#FFE72D'


def _mupitech_logo_data_uri():
    # favicon.svg (not icon-192.png, the PWA install icon) — confirmed
    # correct MupiTech mark by reading its own markup directly rather
    # than eyeballing a raster image; the PWA icon set's actual
    # provenance is unclear and an operator reported it rendering as
    # what looked like a leftover Anthias mark in a real test email.
    try:
        data = _FAVICON_PATH.read_bytes()
    except OSError:
        return ''
    return f'data:image/svg+xml;base64,{base64.b64encode(data).decode()}'


def _partner_logo_data_uri():
    from players.models import FleetManagerTheme

    theme = FleetManagerTheme.get_solo()
    if not theme.partner_logo:
        return ''
    try:
        theme.partner_logo.open('rb')
        try:
            data = theme.partner_logo.read()
        finally:
            theme.partner_logo.close()
    except (OSError, ValueError):
        return ''
    mime = mimetypes.guess_type(theme.partner_logo.name)[0] or 'image/png'
    return f'data:{mime};base64,{base64.b64encode(data).decode()}'


def branded_email_html(title, intro_html, body_html):
    """Wraps `body_html` in the shared header/footer chrome. `title` and
    `intro_html` are already-safe HTML fragments the caller builds
    (interpolate any user-controlled text, e.g. a device name, through
    html.escape() first — see rows_table_html below for the one place
    that currently does)."""
    logo = _mupitech_logo_data_uri()
    partner_logo = _partner_logo_data_uri()
    partner_html = (
        f'<td style="padding-left:12px;border-left:1px solid #33465c;">'
        f'<img src="{partner_logo}" alt="" height="36" style="display:block;max-height:36px;width:auto;"/>'
        f'</td>'
    ) if partner_logo else ''

    return f'''<!DOCTYPE html>
<html lang="pt">
<body style="margin:0;padding:0;background:#f2f4f7;font-family:'Segoe UI',Arial,sans-serif;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f2f4f7;padding:24px 0;">
<tr><td align="center">
<table role="presentation" width="560" cellpadding="0" cellspacing="0" style="max-width:560px;width:100%;background:#ffffff;border-radius:8px;overflow:hidden;border:1px solid #e2e5ea;">
<tr><td style="background:{BRAND_NAVY};padding:20px 24px;">
<table role="presentation" cellpadding="0" cellspacing="0"><tr>
<td><img src="{logo}" alt="MupiTech" height="36" style="display:block;"/></td>
{partner_html}
<td style="padding-left:12px;"><span style="color:#ffffff;font-size:16px;font-weight:600;">MupiTech <span style="color:{BRAND_YELLOW};">Gestor de Mupis Digitais</span></span></td>
</tr></table>
</td></tr>
<tr><td style="padding:24px;">
<h1 style="margin:0 0 8px 0;font-size:18px;color:#1a1a1a;">{title}</h1>
{intro_html}
{body_html}
</td></tr>
<tr><td style="padding:16px 24px;background:#f8f9fb;border-top:1px solid #e2e5ea;">
<p style="margin:0;font-size:12px;color:#8a8f98;">Este é um email automático do MupiTech Gestor de Mupis Digitais. Pode ajustar estas notificações em Definições &gt; Alertas.</p>
</td></tr>
</table>
</td></tr>
</table>
</body>
</html>'''


def offline_players_table_html(offline_players):
    """HTML table of (name, last-seen) rows — device names are
    admin-entered free text, so always escaped before interpolation."""
    rows = []
    for player in offline_players:
        last_seen = player.last_seen.strftime('%d/%m/%Y %H:%M') if player.last_seen else 'nunca'
        rows.append(
            '<tr>'
            f'<td style="padding:10px 12px;border-bottom:1px solid #eef0f3;font-size:14px;color:#1a1a1a;">{escape(player.name)}</td>'
            f'<td style="padding:10px 12px;border-bottom:1px solid #eef0f3;font-size:13px;color:#6b7280;text-align:right;white-space:nowrap;">{escape(last_seen)}</td>'
            '</tr>'
        )
    return (
        '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" '
        'style="margin-top:12px;border:1px solid #eef0f3;border-radius:6px;overflow:hidden;border-collapse:collapse;">'
        + ''.join(rows) + '</table>'
    )
