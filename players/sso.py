"""SSO login into a device's own local dashboard, from the Fleet Manager.

Design: a short-lived, signed token scoped to (player, requesting FM
user), verified by the device using a secret it shares only with this
Fleet Manager instance — not the device's own SECRET_KEY (isolates the
blast radius of a device SECRET_KEY compromise the same way
mfa/crypto.py isolates MFA secrets from SECRET_KEY rotation), and not
transmitted over the wire as part of the login itself (only the
signature is). django.core.signing is used on both ends (mupitech-
player is a Django app too) purely as a convenient HMAC-sign/verify
primitive — Player.get_sso_secret() supplies the per-device key.

The secret has to reach the device somehow before SSO can work at all;
it's pushed over the same SSH provisioning channel already used for
branding/device-label (players/branding.py), and lands in the device's
anthias.conf — which the compose templates already bind-mount to the
host, so it survives a container recreate.
"""

import logging
import secrets as _secrets
from urllib.parse import urlparse

from django.core import signing

from fleet_manager.permissions import _user_role

logger = logging.getLogger(__name__)

SSO_TOKEN_SALT = 'mupitech-sso-login'
SSO_TOKEN_MAX_AGE = 60  # seconds — long enough for a redirect, short enough that a leaked link is useless quickly

# Distinct salt for the reverse direction (device -> FM, see
# fleet_manager/urls.py::auth_device_login) even though it reuses the
# same per-device secret — django.core.signing derives a different key
# per salt, so a leaked/replayed FM->device SSO token can't double as a
# valid device->FM proof (or vice versa) just because both happen to
# carry a 'player_id' field.
DEVICE_AUTH_PROOF_SALT = 'mupitech-device-auth'
DEVICE_AUTH_PROOF_MAX_AGE = 30


class SSOPushError(Exception):
    """Raised when pushing a device's SSO secret over SSH fails."""


def build_sso_login_url(player, requesting_user):
    """Return a one-time login URL for `player`'s local dashboard, or
    None if this device hasn't been provisioned with an SSO secret yet.
    """
    secret = player.get_sso_secret()
    if not secret:
        return None

    token = signing.dumps(
        {
            'player_id': str(player.id),
            'requested_by': requesting_user.username,
            'role': _user_role(requesting_user),
        },
        key=secret,
        salt=SSO_TOKEN_SALT,
        compress=True,
    )
    base = player.url.rstrip('/')
    return f'{base}/sso/callback/?token={token}'


def push_sso_secret_to_player(player, ssh_user, ssh_password, ssh_port=22, timeout=15, fm_base_url=None):
    """SSH into `player`'s host and provision it with an SSO secret,
    generating one first if this player doesn't already have one.

    Writes it via the device's own AnthiasSettings (docker exec + a
    one-line management shell command), not a raw anthias.conf edit —
    that class's save() only ever serializes keys it already knows
    about (see mupitech-player's anthias_server/settings.py DEFAULTS),
    so going through it is what actually makes 'sso_secret' persist
    instead of silently getting dropped.

    Also pushes `fm_player_id` (this Player's own id) and, when given,
    `fm_base_url` — together they're what lets the device call back to
    this Fleet Manager to verify FM credentials typed directly into the
    device's own login page (see fleet_manager/urls.py::auth_device_login
    and mupitech-player's mupitech_device_login_views.py). Both are
    optional/inert if that feature is never used, so pushing them here
    unconditionally (whenever SSO gets (re)provisioned) is simplest —
    one push covers both features instead of two separate ones.
    """
    import paramiko

    if not player.get_sso_secret():
        player.set_sso_secret(_secrets.token_urlsafe(32))
        player.save(update_fields=['sso_secret_encrypted'])
    secret = player.get_sso_secret()

    host = urlparse(player.url).hostname
    if not host:
        raise SSOPushError(f'Could not determine host from player URL: {player.url}')

    from .provision import _shell_quote, _ssh_run

    ssh = paramiko.SSHClient()
    ssh.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    try:
        ssh.connect(host, port=ssh_port, username=ssh_user, password=ssh_password, timeout=timeout)
    except Exception as exc:
        raise SSOPushError(f'SSH connection failed: {exc}') from exc

    try:
        out, _, _ = _ssh_run(
            ssh,
            "docker ps --format '{{.Names}}' --filter name=anthias-server",
            timeout=timeout,
        )
        container = next((line for line in out.strip().splitlines() if line.strip()), '')
        if not container:
            raise SSOPushError('Could not find a running anthias-server container on this device.')

        settings_lines = [
            f'settings["sso_secret"] = {secret!r}',
            f'settings["fm_player_id"] = {str(player.id)!r}',
        ]
        if fm_base_url:
            settings_lines.append(f'settings["fm_base_url"] = {fm_base_url.rstrip("/")!r}')
        python_cmd = (
            'from anthias_server.settings import settings; '
            + '; '.join(settings_lines)
            + '; settings.save()'
        )
        _ssh_run(
            ssh,
            f'docker exec {_shell_quote(container)} python -c {_shell_quote(python_cmd)}',
            timeout=timeout,
        )
    except SSOPushError:
        raise
    except Exception as exc:
        raise SSOPushError(str(exc)) from exc
    finally:
        ssh.close()
