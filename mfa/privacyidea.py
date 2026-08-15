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

from django.conf import settings

from . import provider_config

logger = logging.getLogger(__name__)

_REQUEST_TIMEOUT_S = 15


def _verify_kwarg():
    """`verify=` value for every request below — see
    settings.PRIVACYIDEA_VERIFY_SSL's own comment for why this is ever
    off (self-signed certs on self-hosted instances)."""
    if not settings.PRIVACYIDEA_VERIFY_SSL:
        import urllib3
        urllib3.disable_warnings(urllib3.exceptions.InsecureRequestWarning)
    return settings.PRIVACYIDEA_VERIFY_SSL


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
            verify=_verify_kwarg(),
        )
        resp.raise_for_status()
        return resp.json()['result']['value']['token']
    except Exception as exc:
        raise PrivacyIDEAError(f'privacyIDEA admin authentication failed: {exc}') from exc


def _ensure_user_exists(config, token, username, email=''):
    """Create `username` in the configured resolver if it isn't there
    yet — needed when that resolver is privacyIDEA's own "internal" one
    (pi-manage resolver create_internal), which starts out empty and
    has no notion of Fleet Manager's users until told about them.
    Skipped entirely if no resolver is configured (an admin using an
    external LDAP/SQL resolver that already has these users has no use
    for this, and privacyIDEA's own POST /user 500s on a resolver that
    isn't marked editable). A second POST /user for an already-existing
    username 500s too — there's no dedicated "does this user exist"
    endpoint response code to catch, so this checks via GET /user/
    first rather than try/except-ing the POST."""
    import requests

    resolver = config.get('resolver')
    if not resolver:
        return
    try:
        resp = requests.get(
            f'{config["url"].rstrip("/")}/user/',
            headers={'Authorization': token},
            params={'username': username, 'realm': config['realm']},
            timeout=_REQUEST_TIMEOUT_S,
            verify=_verify_kwarg(),
        )
        resp.raise_for_status()
        if resp.json()['result']['value']:
            return  # already exists
        resp = requests.post(
            f'{config["url"].rstrip("/")}/user',
            headers={'Authorization': token},
            data={'user': username, 'resolver': resolver, 'email': email},
            timeout=_REQUEST_TIMEOUT_S,
            verify=_verify_kwarg(),
        )
        resp.raise_for_status()
    except Exception as exc:
        raise PrivacyIDEAError(f'privacyIDEA user provisioning failed: {exc}') from exc


def start_enrollment(username, email='', token_type='totp'):
    """Ask privacyIDEA to generate a new token for `username` in the
    configured realm (auto-provisioning that user into the configured
    resolver first, if needed — see _ensure_user_exists). Returns
    {'serial': ..., 'otpauth_uri': ...} either way — the caller
    (mfa/views.py::privacyidea_enroll) renders its own QR from
    otpauth_uri via the same qrcode helper TOTP enrollment already used,
    which works unchanged for a push token's otpauth://pipush/... URI
    too (the qrcode library just encodes whatever string it's given).

    For token_type='push' this is only step 1 of privacyIDEA's own
    two-step push enrollment — the QR encodes a URL the privacyIDEA
    Authenticator app itself POSTs to directly (not through us) to
    finish registering; mfa/views.py polls check_push_rollout() below
    to find out when that's done, the same way it already polls Duo's
    enroll_status. Requires two enrollment policies set once on the
    privacyIDEA server itself (see deploy/privacyidea/README.md):
    push_registration_url (where the app posts back to) and
    push_firebase_configuration=poll only (so no Firebase project is
    needed — the app polls the server for pending challenges instead of
    being woken up by a push service)."""
    import requests

    _require_configured()
    config = provider_config.get_config('privacyidea')
    token = _admin_token()
    _ensure_user_exists(config, token, username, email)
    try:
        resp = requests.post(
            f'{config["url"].rstrip("/")}/token/init',
            headers={'Authorization': token},
            data={
                'type': token_type,
                'genkey': '1',
                'user': username,
                'realm': config['realm'],
            },
            timeout=_REQUEST_TIMEOUT_S,
            verify=_verify_kwarg(),
        )
        resp.raise_for_status()
        detail = resp.json()['detail']
        uri_key = 'pushurl' if token_type == 'push' else 'googleurl'
        return {
            'serial': detail['serial'],
            'otpauth_uri': detail[uri_key]['value'],
        }
    except PrivacyIDEAError:
        raise
    except Exception as exc:
        raise PrivacyIDEAError(f'privacyIDEA enrollment failed: {exc}') from exc


def check_push_rollout(serial):
    """Has the privacyIDEA Authenticator app finished step 2 of push
    enrollment yet (POSTing its public key back to privacyIDEA)? Polled
    by mfa/views.py::privacyidea_confirm the same way Duo enrollment is
    already polled — there's no code for the user to type for a push
    token, confirmation only happens once this turns True."""
    import requests

    _require_configured()
    config = provider_config.get_config('privacyidea')
    token = _admin_token()
    try:
        resp = requests.get(
            f'{config["url"].rstrip("/")}/token/',
            headers={'Authorization': token},
            params={'serial': serial},
            timeout=_REQUEST_TIMEOUT_S,
            verify=_verify_kwarg(),
        )
        resp.raise_for_status()
        tokens = resp.json()['result']['value']['tokens']
        return bool(tokens and tokens[0].get('active'))
    except Exception as exc:
        raise PrivacyIDEAError(f'privacyIDEA rollout check failed: {exc}') from exc


def trigger_and_wait_push(username, timeout_s=55, poll_interval_s=2):
    """Trigger a push challenge for `username`'s active push token and
    block until it's answered or `timeout_s` elapses — mirrors
    mfa/duo.py::push_auth's shape ({'result': 'allow'|'deny'|'timeout'})
    so fleet_manager/urls.py::auth_privacyidea_push_verify can follow
    the exact same pattern as its Duo equivalent. Unlike Duo's /auth
    call (which blocks server-side on Duo's own infrastructure until
    answered), privacyIDEA's /validate/check returns immediately with a
    transaction_id and expects the CALLER to poll — this function does
    that polling itself so the caller still only sees one blocking call,
    same as the Duo path.

    NOTE: this is the one piece of the push flow that could only be
    verified against privacyIDEA's documented API shape, not against a
    real phone approving/denying a challenge (no physical device
    available while building this) — enrollment and rollout-state
    polling above were both confirmed against a real server. Worth one
    real end-to-end login test with the privacyIDEA Authenticator app
    before relying on this in production."""
    import time

    import requests

    _require_configured()
    config = provider_config.get_config('privacyidea')
    try:
        resp = requests.post(
            f'{config["url"].rstrip("/")}/validate/check',
            data={'user': username, 'realm': config['realm']},
            timeout=_REQUEST_TIMEOUT_S,
            verify=_verify_kwarg(),
        )
        resp.raise_for_status()
        data = resp.json()
        transaction_id = data.get('detail', {}).get('transaction_id')
        if not transaction_id:
            # Nothing to poll — either it somehow already succeeded
            # (result.value True with no challenge) or there's no
            # active push token to challenge at all.
            return {'result': 'allow' if data.get('result', {}).get('value') else 'deny'}
    except Exception as exc:
        raise PrivacyIDEAError(f'privacyIDEA push trigger failed: {exc}') from exc

    deadline = time.monotonic() + timeout_s
    while time.monotonic() < deadline:
        time.sleep(poll_interval_s)
        try:
            resp = requests.get(
                f'{config["url"].rstrip("/")}/validate/polltransaction',
                params={'transaction_id': transaction_id},
                timeout=_REQUEST_TIMEOUT_S,
                verify=_verify_kwarg(),
            )
            resp.raise_for_status()
            answered = bool(resp.json()['result']['value'])
        except Exception as exc:
            raise PrivacyIDEAError(f'privacyIDEA push poll failed: {exc}') from exc
        if not answered:
            continue
        try:
            resp = requests.post(
                f'{config["url"].rstrip("/")}/validate/check',
                data={'user': username, 'realm': config['realm'], 'transaction_id': transaction_id, 'pass': ''},
                timeout=_REQUEST_TIMEOUT_S,
                verify=_verify_kwarg(),
            )
            resp.raise_for_status()
            approved = bool(resp.json()['result']['value'])
        except Exception as exc:
            raise PrivacyIDEAError(f'privacyIDEA push finalize failed: {exc}') from exc
        return {'result': 'allow' if approved else 'deny'}

    return {'result': 'timeout'}


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
            verify=_verify_kwarg(),
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
            verify=_verify_kwarg(),
        )
        resp.raise_for_status()
    except Exception as exc:
        raise PrivacyIDEAError(f'privacyIDEA token deletion failed: {exc}') from exc
