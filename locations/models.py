import uuid

from django.db import models


class Location(models.Model):
    """A physical site (building, street, municipality area, ...).

    Contains groups and/or players directly (players without a group are
    placed here directly via Player.location).
    """

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    name = models.CharField(max_length=100)
    color = models.CharField(max_length=7, default='#005096')
    description = models.TextField(blank=True, default='')
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ['name']

    def __str__(self):
        return self.name
