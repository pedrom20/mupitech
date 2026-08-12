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


def send_offline_alert_emails(offline_players):
    """Send one summary email (not one per device) to every opted-in admin."""
    if not offline_players:
        return

    conf = get_alert_settings()
    recipients = get_alert_recipients()
    if not recipients:
        logger.info('Offline alert: no opted-in admin recipients, skipping email.')
        return

    connection = get_alert_connection()
    if connection is None:
        logger.warning('Offline alert: SMTP not configured, skipping email.')
        return

    from django.core.mail import EmailMessage

    lines = [f'{len(offline_players)} device(s) have been offline for longer than expected:', '']
    for player in offline_players:
        last_seen = player.last_seen.strftime('%Y-%m-%d %H:%M') if player.last_seen else 'never'
        lines.append(f'- {player.name} (last seen: {last_seen})')
    body = '\n'.join(lines)

    message = EmailMessage(
        subject=f'[MupiTech] {len(offline_players)} device(s) offline',
        body=body,
        from_email=conf['from_email'] or conf['smtp_username'],
        to=recipients,
        connection=connection,
    )
    try:
        message.send()
        logger.info('Offline alert email sent to %d recipient(s) for %d device(s).', len(recipients), len(offline_players))
    except Exception:
        logger.exception('Failed to send offline alert email.')


def send_test_email(to_email):
    """Send a one-off test email to confirm the SMTP config actually works."""
    conf = get_alert_settings()
    connection = get_alert_connection()
    if connection is None:
        raise ValueError('SMTP host is not configured.')

    from django.core.mail import EmailMessage
    message = EmailMessage(
        subject='[MupiTech] Test alert email',
        body='This is a test email from your MupiTech Fleet Manager alert settings. If you received this, SMTP is configured correctly.',
        from_email=conf['from_email'] or conf['smtp_username'],
        to=[to_email],
        connection=connection,
    )
    message.send()
