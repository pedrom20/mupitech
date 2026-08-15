"""Email alerts for devices that have been offline too long.

Settings are stored the same way as the other system-wide settings in
system_views.py — Redis cache keys with no TTL, not a DB model — so the
"alert_settings" API view can follow the exact same GET/PATCH pattern as
tailscale_settings. Kept in its own module (rather than system_views.py)
because players/tasks.py also needs the sending logic, and importing
tasks.py from system_views.py (or vice versa) would risk import cycles.
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

DEFAULT_THRESHOLD_MINUTES = 15


def _get_fernet():
    import base64
    import hashlib

    from cryptography.fernet import Fernet
    from django.conf import settings
    key = hashlib.sha256(settings.SECRET_KEY.encode()).digest()
    return Fernet(base64.urlsafe_b64encode(key))


def get_alert_settings():
    """Current alert settings, with the SMTP password decrypted for internal use only."""
    encrypted_password = cache.get(ALERTS_SMTP_PASSWORD_KEY, '')
    password = ''
    if encrypted_password:
        try:
            password = _get_fernet().decrypt(encrypted_password.encode()).decode()
        except Exception:
            logger.exception('Could not decrypt stored SMTP password for alerts.')
    return {
        'enabled': cache.get(ALERTS_ENABLED_KEY, False),
        'threshold_minutes': cache.get(ALERTS_THRESHOLD_MINUTES_KEY, DEFAULT_THRESHOLD_MINUTES),
        'smtp_host': cache.get(ALERTS_SMTP_HOST_KEY, ''),
        'smtp_port': cache.get(ALERTS_SMTP_PORT_KEY, 587),
        'smtp_username': cache.get(ALERTS_SMTP_USERNAME_KEY, ''),
        'smtp_password': password,
        'use_tls': cache.get(ALERTS_SMTP_USE_TLS_KEY, True),
        'from_email': cache.get(ALERTS_FROM_EMAIL_KEY, '') or cache.get(ALERTS_SMTP_USERNAME_KEY, ''),
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


def _offline_alert_message(offline_players, conf, to, sample_notice=''):
    """Builds the exact email send_offline_alert_emails() sends —
    factored out so send_test_offline_alert_email() below can reuse the
    real subject/body/HTML template, just redirected to one address
    instead of every opted-in admin. `sample_notice`, if given, is
    prepended as an HTML paragraph (used only by the sample-data preview
    path, see send_test_offline_alert_email)."""
    from django.core.mail import EmailMultiAlternatives

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
    html_body = branded_email_html(subject, intro_html, offline_players_table_html(offline_players))

    message = EmailMultiAlternatives(
        subject=subject,
        body=text_body,
        from_email=conf['from_email'] or conf['smtp_username'],
        to=to,
        connection=get_alert_connection(),
    )
    message.attach_alternative(html_body, 'text/html')
    return message


def send_offline_alert_emails(offline_players):
    """Send one summary email (not one per device) to every opted-in admin."""
    if not offline_players:
        return

    conf = get_alert_settings()
    recipients = get_alert_recipients()
    if not recipients:
        logger.info('Offline alert: no opted-in admin recipients, skipping email.')
        return

    if get_alert_connection() is None:
        logger.warning('Offline alert: SMTP not configured, skipping email.')
        return

    message = _offline_alert_message(offline_players, conf, recipients)
    try:
        message.send()
        logger.info('Offline alert email sent to %d recipient(s) for %d device(s).', len(recipients), len(offline_players))
    except Exception:
        logger.exception('Failed to send offline alert email.')


class _SamplePlayer:
    """Stand-in for players.models.Player — just enough attributes for
    _offline_alert_message()'s template (name, last_seen) — used only
    when send_test_offline_alert_email() has no real offline device to
    show, so the preview isn't just an empty list."""
    def __init__(self, name, last_seen):
        self.name = name
        self.last_seen = last_seen


def send_test_offline_alert_email(to_email):
    """Same email a real offline-alert run would send (see
    send_offline_alert_emails above), but redirected to a single address
    instead of every opted-in admin — lets an operator preview the exact
    subject/body template, not just confirm SMTP works (that's what
    send_test_email() below is for). Uses currently-offline devices if
    there are any, otherwise two made-up rows so the preview still shows
    the real list format."""
    from django.utils import timezone

    from players.models import Player

    conf = get_alert_settings()
    if get_alert_connection() is None:
        raise ValueError('SMTP host is not configured.')

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

    message = _offline_alert_message(offline_players, conf, [to_email], sample_notice=sample_notice)
    if is_sample:
        message.subject = f'[MupiTech] (exemplo) {message.subject}'
        message.body = f'(Exemplo — nenhum dispositivo está offline neste momento)\n\n{message.body}'
    message.send()


def send_test_email(to_email):
    """Send a one-off branded test email to confirm the SMTP config
    actually works — same visual template as the real alerts, just
    with a plain confirmation message instead of a device list."""
    from django.core.mail import EmailMultiAlternatives

    from .email_branding import branded_email_html

    conf = get_alert_settings()
    connection = get_alert_connection()
    if connection is None:
        raise ValueError('SMTP host is not configured.')

    subject = '[MupiTech] Email de teste'
    text_body = (
        'Este é um email de teste das definições de alertas do MupiTech Fleet Manager. '
        'Se recebeu este email, o SMTP está configurado corretamente.'
    )
    intro_html = (
        '<p style="margin:0;font-size:14px;color:#4b5563;">'
        'Este é um email de teste das definições de alertas do MupiTech Fleet Manager. '
        'Se recebeu este email, o SMTP está configurado corretamente.</p>'
    )
    html_body = branded_email_html(subject, intro_html, '')

    message = EmailMultiAlternatives(
        subject=subject,
        body=text_body,
        from_email=conf['from_email'] or conf['smtp_username'],
        to=[to_email],
        connection=connection,
    )
    message.attach_alternative(html_body, 'text/html')
    message.send()
