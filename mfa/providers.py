"""Registry of second-factor providers.

Each provider (mfa/totp.py-equivalent logic in mfa/views.py, mfa/duo.py,
mfa/privacyidea.py, mfa/authpoint.py) keeps its own enroll/verify/disable
functions and its own model — this module doesn't wrap or replace any of
that. All it standardises is the two questions fleet_manager/urls.py's
auth_login needs answered generically, for *any* number of providers,
without hand-editing that view every time a new one is added:

  - is_configured(): has an admin set this provider up at all (env vars
    present, etc.)?
  - is_enrolled(user): does this specific user have a confirmed second
    factor with this provider?

auth_login builds `available_methods` by asking every registered
provider is_enrolled(); the actual enroll/confirm/verify calls still go
through each provider's own dedicated endpoints (mfa/urls.py) — this
registry is purely for discovery, not a dispatch layer, so adding a new
provider never requires touching the already-working ones.
"""

from dataclasses import dataclass
from typing import Callable


@dataclass(frozen=True)
class MFAProvider:
    key: str  # 'totp' | 'duo' | 'privacyidea' | 'authpoint' — also the `method` value the frontend/login flow uses
    kind: str  # 'code' (user types something) | 'push' (server triggers, blocks for result)
    is_configured: Callable[[], bool]
    is_enrolled: Callable[[object], bool]


def _totp_configured():
    return True  # no external service/credentials required, always available


def _totp_enrolled(user):
    device = getattr(user, 'totp_device', None)
    return bool(device and device.confirmed)


def _duo_configured():
    from . import duo
    return duo.duo_configured()


def _duo_enrolled(user):
    enrollment = getattr(user, 'duo_enrollment', None)
    return bool(enrollment and enrollment.confirmed)


def _privacyidea_configured():
    from . import privacyidea
    return privacyidea.privacyidea_configured()


def _privacyidea_enrolled(user):
    enrollment = getattr(user, 'privacyidea_enrollment', None)
    return bool(enrollment and enrollment.confirmed)


def _authpoint_configured():
    from . import authpoint
    return authpoint.authpoint_configured()


def _authpoint_enrolled(user):
    # No enrollment model yet — see authpoint.py's module docstring for
    # what's still needed before this can ever return True.
    return False


PROVIDERS: dict[str, MFAProvider] = {
    'totp': MFAProvider('totp', 'code', _totp_configured, _totp_enrolled),
    'duo': MFAProvider('duo', 'push', _duo_configured, _duo_enrolled),
    'privacyidea': MFAProvider('privacyidea', 'code', _privacyidea_configured, _privacyidea_enrolled),
    'authpoint': MFAProvider('authpoint', 'push', _authpoint_configured, _authpoint_enrolled),
}

# Priority order when a user has more than one enrolled — first match
# wins as the *default* method auth_login proposes; available_methods
# still lists every enrolled one so the frontend can offer a switch
# (see login.tsx's "use a different method" links).
PROVIDER_PRIORITY = ['duo', 'authpoint', 'totp', 'privacyidea']


def enrolled_methods(user) -> list[str]:
    """Every provider key this user has a confirmed enrollment with, in
    PROVIDER_PRIORITY order."""
    return [key for key in PROVIDER_PRIORITY if PROVIDERS[key].is_enrolled(user)]
