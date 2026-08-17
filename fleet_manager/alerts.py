"""Email sending for the whole app — offline-device alerts, email-OTP
MFA (mfa/email_otp.py), and password reset (fleet_manager/urls.py) all
go through send_email() below, sharing one admin-configured "how do we
send email" setting rather than each keeping its own credential.

Settings are stored the same way as the other system-wide settings in
system_views.py — Redis cache keys with no TTL, not a DB model — so the
"alert_settings" API view can follow the exact same GET/PATCH pattern as
tailscale_settings. Kept in its own module (rather than system_views.py)
because players/tasks.py also needs the sending logic, and importing
tasks.py from system_views.py (or vice versa) would risk import cycles.

Two delivery modes, picked by EMAIL_MODE_KEY:
  - 'smtp' (default) — a direct SMTP connection, as before.
  - 'graph' — Microsoft Graph's /sendMail, for tenants whose Microsoft
    365 setup blocks basic SMTP AUTH (increasingly the default) and
    requires an app registration instead. Needs an Entra ID app
    registration with the *application* (not delegated) Mail.Send
    permission, admin-consented, and ideally scoped to the sending
    mailbox via an ApplicationAccessPolicy — none of that is this
    module's concern, just the client-credentials call once it's set
    up on the Microsoft 365 side.
"""
import logging

from django.core.cache import cache

logger = logging.getLogger(__name__)

ALERTS_ENABLED_KEY = 'system:alerts_enabled'
ALERTS_THRESHOLD_MINUTES_KEY = 'system:alerts_offline_threshold_minutes'
ALERTS_SMTP_HOST_KEY = 'system:alerts_smtp_host'
ALERTS_SMTP_PORT_KEY = 'system:alerts_smtp_port'
ALERTS_SMTP_USERNAME_KEY = 'system:alerts_smtp_username'
ALERTS_SMTP_PASSWORD_KEY = 'system:alerts_smtp_password'
ALERTS_SMTP_USE_TLS_KEY = 'system:alerts_smtp_use_tls'
ALERTS_FROM_EMAIL_KEY = 'system:alerts_from_email'

EMAIL_MODE_KEY = 'system:email_mode'  # 'smtp' | 'graph'
EMAIL_GRAPH_TENANT_ID_KEY = 'system:email_graph_tenant_id'
EMAIL_GRAPH_CLIENT_ID_KEY = 'system:email_graph_client_id'
EMAIL_GRAPH_CLIENT_SECRET_KEY = 'system:email_graph_client_secret'
EMAIL_GRAPH_SENDER_KEY = 'system:email_graph_sender'
# Internal only (not surfaced by get_email_settings) — the acquired
# Graph access token, cached with its own expiry so a run of sends
# doesn't re-authenticate against Entra ID for every single email.
_EMAIL_GRAPH_TOKEN_CACHE_KEY = 'system:_email_graph_token_cache'

DEFAULT_THRESHOLD_MINUTES = 15


def _get_fernet():
    import base64
    import hashlib

    from cryptography.fernet import Fernet
    from django.conf import settings
    key = hashlib.sha256(settings.SECRET_KEY.encode()).digest()
    return Fernet(base64.urlsafe_b64encode(key))


def _decrypt(encrypted):
    if not encrypted:
        return ''
    try:
        return _get_fernet().decrypt(encrypted.encode()).decode()
    except Exception:
        logger.exception('Could not decrypt a stored email credential.')
        return ''


def get_alert_settings():
    """Current alert/email settings, with secrets decrypted for internal
    use only (never returned as-is by the API view — see system_views.py's
    has_password/has_graph_client_secret convention)."""
    return {
        'enabled': cache.get(ALERTS_ENABLED_KEY, False),
        'threshold_minutes': cache.get(ALERTS_THRESHOLD_MINUTES_KEY, DEFAULT_THRESHOLD_MINUTES),
        'mode': cache.get(EMAIL_MODE_KEY, 'smtp'),
        'smtp_host': cache.get(ALERTS_SMTP_HOST_KEY, ''),
        'smtp_port': cache.get(ALERTS_SMTP_PORT_KEY, 587),
        'smtp_username': cache.get(ALERTS_SMTP_USERNAME_KEY, ''),
        'smtp_password': _decrypt(cache.get(ALERTS_SMTP_PASSWORD_KEY, '')),
        'use_tls': cache.get(ALERTS_SMTP_USE_TLS_KEY, True),
        'from_email': cache.get(ALERTS_FROM_EMAIL_KEY, '') or cache.get(ALERTS_SMTP_USERNAME_KEY, ''),
        'graph_tenant_id': cache.get(EMAIL_GRAPH_TENANT_ID_KEY, ''),
        'graph_client_id': cache.get(EMAIL_GRAPH_CLIENT_ID_KEY, ''),
        'graph_client_secret': _decrypt(cache.get(EMAIL_GRAPH_CLIENT_SECRET_KEY, '')),
        'graph_sender': cache.get(EMAIL_GRAPH_SENDER_KEY, ''),
    }


def get_alert_connection():
    """Build a Django email connection from the stored SMTP settings, or None if incomplete."""
    from django.core.mail import get_connection

    conf = get_alert_settings()
    if not conf['smtp_host']:
        return None
    return get_connection(
        backend='django.core.mail.backends.smtp.EmailBackend',
        host=conf['smtp_host'],
        port=int(conf['smtp_port'] or 587),
        username=conf['smtp_username'] or None,
        password=conf['smtp_password'] or None,
        use_tls=bool(conf['use_tls']),
        fail_silently=False,
        timeout=10,
    )


def is_email_configured(conf=None):
    """Whether email sending is usable at all, in whichever mode is
    selected — the single check every caller (OTP, password reset,
    alerts) should use instead of reaching into SMTP/Graph fields
    directly, so a future third mode only needs to be taught here."""
    conf = conf or get_alert_settings()
    if conf['mode'] == 'graph':
        return bool(conf['graph_tenant_id'] and conf['graph_client_id']
                    and conf['graph_client_secret'] and conf['graph_sender'])
    return bool(conf['smtp_host'])


class EmailSendError(Exception):
    """Raised by send_email() for a Graph API failure — SMTP failures
    instead raise whatever smtplib/Django's SMTP backend itself raises,
    same as before this existed."""


def _get_graph_access_token(conf):
    """Client-credentials OAuth2 token for Microsoft Graph, cached
    until shortly before it expires so a burst of emails (e.g. an
    offline-alert run against many opted-in admins) doesn't re-auth
    against Entra ID per recipient."""
    import requests

    cached = cache.get(_EMAIL_GRAPH_TOKEN_CACHE_KEY)
    if cached:
        return cached

    resp = requests.post(
        f'https://login.microsoftonline.com/{conf["graph_tenant_id"]}/oauth2/v2.0/token',
        data={
            'grant_type': 'client_credentials',
            'client_id': conf['graph_client_id'],
            'client_secret': conf['graph_client_secret'],
            'scope': 'https://graph.microsoft.com/.default',
        },
        timeout=10,
    )
    if not resp.ok:
        raise EmailSendError(f'Could not authenticate with Microsoft Graph: {resp.text[:300]}')
    payload = resp.json()
    token = payload['access_token']
    # -60s buffer so a token doesn't expire mid-request on the next call.
    cache.set(_EMAIL_GRAPH_TOKEN_CACHE_KEY, token, max(60, int(payload.get('expires_in', 3600)) - 60))
    return token


def _send_via_graph(conf, to, subject, text_body, html_body, from_email, images):
    import base64

    import requests

    token = _get_graph_access_token(conf)
    message = {
        'subject': subject,
        'body': {'contentType': 'HTML', 'content': html_body or text_body},
        'toRecipients': [{'emailAddress': {'address': addr}} for addr in to],
    }
    if images:
        message['attachments'] = [
            {
                '@odata.type': '#microsoft.graph.fileAttachment',
                'name': f'{content_id}.{mimetype.split("/")[-1]}',
                'contentType': mimetype,
                'contentBytes': base64.b64encode(data).decode(),
                'contentId': content_id,
                'isInline': True,
            }
            for content_id, mimetype, data in images
        ]
    resp = requests.post(
        f'https://graph.microsoft.com/v1.0/users/{conf["graph_sender"]}/sendMail',
        headers={'Authorization': f'Bearer {token}', 'Content-Type': 'application/json'},
        json={'message': message, 'saveToSentItems': False},
        timeout=15,
    )
    if resp.status_code >= 300:
        raise EmailSendError(f'Microsoft Graph sendMail failed ({resp.status_code}): {resp.text[:300]}')


def _send_via_smtp(conf, to, subject, text_body, html_body, from_email, images):
    from email.mime.image import MIMEImage

    from django.core.mail import EmailMultiAlternatives

    connection = get_alert_connection()
    if connection is None:
        raise ValueError('SMTP host is not configured.')
    message = EmailMultiAlternatives(
        subject=subject, body=text_body,
        from_email=from_email or conf['from_email'] or conf['smtp_username'],
        to=to, connection=connection,
    )
    if html_body:
        message.attach_alternative(html_body, 'text/html')
    if images:
        # multipart/related (not the default multipart/mixed) is what
        # makes a mail client resolve <img src="cid:..."> to the
        # attached part in place, rather than showing it as a separate
        # regular attachment.
        message.mixed_subtype = 'related'
        for content_id, mimetype, data in images:
            image = MIMEImage(data, _subtype=mimetype.split('/')[-1])
            image.add_header('Content-ID', f'<{content_id}>')
            image.add_header('Content-Disposition', 'inline', filename=content_id)
            message.attach(image)
    message.send()


def send_email(to, subject, text_body, html_body='', from_email=None, images=None):
    """Send an email through whichever mode (SMTP or Microsoft Graph)
    is currently configured — the one path OTP/password-reset/alerts
    all share. `to` is a list of addresses; `images` is an optional
    list of (content_id, mimetype, bytes) tuples embedded as inline
    cid: images (see fleet_manager/email_branding.py) — every
    <img src="cid:X"> in html_body needs a matching entry here or it
    renders as a broken image. Raises ValueError if email isn't
    configured at all, or whatever the underlying transport raises on
    a genuine send failure (smtplib exceptions for SMTP, EmailSendError
    for Graph) — callers that want a non-raising "did it work" check
    should call is_email_configured() first."""
    conf = get_alert_settings()
    if not is_email_configured(conf):
        raise ValueError('Email is not configured (Settings > Alerts).')
    if conf['mode'] == 'graph':
        _send_via_graph(conf, to, subject, text_body, html_body, from_email, images)
    else:
        _send_via_smtp(conf, to, subject, text_body, html_body, from_email, images)


def get_alert_recipients():
    """Admin/superadmin users with an email address who haven't opted out."""
    from django.contrib.auth.models import User

    from .permissions import _user_role

    recipients = []
    for user in User.objects.filter(is_active=True).exclude(email=''):
        if _user_role(user) not in ('admin', 'superadmin'):
            continue
        scope = getattr(user, 'access_scope', None)
        if scope is not None and not scope.receive_offline_alerts:
            continue
        recipients.append(user.email)
    return recipients


def _offline_alert_content(offline_players, sample_notice=''):
    """Builds the exact (subject, text, html) send_offline_alert_emails()
    sends — factored out so send_test_offline_alert_email() below can
    reuse the real template, just redirected to one address instead of
    every opted-in admin. `sample_notice`, if given, is prepended as an
    HTML paragraph (used only by the sample-data preview path, see
    send_test_offline_alert_email)."""
    from .email_branding import branded_email_html, offline_players_table_html

    count = len(offline_players)
    subject = f'[MupiTech] {count} dispositivo(s) offline'

    lines = [f'{count} dispositivo(s) estão offline há mais tempo do que o esperado:', '']
    for player in offline_players:
        last_seen = player.last_seen.strftime('%d/%m/%Y %H:%M') if player.last_seen else 'nunca'
        lines.append(f'- {player.name} (visto pela última vez: {last_seen})')
    text_body = '\n'.join(lines)

    intro_html = f'<p style="margin:0 0 4px 0;font-size:14px;color:#4b5563;">{count} dispositivo(s) estão offline há mais tempo do que o esperado:</p>'
    if sample_notice:
        intro_html = (
            f'<p style="margin:0 0 12px 0;padding:10px 12px;background:#fff7e0;border:1px solid #f0d98c;'
            f'border-radius:6px;font-size:13px;color:#7a5c00;">{sample_notice}</p>' + intro_html
        )
    html_body, images = branded_email_html(subject, intro_html, offline_players_table_html(offline_players))
    return subject, text_body, html_body, images


def send_offline_alert_emails(offline_players):
    """Send one summary email (not one per device) to every opted-in admin."""
    if not offline_players:
        return

    recipients = get_alert_recipients()
    if not recipients:
        logger.info('Offline alert: no opted-in admin recipients, skipping email.')
        return

    if not is_email_configured():
        logger.warning('Offline alert: email is not configured, skipping.')
        return

    subject, text_body, html_body, images = _offline_alert_content(offline_players)
    try:
        send_email(recipients, subject, text_body, html_body, images=images)
        logger.info('Offline alert email sent to %d recipient(s) for %d device(s).', len(recipients), len(offline_players))
    except Exception:
        logger.exception('Failed to send offline alert email.')


class _SamplePlayer:
    """Stand-in for players.models.Player — just enough attributes for
    _offline_alert_content()'s template (name, last_seen) — used only
    when send_test_offline_alert_email() has no real offline device to
    show, so the preview isn't just an empty list."""
    def __init__(self, name, last_seen):
        self.name = name
        self.last_seen = last_seen


def send_test_offline_alert_email(to_email):
    """Same email a real offline-alert run would send (see
    send_offline_alert_emails above), but redirected to a single address
    instead of every opted-in admin — lets an operator preview the exact
    subject/body template, not just confirm email sending works (that's
    what send_test_email() below is for). Uses currently-offline devices
    if there are any, otherwise two made-up rows so the preview still
    shows the real list format."""
    from django.utils import timezone

    from players.models import Player

    if not is_email_configured():
        raise ValueError('Email is not configured.')

    offline_players = list(Player.objects.filter(is_online=False))
    is_sample = not offline_players
    sample_notice = ''
    if is_sample:
        now = timezone.now()
        offline_players = [
            _SamplePlayer('Exemplo — Receção', now),
            _SamplePlayer('Exemplo — Balcão 1', None),
        ]
        sample_notice = (
            'Nenhum dispositivo está offline neste momento — isto é um exemplo com dados '
            'fictícios para mostrar o formato real deste email.'
        )

    subject, text_body, html_body, images = _offline_alert_content(offline_players, sample_notice=sample_notice)
    if is_sample:
        subject = f'[MupiTech] (exemplo) {subject}'
        text_body = f'(Exemplo — nenhum dispositivo está offline neste momento)\n\n{text_body}'
    send_email([to_email], subject, text_body, html_body, images=images)


def send_test_email(to_email):
    """Send a one-off branded test email to confirm the email config
    (SMTP or Graph, whichever is selected) actually works — same
    visual template as the real alerts, just with a plain confirmation
    message instead of a device list."""
    from .email_branding import branded_email_html

    if not is_email_configured():
        raise ValueError('Email is not configured.')

    subject = '[MupiTech] Email de teste'
    text_body = (
        'Este é um email de teste das definições de email do MupiTech Gestor de Mupis Digitais. '
        'Se recebeu este email, está tudo configurado corretamente.'
    )
    intro_html = (
        '<p style="margin:0;font-size:14px;color:#4b5563;">'
        'Este é um email de teste das definições de email do MupiTech Gestor de Mupis Digitais. '
        'Se recebeu este email, está tudo configurado corretamente.</p>'
    )
    html_body, images = branded_email_html(subject, intro_html, '')
    send_email([to_email], subject, text_body, html_body, images=images)
