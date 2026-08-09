import django.db.models.deletion
from django.db import migrations, models


class Migration(migrations.Migration):
    """State-only: MediaFolder/MediaFile now live in the `content` app (same
    deploy_mediafolder/deploy_mediafile tables, see content.0001_initial).
    CctvConfig.media_file is repointed to 'content.MediaFile'. No real
    database operation runs here.
    """

    dependencies = [
        ('deploy', '0013_cctvcamera_source_type'),
        ('content', '0001_initial'),
    ]

    operations = [
        migrations.SeparateDatabaseAndState(
            state_operations=[
                migrations.AlterField(
                    model_name='cctvconfig',
                    name='media_file',
                    field=models.OneToOneField(
                        blank=True,
                        null=True,
                        on_delete=django.db.models.deletion.SET_NULL,
                        related_name='cctv_config',
                        to='content.mediafile',
                    ),
                ),
                migrations.DeleteModel(
                    name='MediaFile',
                ),
                migrations.DeleteModel(
                    name='MediaFolder',
                ),
            ],
            database_operations=[],
        ),
    ]
