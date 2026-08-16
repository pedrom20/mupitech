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
    kind_for: Callable[[object], str]  # 'code' (user types something) | 'push' (server triggers, blocks for result)
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


def _privacyidea_kind(user):
    # The only provider whose kind isn't fixed — a user picks either a
    # TOTP code or a push token at enrolment time (mfa/models.py's
    # PrivacyIDEAEnrollment.token_type), so this has to actually look
    # at their enrollment rather than return a constant like every
    # other provider below.
    enrollment = getattr(user, 'privacyidea_enrollment', None)
    return 'push' if enrollment and enrollment.token_type == 'push' else 'code'


def _authpoint_configured():
    from . import authpoint
    return authpoint.authpoint_configured()


def _authpoint_enrolled(user):
    # No enrollment model yet — see authpoint.py's module docstring for
    # what's still needed before this can ever return True.
    return False


def _email_configured():
    from . import email_otp
    return email_otp.email_otp_configured()


def _email_enrolled(user):
    device = getattr(user, 'email_otp_device', None)
    return bool(device and device.confirmed)


PROVIDERS: dict[str, MFAProvider] = {
    'totp': MFAProvider('totp', lambda user: 'code', _totp_configured, _totp_enrolled),
    'duo': MFAProvider('duo', lambda user: 'push', _duo_configured, _duo_enrolled),
    'privacyidea': MFAProvider('privacyidea', _privacyidea_kind, _privacyidea_configured, _privacyidea_enrolled),
    'authpoint': MFAProvider('authpoint', lambda user: 'push', _authpoint_configured, _authpoint_enrolled),
    'email': MFAProvider('email', lambda user: 'code', _email_configured, _email_enrolled),
}

# Priority order when a user has more than one enrolled — first match
# wins as the *default* method auth_login proposes; available_methods
# still lists every enrolled one so the frontend can offer a switch
# (see login.tsx's "use a different method" links). Email sits last —
# it needs a round trip to the user's inbox, slower than a code already
# sitting in an authenticator app or a single push tap.
PROVIDER_PRIORITY = ['duo', 'authpoint', 'totp', 'privacyidea', 'email']


def enrolled_methods(user) -> list[str]:
    """Every provider key this user has a confirmed enrollment with,
    push-kind ones first (single tap, no code to type) and otherwise in
    PROVIDER_PRIORITY order. Sorted dynamically rather than just
    filtering PROVIDER_PRIORITY in place, since privacyidea's kind
    depends on *this user's* enrollment (see _privacyidea_kind) — a
    user with a privacyidea push token should see it offered before
    totp even though 'totp' sits earlier in PROVIDER_PRIORITY's base
    order, which only reflects the always-one-kind providers."""
    keys = [key for key in PROVIDER_PRIORITY if PROVIDERS[key].is_enrolled(user)]
    return sorted(keys, key=lambda k: (PROVIDERS[k].kind_for(user) != 'push', PROVIDER_PRIORITY.index(k)))


def push_methods(user) -> list[str]:
    """Subset of enrolled_methods(user) that are push-kind *for this
    user* — privacyidea only belongs here if they specifically enrolled
    a push token, not a TOTP one, hence checking kind_for(user) rather
    than a static per-provider flag."""
    return [key for key in enrolled_methods(user) if PROVIDERS[key].kind_for(user) == 'push']
