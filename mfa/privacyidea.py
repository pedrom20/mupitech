"""Thin client for a self-hosted privacyIDEA server — an alternative
second factor alongside TOTP/Duo (see mfa/duo.py for the equivalent
Duo wrapper, same shape by design).

Unlike Duo, privacyIDEA holds no secret-per-user relationship with us
at all on its own — WE ask it to generate a TOTP token for a user
(admin-authenticated /token/init call) and get back the same kind of
otpauth:// URI pyotp/mfa/views.py already knows how to turn into a QR
(via the qrcode library already a dependency for TOTP) — no need to
parse privacyIDEA's own returned QR image format. privacyIDEA then
owns verifying the 6-digit code itself (/validate/check); we never see
or store the shared secret, same "no secret on our side" property Duo
has, just via a different mechanism (privacyIDEA generates and keeps
it server-side instead of the operator's authenticator app being the
only place with a matching secret).

Requires a running privacyIDEA instance (deployed separately — see
deploy/privacyidea/ for a standalone docker-compose to get one
running) with:
  - An admin account this Fleet Manager can authenticate as, to call
    the admin-only /token/init and /token/<serial> endpoints.
  - A realm for Fleet Manager users' TOTP tokens to live in (privacyIDEA
    requires every user to belong to one; "flatly no realm" is not
    valid for /token/init's `user` parameter).

Configured via PRIVACYIDEA_URL / PRIVACYIDEA_ADMIN_USER /
PRIVACYIDEA_ADMIN_PASSWORD / PRIVACYIDEA_REALM env vars (see
.env.example) or entered by an admin from the Settings UI
(mfa/provider_config.py merges the two, DB value wins per-field). All
calls raise PrivacyIDEAError on any failure (network, bad credentials,
unexpected response shape); callers catch that the same way
mfa/duo.py callers catch its exceptions.
"""

import logging

from . import provider_config

logger = logging.getLogger(__name__)

_REQUEST_TIMEOUT_S = 15


class PrivacyIDEAError(Exception):
    """Raised for any privacyIDEA API failure — network, auth, or an
    unexpected response shape."""


def privacyidea_configured():
    return provider_config.is_configured('privacyidea')


def _require_configured():
    if not privacyidea_configured():
        raise PrivacyIDEAError('privacyIDEA is not configured on this Fleet Manager instance.')


def _admin_token():
    """Authenticate as the configured admin account, returning a fresh
    JWT. Not cached across calls — enrollment/disable are infrequent
    admin operations, so the extra round-trip per call is a fair trade
    for never having to reason about a stale/expired cached token."""
    import requests

    config = provider_config.get_config('privacyidea')
    try:
        resp = requests.post(
            f'{config["url"].rstrip("/")}/auth',
            data={
                'username': config['admin_user'],
                'password': config['admin_password'],
            },
            timeout=_REQUEST_TIMEOUT_S,
        )
        resp.raise_for_status()
        return resp.json()['result']['value']['token']
    except Exception as exc:
        raise PrivacyIDEAError(f'privacyIDEA admin authentication failed: {exc}') from exc


def start_enrollment(username):
    """Ask privacyIDEA to generate a new TOTP token for `username` in
    the configured realm. Returns {'serial': ..., 'otpauth_uri': ...} —
    the caller (mfa/views.py::privacyidea_enroll) renders its own QR
    from otpauth_uri via the same qrcode helper TOTP enrollment uses."""
    import requests

    _require_configured()
    config = provider_config.get_config('privacyidea')
    token = _admin_token()
    try:
        resp = requests.post(
            f'{config["url"].rstrip("/")}/token/init',
            headers={'Authorization': token},
            data={
                'type': 'totp',
                'genkey': '1',
                'user': username,
                'realm': config['realm'],
            },
            timeout=_REQUEST_TIMEOUT_S,
        )
        resp.raise_for_status()
        data = resp.json()
        detail = data['detail']
        return {
            'serial': detail['serial'],
            'otpauth_uri': detail['googleurl']['value'],
        }
    except PrivacyIDEAError:
        raise
    except Exception as exc:
        raise PrivacyIDEAError(f'privacyIDEA enrollment failed: {exc}') from exc


def verify(username, otp):
    """Check a 6-digit code against privacyIDEA. Returns True/False —
    never raises for a simply-wrong code, only for a genuine API/network
    failure. A successful verify() during enrollment is also what
    privacyIDEA treats as confirming the token (no separate 'activate'
    call needed, matching TOTPDevice's own local confirm-on-first-code
    behaviour)."""
    import requests

    _require_configured()
    config = provider_config.get_config('privacyidea')
    try:
        resp = requests.post(
            f'{config["url"].rstrip("/")}/validate/check',
            data={
                'user': username,
                'realm': config['realm'],
                'pass': otp,
            },
            timeout=_REQUEST_TIMEOUT_S,
        )
        resp.raise_for_status()
        return bool(resp.json()['result']['value'])
    except PrivacyIDEAError:
        raise
    except Exception as exc:
        raise PrivacyIDEAError(f'privacyIDEA verification failed: {exc}') from exc


def delete_token(serial):
    """Admin-delete a token by serial — used when disabling a user's
    privacyIDEA MFA from their own account settings."""
    import requests

    _require_configured()
    config = provider_config.get_config('privacyidea')
    token = _admin_token()
    try:
        resp = requests.delete(
            f'{config["url"].rstrip("/")}/token/{serial}',
            headers={'Authorization': token},
            timeout=_REQUEST_TIMEOUT_S,
        )
        resp.raise_for_status()
    except Exception as exc:
        raise PrivacyIDEAError(f'privacyIDEA token deletion failed: {exc}') from exc
