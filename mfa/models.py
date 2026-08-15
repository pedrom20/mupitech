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


class PrivacyIDEAEnrollment(models.Model):
    """A user's privacyIDEA TOTP second factor — same shape as
    TOTPDevice above, but the secret lives on the privacyIDEA server
    (see mfa/privacyidea.py), not here. `serial` is privacyIDEA's own
    token identifier, needed to disable/delete the token later; we
    never see or store the shared secret itself, matching DuoEnrollment's
    "no secret on our side" property via a different mechanism.
    """

    user = models.OneToOneField(
        settings.AUTH_USER_MODEL,
        on_delete=models.CASCADE,
        related_name='privacyidea_enrollment',
    )
    serial = models.CharField(max_length=64)
    confirmed = models.BooleanField(default=False)
    confirmed_at = models.DateTimeField(null=True, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)
    last_used_at = models.DateTimeField(null=True, blank=True)

    def __str__(self):
        return f'privacyIDEA enrollment for {self.user} ({"confirmed" if self.confirmed else "pending"})'
