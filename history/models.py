import uuid

from django.conf import settings
from django.db import models

from players.models import Player


class AuditLog(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    timestamp = models.DateTimeField(auto_now_add=True, db_index=True)
    user = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.SET_NULL, null=True, blank=True,
    )
    action = models.CharField(max_length=50)
    target_type = models.CharField(max_length=50)
    target_id = models.CharField(max_length=255, blank=True, default='')
    target_name = models.CharField(max_length=255, blank=True, default='')
    details = models.JSONField(default=dict, blank=True)
    ip_address = models.GenericIPAddressField(null=True, blank=True)

    class Meta:
        db_table = 'deploy_auditlog'
        ordering = ['-timestamp']

    def __str__(self):
        return f'{self.timestamp} {self.user} {self.action} {self.target_type}'


class PlaybackLog(models.Model):
    """Log of asset playback events detected during polling."""
    id = models.BigAutoField(primary_key=True)
    player = models.ForeignKey(
        Player,
        on_delete=models.CASCADE,
        related_name='playback_logs',
    )
    asset_id = models.CharField(max_length=100)
    asset_name = models.CharField(max_length=200)
    mimetype = models.CharField(max_length=50, blank=True, default='')
    event = models.CharField(
        max_length=20,
        choices=[('started', 'Started'), ('stopped', 'Stopped')],
        default='started',
    )
    timestamp = models.DateTimeField()

    class Meta:
        db_table = 'players_playbacklog'
        ordering = ['-timestamp']
        indexes = [
            models.Index(fields=['player', '-timestamp'], name='players_pla_player__e39d59_idx'),
            models.Index(fields=['-timestamp'], name='players_pla_timesta_bf4e2d_idx'),
        ]
        constraints = [
            models.UniqueConstraint(
                fields=['player', 'asset_id', 'timestamp', 'event'],
                name='unique_playback_entry',
            ),
        ]

    def __str__(self):
        return f'{self.player.name} — {self.asset_name} [{self.event}]'
