from django.conf import settings
from django.db import models


class UserAccessScope(models.Model):
    """Restricts a user to specific locations/groups/players.

    Access cascades downward only: a location grants its groups and
    players, a group grants its players. A directly-scoped player does
    not grant access to its group or location. An empty scope (no rows
    in any of the three M2Ms) means unrestricted access — the default,
    matching pre-existing behaviour for every current user.
    """

    user = models.OneToOneField(
        settings.AUTH_USER_MODEL,
        on_delete=models.CASCADE,
        related_name='access_scope',
    )
    locations = models.ManyToManyField(
        'locations.Location', blank=True, related_name='scoped_users',
    )
    groups = models.ManyToManyField(
        'groups.Group', blank=True, related_name='scoped_users',
    )
    players = models.ManyToManyField(
        'players.Player', blank=True, related_name='scoped_users',
    )
    receive_offline_alerts = models.BooleanField(
        default=True,
        help_text='Whether this user (if admin/superadmin) receives device-offline '
                   'alert emails. Only relevant if alert emails are enabled system-wide.',
    )
    can_delete_content = models.BooleanField(
        default=True,
        help_text='Whether this user (if editor/admin) may delete library content and '
                   'branding images. Superadmins are always allowed; viewers never are '
                   '(no write access at all). Lets an admin grant upload/edit rights '
                   'without also granting deletion rights.',
    )
    must_change_password = models.BooleanField(
        default=False,
        help_text='Set at user creation to force a password change before the user can '
                   'use the Fleet Manager. Cleared automatically once they change it via '
                   'the self-service change-password endpoint.',
    )
    force_mfa_enroll = models.BooleanField(
        default=False,
        help_text='Set at user creation to force MFA enrolment (TOTP or Duo) before the '
                   'user can use the Fleet Manager. Cleared automatically once either '
                   'enrolment is confirmed.',
    )
    require_dual_mfa = models.BooleanField(
        default=False,
        help_text='Self-service opt-in: require two challenges from two different MFA '
                   'providers to log in, not just one. Independent of (and additive to) '
                   'mfa.models.MFAPolicy\'s admin-set per-role requirement — either one '
                   'being true is enough to trigger it. Only takes effect once this user '
                   'has 2+ confirmed providers enrolled; with just one, login degrades to '
                   'that single factor rather than locking them out. See '
                   'mfa/policy.py::dual_mfa_required, the only reader.',
    )

    def __str__(self):
        return f'Access scope for {self.user}'

    def is_restricted(self):
        return self.locations.exists() or self.groups.exists() or self.players.exists()
