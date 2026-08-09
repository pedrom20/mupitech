import uuid

from django.db import models

from content.models import MediaFile


class CctvConfig(models.Model):
    DISPLAY_MODE_CHOICES = [
        ('mosaic', 'Mosaic'),
        ('rotation', 'Rotation'),
    ]

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    name = models.CharField(max_length=255)
    display_mode = models.CharField(max_length=10, choices=DISPLAY_MODE_CHOICES, default='mosaic')
    rotation_interval = models.IntegerField(default=10)
    resolution = models.CharField(max_length=20, default='1920x1080')
    fps = models.IntegerField(default=15)
    media_file = models.OneToOneField(
        MediaFile, null=True, blank=True, on_delete=models.SET_NULL, related_name='cctv_config',
    )
    mosaic_layout = models.JSONField(null=True, blank=True, default=None)
    is_active = models.BooleanField(default=False)
    last_requested_at = models.DateTimeField(null=True, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        db_table = 'deploy_cctvconfig'
        ordering = ['-created_at']

    def __str__(self):
        return self.name


class CctvCamera(models.Model):
    SOURCE_TYPES = [('rtsp', 'RTSP'), ('web', 'Web Page')]

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    config = models.ForeignKey(CctvConfig, on_delete=models.CASCADE, related_name='cameras')
    name = models.CharField(max_length=255, blank=True, default='')
    rtsp_url = models.TextField()
    source_type = models.CharField(max_length=10, choices=SOURCE_TYPES, default='rtsp')
    sort_order = models.IntegerField(default=0)

    class Meta:
        db_table = 'deploy_cctvcamera'
        ordering = ['sort_order']

    def __str__(self):
        return self.name or self.rtsp_url
