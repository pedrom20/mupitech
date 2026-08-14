"""Thin wrapper around Duo Security's Auth API (duo_client) — the push
second factor alongside mfa/models.py::TOTPDevice's generic 6-digit
code. No secret lives on our side: Duo owns the actual enrollment (the
/enroll QR flow, held by the operator's own Duo account and Duo Mobile
app); DuoEnrollment just remembers which Duo identity a Fleet Manager
user maps to.

Requires a free Duo account (covers up to 10 users) with an "Auth API"
application created in the Duo Admin Panel, and its three credentials
set as DUO_IKEY/DUO_SKEY/DUO_HOST env vars — see .env.example.
"""

import logging

from django.conf import settings

logger = logging.getLogger(__name__)

ENROLLMENT_VALID_SECS = 300  # 5 minutes — matches Duo's own enroll-portal link convention
PUSH_DEVICE = 'auto'


class DuoNotConfiguredError(Exception):
    """Raised when DUO_IKEY/DUO_SKEY/DUO_HOST aren't set."""


def duo_configured():
    return bool(settings.DUO_IKEY and settings.DUO_SKEY and settings.DUO_HOST)


def _client():
    if not duo_configured():
        raise DuoNotConfiguredError('Duo is not configured on this Fleet Manager instance.')
    import duo_client
    return duo_client.Auth(ikey=settings.DUO_IKEY, skey=settings.DUO_SKEY, host=settings.DUO_HOST)


def start_enrollment(duo_username):
    """Begin Duo's own enrollment flow for `duo_username`. Returns Duo's
    raw dict: activation_barcode (a ready-made QR image URL — no need
    to render one ourselves), activation_code, activation_url,
    expiration, user_id, username."""
    return _client().enroll(username=duo_username, valid_secs=ENROLLMENT_VALID_SECS)


def check_enrollment_status(duo_user_id, activation_code):
    """'success' | 'invalid' | 'waiting' — see Duo's /enroll_status."""
    return _client().enroll_status(user_id=duo_user_id, activation_code=activation_code)


def push_auth(duo_user_id):
    """Trigger a Duo Mobile push and BLOCK until the user approves/
    denies or it times out (Duo's own ~60s default) — this is a
    synchronous call (no async=1), so Duo's /auth endpoint itself does
    the waiting server-side and this just returns the final result.
    Ties up the calling request for that whole window; acceptable for
    a low-traffic internal tool, but worth knowing if this ever needs
    to scale — the alternative is async=1 + polling /auth_status from
    the frontend, not implemented here.

    Returns Duo's raw dict: result ('allow'/'deny'), status,
    status_msg.
    """
    return _client().auth(
        user_id=duo_user_id,
        factor='push',
        device=PUSH_DEVICE,
    )
