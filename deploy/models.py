import uuid

from django.db import models

from players.models import Player


class DeployTask(models.Model):
    STATUS_CHOICES = [
        ('pending', 'Pending'),
        ('running', 'Running'),
        ('completed', 'Completed'),
        ('failed', 'Failed'),
    ]

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    name = models.CharField(max_length=200)
    asset_data = models.JSONField(
        default=dict,
        help_text='JSON describing the asset to deploy (name, URI, duration, etc.).',
    )
    file_path = models.FileField(
        upload_to='deploy_files/',
        null=True,
        blank=True,
    )
    target_players = models.ManyToManyField(
        Player,
        related_name='deploy_tasks',
        blank=True,
    )
    status = models.CharField(
        max_length=20,
        choices=STATUS_CHOICES,
        default='pending',
    )
    progress = models.JSONField(
        default=dict,
        blank=True,
        help_text='Per-player progress tracking, e.g. {"player_id": "success"}.',
    )
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ['-created_at']

    def __str__(self):
        return f'{self.name} ({self.status})'
