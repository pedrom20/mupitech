from django.conf import settings
from django.db import models

from .crypto import decrypt_secret, encrypt_secret


class TOTPDevice(models.Model):
    """A user's TOTP (6-digit code) second factor.

    One row per user (OneToOne, same pattern as access/models.py's
    UserAccessScope). `confirmed=False` rows are pending enrolment — the
    secret exists but hasn't been proven to work yet (the user hasn't
    entered a valid code from their authenticator app), so login never
    checks unconfirmed devices.
    """

    user = models.OneToOneField(
        settings.AUTH_USER_MODEL,
        on_delete=models.CASCADE,
        related_name='totp_device',
    )
    secret_encrypted = models.TextField()
    confirmed = models.BooleanField(default=False)
    confirmed_at = models.DateTimeField(null=True, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)
    last_used_at = models.DateTimeField(null=True, blank=True)

    def __str__(self):
        return f'TOTP device for {self.user} ({"confirmed" if self.confirmed else "pending"})'

    def set_secret(self, raw_secret):
        self.secret_encrypted = encrypt_secret(raw_secret)

    def get_secret(self):
        return decrypt_secret(self.secret_encrypted)


class DuoEnrollment(models.Model):
    """A user's Duo Security push second factor — an alternative to
    TOTPDevice above for users who'd rather approve a push notification
    on their phone than type a 6-digit code. Requires a Duo account
    (see mfa/duo.py) — no secret is stored on our side at all, Duo
    manages the actual enrollment (the /enroll QR flow) and holds the
    user's device; we just remember which Duo identity a Fleet Manager
    user maps to and whether that enrollment was ever confirmed.

    `activation_code` is only meaningful transiently, between calling
    enroll() and the operator finishing Duo Mobile's scan — kept so
    confirm() can poll enroll_status() without the frontend needing to
    round-trip it back to us.
    """

    user = models.OneToOneField(
        settings.AUTH_USER_MODEL,
        on_delete=models.CASCADE,
        related_name='duo_enrollment',
    )
    duo_user_id = models.CharField(max_length=64)
    duo_username = models.CharField(max_length=150)
    activation_code = models.CharField(max_length=255, blank=True, default='')
    confirmed = models.BooleanField(default=False)
    confirmed_at = models.DateTimeField(null=True, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)
    last_used_at = models.DateTimeField(null=True, blank=True)

    def __str__(self):
        return f'Duo enrollment for {self.user} ({"confirmed" if self.confirmed else "pending"})'


class MFAProviderConfig(models.Model):
    """Admin-editable credentials for an external MFA provider (Duo,
    privacyIDEA, AuthPoint) — lets an admin set these from the Settings
    UI instead of only via env vars + a redeploy. One row per provider
    key; see mfa/provider_config.py for the merge logic (a field set
    here overrides the matching env var; an unset field here still
    falls back to its env var, so existing env-var-only deployments
    keep working unchanged). Encrypted the same way
    TOTPDevice.secret_encrypted is (mfa/crypto.py) — config_encrypted
    holds a JSON blob of the provider's fields, not per-field columns,
    since each provider needs a different shape.
    """

    provider = models.CharField(max_length=32, unique=True)
    config_encrypted = models.TextField(blank=True, default='')
    updated_at = models.DateTimeField(auto_now=True)
    updated_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        null=True,
        blank=True,
        on_delete=models.SET_NULL,
    )

    def __str__(self):
        return f'MFA provider config: {self.provider}'


class PrivacyIDEAEnrollment(models.Model):
    """A user's privacyIDEA second factor — same shape as TOTPDevice
    above, but the secret (or, for a push token, the key pair) lives on
    the privacyIDEA server (see mfa/privacyidea.py), not here. `serial`
    is privacyIDEA's own token identifier, needed to disable/delete the
    token later; we never see or store the shared secret itself,
    matching DuoEnrollment's "no secret on our side" property via a
    different mechanism.

    `token_type` picks which of privacyIDEA's own token types this is:
    'totp' behaves exactly like before (type this file's earlier
    versions only supported) — a 6-digit code, confirmed the moment a
    valid one is entered. 'push' has no code to type at all: enrolment
    finishes asynchronously once the privacyIDEA Authenticator app
    completes its own registration (mfa/privacyidea.py's
    check_push_rollout, polled by mfa/views.py::privacyidea_confirm the
    same way mfa/duo.py's enrollment is already polled), and login is a
    trigger-and-wait against privacyIDEA's challenge/poll API instead of
    a typed code (mfa/privacyidea.py::trigger_and_wait_push).
    """

    TOKEN_TYPE_CHOICES = [('totp', 'totp'), ('push', 'push')]

    user = models.OneToOneField(
        settings.AUTH_USER_MODEL,
        on_delete=models.CASCADE,
        related_name='privacyidea_enrollment',
    )
    serial = models.CharField(max_length=64)
    token_type = models.CharField(max_length=8, choices=TOKEN_TYPE_CHOICES, default='totp')
    confirmed = models.BooleanField(default=False)
    confirmed_at = models.DateTimeField(null=True, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)
    last_used_at = models.DateTimeField(null=True, blank=True)

    def __str__(self):
        return f'privacyIDEA enrollment for {self.user} ({"confirmed" if self.confirmed else "pending"})'


class MFAPolicy(models.Model):
    """Singleton row (always pk=1) holding the admin-set dual-MFA policy:
    which roles must pass two challenges from two different providers to
    log in, not just one. Combines with the per-user self-service opt-in
    on access.models.UserAccessScope.require_dual_mfa — either being true
    is enough (see mfa/policy.py::dual_mfa_required, the only reader).
    A dedicated table rather than the Redis-cache-with-no-timeout pattern
    fleet_manager/system_views.py::system_settings uses for the
    auto_update toggle: this is security policy, so it should survive a
    Redis flush and show up in normal DB backups.
    """

    require_dual_roles = models.JSONField(
        default=list,
        help_text='Subset of [\'viewer\', \'editor\', \'admin\', \'superadmin\'] that must '
                   'always pass two MFA challenges to log in.',
    )
    updated_at = models.DateTimeField(auto_now=True)
    updated_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        null=True,
        blank=True,
        on_delete=models.SET_NULL,
    )

    def __str__(self):
        return f'MFA policy (dual-required roles: {self.require_dual_roles or "none"})'

    @classmethod
    def get(cls):
        obj, _ = cls.objects.get_or_create(pk=1)
        return obj
