"""Optional AD/LDAP authentication — prepared but not wired to any real
directory yet (same "structure ready, nothing to verify against"
status as mfa/authpoint.py's stub, for the same reason: no test server
available).

Uses django-auth-ldap (the standard Django LDAP backend), added to
AUTHENTICATION_BACKENDS from fleet_manager/settings.py only when
ldap_configured() is True — unconfigured, this deployment behaves
exactly as it always has (ModelBackend only), and django_auth_ldap /
python-ldap are never imported at all, so an unconfigured install pays
no runtime cost for this existing.

What's genuinely NOT done yet, deliberately:
  - Group-to-role mapping. A freshly LDAP-authenticated user is
    created with no role (_user_role() falls back to its own default
    for a groupless user) until an existing admin assigns one from the
    Users page — safer than guessing an AD group name -> viewer/editor/
    admin/superadmin mapping blind, with no real directory to check
    what group names actually exist. AUTH_LDAP_MIRROR_GROUPS is
    deliberately left off for the same reason — it would create a
    Django Group per AD group, but _user_role() only recognises those
    four specific names; nothing here reconciles the two, so turning
    it on would just create noise groups without changing anyone's
    role.
  - MFA interaction needs nothing special: an LDAP-authenticated user
    still goes through TOTP/Duo/privacyIDEA the same as anyone else
    once they have a confirmed enrollment — that logic keys off the
    User row itself, not which backend authenticated it.

Env vars (all four required together — see .env.example):
  AUTH_LDAP_SERVER_URI        e.g. ldaps://dc1.example.com
  AUTH_LDAP_BIND_DN           service account DN LDAP binds as to search
  AUTH_LDAP_BIND_PASSWORD
  AUTH_LDAP_USER_SEARCH_BASE  e.g. OU=Users,DC=example,DC=com
  AUTH_LDAP_USER_SEARCH_FILTER  optional, default below assumes Active
                                 Directory's usual login attribute;
                                 for non-AD LDAP servers try '(uid=%(user)s)'.
"""

import os

_DEFAULT_USER_SEARCH_FILTER = '(sAMAccountName=%(user)s)'


def ldap_configured():
    return bool(
        os.environ.get('AUTH_LDAP_SERVER_URI')
        and os.environ.get('AUTH_LDAP_BIND_DN')
        and os.environ.get('AUTH_LDAP_BIND_PASSWORD')
        and os.environ.get('AUTH_LDAP_USER_SEARCH_BASE')
    )


def ldap_settings():
    """Returns the AUTH_LDAP_* values fleet_manager/settings.py should
    set at module level (not via django.conf.settings — this runs
    *during* settings.py's own evaluation, before that proxy is usable).
    Only call when ldap_configured() is True."""
    import ldap
    from django_auth_ldap.config import LDAPSearch

    return {
        'AUTH_LDAP_SERVER_URI': os.environ['AUTH_LDAP_SERVER_URI'],
        'AUTH_LDAP_BIND_DN': os.environ['AUTH_LDAP_BIND_DN'],
        'AUTH_LDAP_BIND_PASSWORD': os.environ['AUTH_LDAP_BIND_PASSWORD'],
        'AUTH_LDAP_USER_SEARCH': LDAPSearch(
            os.environ['AUTH_LDAP_USER_SEARCH_BASE'],
            ldap.SCOPE_SUBTREE,
            os.environ.get('AUTH_LDAP_USER_SEARCH_FILTER', _DEFAULT_USER_SEARCH_FILTER),
        ),
        'AUTH_LDAP_USER_ATTR_MAP': {
            'first_name': 'givenName',
            'last_name': 'sn',
            'email': 'mail',
        },
        'AUTH_LDAP_ALWAYS_UPDATE_USER': True,
    }
