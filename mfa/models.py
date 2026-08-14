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
