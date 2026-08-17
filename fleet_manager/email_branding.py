"""Shared branded HTML shell for outbound alert emails.

The logo is embedded as a cid: inline attachment (not a data: URI) —
data: URIs render fine in Gmail/Apple Mail/new Outlook, but classic
Outlook (the Word-rendering-engine desktop app, still common in
municipal/corporate environments — this app's actual audience) doesn't
render `data:` image sources at all, and separately has never rendered
SVG either. Confirmed live: an email built the old way showed no image
whatsoever in Outlook classic. cid: attachments are the one embedding
method essentially every mail client (including classic Outlook) has
always supported, so the logo is pre-rasterized to PNG
(static/img/email-logo.png, rendered once from favicon.svg via
rsvg-convert — see that file for the source of truth) rather than
generated from SVG at send time, avoiding a new rasterization
dependency (cairosvg or similar) for a small icon that basically never
changes.

Shows MupiTech's own mark plus an optional partner/reseller logo
(players.models.FleetManagerTheme), mirroring how the Fleet Manager's
own navbar shows both side by side rather than one replacing the other.
Callers must attach the (content_id, mimetype, bytes) tuples
branded_email_html() returns as inline images with a matching
Content-ID — see fleet_manager/alerts.py::send_email.
"""
import mimetypes
from html import escape
from pathlib import Path

_LOGO_PNG_PATH = Path(__file__).resolve().parent.parent / 'static' / 'img' / 'email-logo.png'

BRAND_NAVY = '#04182B'
BRAND_YELLOW = '#FFE72D'

MUPITECH_LOGO_CID = 'mupitech-logo'
PARTNER_LOGO_CID = 'mupitech-partner-logo'


def _mupitech_logo_attachment():
    try:
        data = _LOGO_PNG_PATH.read_bytes()
    except OSError:
        return None
    return (MUPITECH_LOGO_CID, 'image/png', data)


def _partner_logo_attachment():
    from players.models import FleetManagerTheme

    theme = FleetManagerTheme.get_solo()
    if not theme.partner_logo:
        return None
    try:
        theme.partner_logo.open('rb')
        try:
            data = theme.partner_logo.read()
        finally:
            theme.partner_logo.close()
    except (OSError, ValueError):
        return None
    mime = mimetypes.guess_type(theme.partner_logo.name)[0] or 'image/png'
    # An SVG partner logo can't be embedded by cid: any better than by
    # data: — classic Outlook doesn't render SVG regardless of how it
    # arrives. Skipping it here (rather than embedding an image no mail
    # client will show) at least keeps the email layout clean; nothing
    # currently converts an uploaded SVG to a raster format for this.
    if mime == 'image/svg+xml':
        return None
    return (PARTNER_LOGO_CID, mime, data)


_DEFAULT_FOOTER = (
    'Este é um email automático do MupiTech Gestor de Mupis Digitais. '
    'Pode ajustar estas notificações em Definições &gt; Alertas.'
)


def branded_email_html(title, intro_html, body_html, footer_html=None):
    """Wraps `body_html` in the shared header/footer chrome. `title` and
    `intro_html` are already-safe HTML fragments the caller builds
    (interpolate any user-controlled text, e.g. a device name, through
    html.escape() first — see rows_table_html below for the one place
    that currently does). `footer_html` overrides the default "adjust
    these notifications in Settings > Alerts" line — wrong for
    transactional email (password reset, MFA codes) that has nothing to
    do with the alerts system.

    Returns (html, images) — images is a list of (content_id, mimetype,
    bytes) tuples the caller must attach as inline cid: images (see
    fleet_manager/alerts.py::send_email) for the <img src="cid:..."> tags
    below to actually resolve to anything.
    """
    images = []
    logo_attachment = _mupitech_logo_attachment()
    logo_src = f'cid:{MUPITECH_LOGO_CID}' if logo_attachment else ''
    if logo_attachment:
        images.append(logo_attachment)

    partner_attachment = _partner_logo_attachment()
    partner_html = ''
    if partner_attachment:
        images.append(partner_attachment)
        partner_html = (
            f'<td style="padding-left:12px;border-left:1px solid #33465c;">'
            f'<img src="cid:{PARTNER_LOGO_CID}" alt="" height="36" style="display:block;max-height:36px;width:auto;"/>'
            f'</td>'
        )

    html = f'''<!DOCTYPE html>
<html lang="pt">
<body style="margin:0;padding:0;background:#f2f4f7;font-family:'Segoe UI',Arial,sans-serif;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f2f4f7;padding:24px 0;">
<tr><td align="center">
<table role="presentation" width="560" cellpadding="0" cellspacing="0" style="max-width:560px;width:100%;background:#ffffff;border-radius:8px;overflow:hidden;border:1px solid #e2e5ea;">
<tr><td style="background:{BRAND_NAVY};padding:20px 24px;">
<table role="presentation" cellpadding="0" cellspacing="0"><tr>
<td><img src="{logo_src}" alt="MupiTech" height="36" style="display:block;"/></td>
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
<p style="margin:0;font-size:12px;color:#8a8f98;">{footer_html or _DEFAULT_FOOTER}</p>
</td></tr>
</table>
</td></tr>
</table>
</body>
</html>'''
    return html, images


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
