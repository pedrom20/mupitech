import json
import subprocess

from django.db import migrations


def _read_image_size(file_path):
    from PIL import Image
    try:
        with Image.open(file_path) as img:
            return img.size
    except Exception:
        return None


def _read_video_size(file_path):
    try:
        cmd = [
            'ffprobe', '-v', 'quiet', '-print_format', 'json',
            '-show_streams', file_path,
        ]
        result = subprocess.run(cmd, capture_output=True, text=True, timeout=30)
        data = json.loads(result.stdout)
        for stream in data.get('streams', []):
            if stream.get('codec_type') == 'video':
                width = int(stream.get('width', 0))
                height = int(stream.get('height', 0))
                if width and height:
                    return width, height
        return None
    except Exception:
        return None


def backfill_media_dimensions(apps, schema_editor):
    """One-off backfill for MediaFile.width/height on rows uploaded
    before those fields existed (0002_mediafile_width_height).

    Without this, the orientation-mismatch warning (deploy-form.tsx /
    player-detail.tsx's isOrientationMismatch) silently never fires for
    any content uploaded before that migration — the check just
    returns False when width/height are null. New uploads already get
    these fields populated at upload time by content/tasks.py; this
    only catches up the pre-existing library.
    """
    MediaFile = apps.get_model('content', 'MediaFile')
    queryset = MediaFile.objects.filter(
        width__isnull=True, file_type__in=('image', 'video'),
    ).exclude(file='')

    for media_file in queryset.iterator():
        if not media_file.file:
            continue
        try:
            file_path = media_file.file.path
        except Exception:
            continue

        if media_file.file_type == 'image':
            size = _read_image_size(file_path)
        else:
            size = _read_video_size(file_path)

        if not size:
            continue
        media_file.width, media_file.height = size
        media_file.save(update_fields=['width', 'height'])


def noop_reverse(apps, schema_editor):
    pass


class Migration(migrations.Migration):

    dependencies = [
        ('content', '0003_mediafile_soft_delete'),
    ]

    operations = [
        migrations.RunPython(backfill_media_dimensions, noop_reverse),
    ]
