import uuid

from django.db import models


class Group(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    name = models.CharField(max_length=100)
    color = models.CharField(max_length=7, default='#0082C8')
    description = models.TextField(blank=True, default='')
    location = models.ForeignKey(
        'locations.Location',
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name='groups',
    )
    splash_logo = models.FileField(
        upload_to='branding/groups/', null=True, blank=True,
        help_text='Overrides the fleet-wide splash logo for devices in this group.',
    )
    standby_image = models.FileField(
        upload_to='branding/groups/', null=True, blank=True,
        help_text='Overrides the fleet-wide standby image for devices in this group.',
    )
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        db_table = 'players_group'
        ordering = ['name']

    def __str__(self):
        return self.name
