import uuid

from django.db import models


class Playlist(models.Model):
    """An ordered collection of content items that can be pushed to
    players directly, or to every player in a group/location.
    """

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    name = models.CharField(max_length=200)
    description = models.TextField(blank=True, default='')

    target_players = models.ManyToManyField(
        'players.Player', related_name='playlists', blank=True,
    )
    target_groups = models.ManyToManyField(
        'groups.Group', related_name='playlists', blank=True,
    )
    target_locations = models.ManyToManyField(
        'locations.Location', related_name='playlists', blank=True,
    )

    last_deploy_status = models.JSONField(
        default=dict, blank=True,
        help_text='Per-player result of the last deploy, e.g. {player_id: {name, success, items}}.',
    )
    last_deployed_at = models.DateTimeField(null=True, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ['name']

    def __str__(self):
        return self.name

    def resolve_target_players(self):
        """All players this playlist applies to: direct players, plus every
        player in a target group, plus every player in a target location
        (directly-located ungrouped players and players via a located group).
        """
        from players.models import Player

        ids = set(self.target_players.values_list('id', flat=True))
        for group in self.target_groups.all():
            ids.update(group.players.values_list('id', flat=True))
        for location in self.target_locations.all():
            ids.update(location.players.values_list('id', flat=True))
            for group in location.groups.all():
                ids.update(group.players.values_list('id', flat=True))
        return Player.objects.filter(id__in=ids)


class PlaylistItem(models.Model):
    id = models.BigAutoField(primary_key=True)
    playlist = models.ForeignKey(Playlist, on_delete=models.CASCADE, related_name='items')
    media_file = models.ForeignKey('content.MediaFile', on_delete=models.CASCADE, related_name='playlist_items')
    order = models.IntegerField(default=0)
    duration = models.IntegerField(
        null=True, blank=True,
        help_text='Duration override in seconds. Leave empty to use the default.',
    )

    class Meta:
        ordering = ['order']

    def __str__(self):
        return f'{self.playlist.name} #{self.order}: {self.media_file.name}'
