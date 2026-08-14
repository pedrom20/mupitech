import base64
import hashlib
import logging

from cryptography.fernet import Fernet
from django.conf import settings

logger = logging.getLogger(__name__)


def _get_fernet():
    """Return a Fernet instance for encrypting TOTP secrets.

    Deliberately does NOT reuse players/models.py::_get_fernet() (which
    derives its key from SECRET_KEY) — a SECRET_KEY rotation already
    silently breaks stored player/SSH passwords (players/models.py),
    and MFA secrets shouldn't share that blast radius. MFA_ENCRYPTION_KEY
    is a dedicated env var; falling back to a SECRET_KEY-derived key in
    dev (when it's unset) keeps local/test setups working without extra
    config, at the cost of not being isolated in that case.
    """
    key = getattr(settings, 'MFA_ENCRYPTION_KEY', None)
    if not key:
        logger.warning(
            'MFA_ENCRYPTION_KEY not set — deriving from SECRET_KEY. '
            'Set a dedicated MFA_ENCRYPTION_KEY in production.'
        )
        digest = hashlib.sha256((settings.SECRET_KEY + ':mfa').encode()).digest()
        key = base64.urlsafe_b64encode(digest)
    return Fernet(key)


def encrypt_secret(raw_secret):
    return _get_fernet().encrypt(raw_secret.encode()).decode()


def decrypt_secret(encrypted_secret):
    return _get_fernet().decrypt(encrypted_secret.encode()).decode()
