import uuid

from django.db import models


class Group(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    name = models.CharField(max_length=100)
    color = models.CharField(max_length=7, default='#0082C8')
    description = models.TextField(blank=True, default='')
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        db_table = 'players_group'
        ordering = ['name']

    def __str__(self):
        return self.name
