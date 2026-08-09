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
