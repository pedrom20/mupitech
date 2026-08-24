import uuid

from django.db import models


class FooterMessage(models.Model):
    """A scrolling text snippet shown in the device's footer ticker bar.

    ``title`` is admin-facing only (identifies this message in the
    management UI) and never reaches a device. ``message`` is what
    actually gets pushed to the device's ticker — authored as free
    multi-line text here, but always flattened to a single line before
    being sent (see services.py::compute_message_map_for_players).

    Several messages can target the same player: the device shows them
    all, concatenated in ``order``, as a single ticker — this mirrors
    how a Playlist's items combine into one sequence rather than each
    item being its own independent thing on the device.
    """

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    title = models.CharField(max_length=500)
    message = models.TextField(max_length=1000, blank=True, default='')
    order = models.IntegerField(default=0)
    is_active = models.BooleanField(default=True)

    target_players = models.ManyToManyField(
        'players.Player', related_name='footer_messages', blank=True,
    )
    target_groups = models.ManyToManyField(
        'groups.Group', related_name='footer_messages', blank=True,
    )
    target_locations = models.ManyToManyField(
        'locations.Location', related_name='footer_messages', blank=True,
    )

    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ['order', 'created_at']

    def __str__(self):
        return self.title[:50]

    def resolve_target_players(self):
        """Same resolution rule as Playlist.resolve_target_players():
        direct players, plus every player in a target group, plus every
        player in a target location (directly-located or via a located
        group)."""
        from players.models import Player

        ids = set(self.target_players.values_list('id', flat=True))
        for group in self.target_groups.all():
            ids.update(group.players.values_list('id', flat=True))
        for location in self.target_locations.all():
            ids.update(location.players.values_list('id', flat=True))
            for group in location.groups.all():
                ids.update(group.players.values_list('id', flat=True))
        return Player.objects.filter(id__in=ids)
