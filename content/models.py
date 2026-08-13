import os
import uuid

from django.db import models


def detect_file_type(filename):
    ext = os.path.splitext(filename)[1].lower()
    image_exts = {'.jpg', '.jpeg', '.png', '.gif', '.svg', '.webp', '.bmp'}
    video_exts = {'.mp4', '.webm', '.ogg', '.mov', '.avi', '.mkv', '.m4v'}
    web_exts = {'.html', '.htm', '.pdf'}
    if ext in image_exts:
        return 'image'
    if ext in video_exts:
        return 'video'
    if ext in web_exts:
        return 'web'
    return 'other'


class MediaFolder(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    name = models.CharField(max_length=100)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        db_table = 'deploy_mediafolder'
        ordering = ['name']

    def __str__(self):
        return self.name


class MediaFile(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    name = models.CharField(max_length=200)
    file = models.FileField(upload_to='media_files/', null=True, blank=True)
    thumbnail = models.ImageField(upload_to='thumbnails/', null=True, blank=True)
    source_url = models.URLField(max_length=500, null=True, blank=True)
    thumbnail_url = models.URLField(max_length=500, null=True, blank=True)
    folder = models.ForeignKey(MediaFolder, null=True, blank=True, on_delete=models.SET_NULL, related_name='files')
    file_type = models.CharField(max_length=20, default='other')
    file_size = models.BigIntegerField(default=0)
    width = models.PositiveIntegerField(
        null=True, blank=True,
        help_text='Pixel dimensions for images/videos — extracted at upload time '
                   '(content/tasks.py), used to warn about portrait/landscape '
                   'mismatches before deploying to a device. Null for webpage '
                   'assets, SVGs and anything Pillow/ffprobe could not read.',
    )
    height = models.PositiveIntegerField(null=True, blank=True)
    is_deleted = models.BooleanField(
        default=False,
        help_text='Soft-deleted — hidden from normal use, recoverable from the '
                   'recycle bin. Only a superadmin can purge it for real.',
    )
    deleted_at = models.DateTimeField(null=True, blank=True)
    processing_status = models.CharField(
        max_length=20,
        choices=[('ready', 'Ready'), ('processing', 'Processing'), ('failed', 'Failed')],
        default='ready',
    )
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        db_table = 'deploy_mediafile'
        ordering = ['-created_at']

    def __str__(self):
        return self.name

    def delete(self, *args, **kwargs):
        if self.thumbnail:
            self.thumbnail.delete(save=False)
        if self.file:
            self.file.delete(save=False)
        super().delete(*args, **kwargs)


class ScheduledDeployment(models.Model):
    """A centralized record of "deploy this content/playlist, within this
    date window" — the counterpart to picking a device and deploying
    content from its own page, but visible in one place (the Scheduling
    page) instead of scattered across every device's history.

    Exactly one of media_file/playlist is set. A media_file schedule
    carries its own ad-hoc targets (target_players/groups/locations) —
    standalone content has no notion of a "default" destination. A
    playlist schedule has none of its own: it reuses the playlist's
    already-configured targets (Playlist.target_players/groups/
    locations), since re-asking for targets here would just duplicate
    (and could silently diverge from) that existing configuration.
    """
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    media_file = models.ForeignKey(
        MediaFile, null=True, blank=True, on_delete=models.CASCADE, related_name='schedules',
    )
    playlist = models.ForeignKey(
        'playlists.Playlist', null=True, blank=True, on_delete=models.CASCADE, related_name='schedules',
    )
    target_players = models.ManyToManyField('players.Player', blank=True, related_name='content_schedules')
    target_groups = models.ManyToManyField('groups.Group', blank=True, related_name='content_schedules')
    target_locations = models.ManyToManyField('locations.Location', blank=True, related_name='content_schedules')
    duration = models.PositiveIntegerField(
        null=True, blank=True, help_text='Seconds. Only used for a media_file schedule.',
    )
    start_date = models.DateTimeField(null=True, blank=True)
    end_date = models.DateTimeField(null=True, blank=True)
    last_deploy_status = models.JSONField(
        default=dict, blank=True,
        help_text='Per-player result of the deploy that created this schedule, '
                   'e.g. {player_id: {name, success, error}}.',
    )
    deployed_assets = models.JSONField(
        default=dict, blank=True,
        help_text='Per-player asset IDs this schedule created (media_file schedules only — '
                   'a playlist schedule\'s assets are tracked on the Playlist itself), so '
                   'cancelling can remove them from each device instead of only forgetting '
                   'the bookkeeping row.',
    )
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ['-created_at']

    def __str__(self):
        return f'Schedule for {self.media_file or self.playlist}'
