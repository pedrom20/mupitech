"""Thin wrapper around Duo Security's Auth API (duo_client) — the push
second factor alongside mfa/models.py::TOTPDevice's generic 6-digit
code. No secret lives on our side: Duo owns the actual enrollment (the
/enroll QR flow, held by the operator's own Duo account and Duo Mobile
app); DuoEnrollment just remembers which Duo identity a Fleet Manager
user maps to.

Requires a free Duo account (covers up to 10 users) with an "Auth API"
application created in the Duo Admin Panel, and its three credentials
either set as DUO_IKEY/DUO_SKEY/DUO_HOST env vars (see .env.example)
or entered by an admin from the Settings UI (mfa/provider_config.py
merges the two, DB value wins per-field).
"""

import logging

from . import provider_config

logger = logging.getLogger(__name__)

ENROLLMENT_VALID_SECS = 300  # 5 minutes — matches Duo's own enroll-portal link convention
PUSH_DEVICE = 'auto'


class DuoNotConfiguredError(Exception):
    """Raised when Duo's ikey/skey/host aren't set (env var or Settings UI)."""


def duo_configured():
    return provider_config.is_configured('duo')


def _client():
    if not duo_configured():
        raise DuoNotConfiguredError('Duo is not configured on this Fleet Manager instance.')
    import duo_client
    config = provider_config.get_config('duo')
    return duo_client.Auth(ikey=config['ikey'], skey=config['skey'], host=config['host'])


def start_enrollment(duo_username):
    """Begin Duo's own enrollment flow for `duo_username`. Returns Duo's
    raw dict: activation_barcode (a ready-made QR image URL — no need
    to render one ourselves), activation_code, activation_url,
    expiration, user_id, username."""
    return _client().enroll(username=duo_username, valid_secs=ENROLLMENT_VALID_SECS)


def check_enrollment_status(duo_user_id, activation_code):
    """'success' | 'invalid' | 'waiting' — see Duo's /enroll_status."""
    return _client().enroll_status(user_id=duo_user_id, activation_code=activation_code)


def push_auth(duo_user_id, ipaddr=None):
    """Trigger a Duo Mobile push and BLOCK until the user approves/
    denies or it times out (Duo's own ~60s default) — this is a
    synchronous call (no async=1), so Duo's /auth endpoint itself does
    the waiting server-side and this just returns the final result.
    Ties up the calling request for that whole window; acceptable for
    a low-traffic internal tool, but worth knowing if this ever needs
    to scale — the alternative is async=1 + polling /auth_status from
    the frontend, not implemented here.

    `ipaddr` is the end user's own client IP (see fleet_manager/urls.py::
    auth_duo_verify), passed through so the Duo Admin Panel's
    authentication log shows where the login actually came from instead
    of Duo's own "0.0.0.0" default when this is omitted — some Duo
    policies (e.g. geolocation/anonymizer rules) key off this and would
    otherwise always see a blank/placeholder address.

    Returns Duo's raw dict: result ('allow'/'deny'), status,
    status_msg.
    """
    return _client().auth(
        user_id=duo_user_id,
        factor='push',
        device=PUSH_DEVICE,
        ipaddr=ipaddr,
    )
