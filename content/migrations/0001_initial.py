import uuid

import django.db.models.deletion
from django.db import migrations, models


class Migration(migrations.Migration):
    """State-only: registers MediaFolder/MediaFile (moved from deploy) against
    the already-existing deploy_mediafolder/deploy_mediafile tables. No real
    database operation runs — see deploy migrations 0002/0006/0007 for the
    original table creation.
    """

    initial = True

    dependencies = []

    operations = [
        migrations.SeparateDatabaseAndState(
            state_operations=[
                migrations.CreateModel(
                    name='MediaFolder',
                    fields=[
                        ('id', models.UUIDField(default=uuid.uuid4, editable=False, primary_key=True, serialize=False)),
                        ('name', models.CharField(max_length=100)),
                        ('created_at', models.DateTimeField(auto_now_add=True)),
                    ],
                    options={
                        'db_table': 'deploy_mediafolder',
                        'ordering': ['name'],
                    },
                ),
                migrations.CreateModel(
                    name='MediaFile',
                    fields=[
                        ('id', models.UUIDField(default=uuid.uuid4, editable=False, primary_key=True, serialize=False)),
                        ('name', models.CharField(max_length=200)),
                        ('file', models.FileField(blank=True, null=True, upload_to='media_files/')),
                        ('thumbnail', models.ImageField(blank=True, null=True, upload_to='thumbnails/')),
                        ('source_url', models.URLField(blank=True, max_length=500, null=True)),
                        ('thumbnail_url', models.URLField(blank=True, max_length=500, null=True)),
                        ('file_type', models.CharField(default='other', max_length=20)),
                        ('file_size', models.BigIntegerField(default=0)),
                        ('processing_status', models.CharField(
                            choices=[('ready', 'Ready'), ('processing', 'Processing'), ('failed', 'Failed')],
                            default='ready', max_length=20,
                        )),
                        ('created_at', models.DateTimeField(auto_now_add=True)),
                        ('folder', models.ForeignKey(
                            blank=True, null=True, on_delete=django.db.models.deletion.SET_NULL,
                            related_name='files', to='content.mediafolder',
                        )),
                    ],
                    options={
                        'db_table': 'deploy_mediafile',
                        'ordering': ['-created_at'],
                    },
                ),
            ],
            database_operations=[],
        ),
    ]
