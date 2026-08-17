"""Email-delivered one-time-code second factor.

Reuses the app's shared email settings (fleet_manager/alerts.py — SMTP
or Microsoft Graph, whichever an admin configured under Settings >
Alerts) rather than adding a separate credential to configure — if
email is already set up (for offline-device alerts, say), email OTP
just works; if not, it's reported as unconfigured the same way
Duo/privacyIDEA are when their own credentials are missing (see
mfa/providers.py).

Codes are generated fresh per use and never stored in the clear —
callers get back the raw code once (to email it) and a hash (via
hash_code) to persist instead. This mirrors Django's own account
password hashing (make_password/check_password), not encryption:
there's never a legitimate reason to decrypt a code back out, only to
check whether a submitted one matches.
"""
import logging
import secrets

from django.contrib.auth.hashers import check_password, make_password

logger = logging.getLogger(__name__)

CODE_TTL_SECONDS = 300


def email_otp_configured():
    """Whether email sending is set up at all (Settings > Alerts,
    either SMTP or Microsoft Graph) — an email code obviously can't be
    delivered without it. Unlike Duo/privacyIDEA there's no
    provider-specific credential of its own to check."""
    from fleet_manager.alerts import is_email_configured
    return is_email_configured()


def generate_code():
    return f'{secrets.randbelow(1_000_000):06d}'


def hash_code(code):
    return make_password(code)


def code_matches(code, code_hash):
    return bool(code_hash) and check_password(code, code_hash)


def send_code_email(user, code):
    """Emails `code` to the user's account email. Returns True if a
    send was attempted (email configured and the send didn't raise),
    False otherwise — callers should treat False as "can't use this
    method right now", not silently pretend it worked."""
    from fleet_manager.alerts import is_email_configured, send_email
    from fleet_manager.email_branding import branded_email_html

    if not is_email_configured():
        logger.warning('Email OTP requested for %s but email is not configured.', user.username)
        return False

    subject = '[MupiTech] O seu código de verificação'
    text_body = (
        f'O seu código de verificação é: {code}\n\n'
        f'Válido por {CODE_TTL_SECONDS // 60} minutos. Se não pediu este código, pode ignorar este email.'
    )
    intro_html = (
        '<p style="margin:0 0 16px 0;font-size:14px;color:#4b5563;">O seu código de verificação é:</p>'
        f'<p style="margin:0 0 16px 0;font-size:32px;font-weight:700;letter-spacing:6px;color:#04182B;">{code}</p>'
    )
    body_html = (
        f'<p style="margin:0;font-size:12px;color:#8a8f98;">Válido por {CODE_TTL_SECONDS // 60} minutos. '
        'Se não pediu este código, pode ignorar este email.</p>'
    )
    html_body, images = branded_email_html(
        'Código de verificação', intro_html, body_html,
        footer_html='Este é um email automático do MupiTech Gestor de Mupis Digitais.',
    )

    try:
        send_email([user.email], subject, text_body, html_body, images=images)
    except Exception:
        logger.exception('Failed to send email OTP to %s.', user.username)
        return False
    return True
