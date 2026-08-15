"""Whether a user must pass two challenges from two different MFA
providers to log in, rather than one.

Two independent triggers, either sufficient on its own:
  - an admin-set global policy naming which *roles* require it
    (MFAPolicy, see mfa/models.py)
  - a per-user self-service opt-in, regardless of role
    (access.models.UserAccessScope.require_dual_mfa)

Actually enforcing this also requires the user to have 2+ *enrolled*
providers — fleet_manager/urls.py::auth_login is the only caller, and it
ANDs this with `len(available_methods) >= 2` before setting
`dual_required` on the login challenge, so a user who only ever enrolled
one method never gets locked out by a policy that assumed they'd have a
second.
"""


def dual_mfa_required(user) -> bool:
    from fleet_manager.permissions import _user_role

    from .models import MFAPolicy

    if _user_role(user) in MFAPolicy.get().require_dual_roles:
        return True
    scope = getattr(user, 'access_scope', None)
    return bool(scope and scope.require_dual_mfa)
