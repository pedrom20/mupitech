import uuid

import django.db.models.deletion
from django.db import migrations, models


class Migration(migrations.Migration):
    """State-only: registers CctvConfig/CctvCamera (moved from deploy) against
    the already-existing deploy_cctvconfig/deploy_cctvcamera tables. No real
    database operation runs — see deploy migrations 0008/0009/0012/0013 for
    the original table creation/changes.
    """

    initial = True

    dependencies = [
        ('content', '0001_initial'),
    ]

    operations = [
        migrations.SeparateDatabaseAndState(
            state_operations=[
                migrations.CreateModel(
                    name='CctvConfig',
                    fields=[
                        ('id', models.UUIDField(default=uuid.uuid4, editable=False, primary_key=True, serialize=False)),
                        ('name', models.CharField(max_length=255)),
                        ('display_mode', models.CharField(choices=[('mosaic', 'Mosaic'), ('rotation', 'Rotation')], default='mosaic', max_length=10)),
                        ('rotation_interval', models.IntegerField(default=10)),
                        ('resolution', models.CharField(default='1920x1080', max_length=20)),
                        ('fps', models.IntegerField(default=15)),
                        ('mosaic_layout', models.JSONField(blank=True, default=None, null=True)),
                        ('is_active', models.BooleanField(default=False)),
                        ('last_requested_at', models.DateTimeField(blank=True, null=True)),
                        ('created_at', models.DateTimeField(auto_now_add=True)),
                        ('media_file', models.OneToOneField(
                            blank=True, null=True, on_delete=django.db.models.deletion.SET_NULL,
                            related_name='cctv_config', to='content.mediafile',
                        )),
                    ],
                    options={
                        'db_table': 'deploy_cctvconfig',
                        'ordering': ['-created_at'],
                    },
                ),
                migrations.CreateModel(
                    name='CctvCamera',
                    fields=[
                        ('id', models.UUIDField(default=uuid.uuid4, editable=False, primary_key=True, serialize=False)),
                        ('name', models.CharField(blank=True, default='', max_length=255)),
                        ('rtsp_url', models.TextField()),
                        ('source_type', models.CharField(choices=[('rtsp', 'RTSP'), ('web', 'Web Page')], default='rtsp', max_length=10)),
                        ('sort_order', models.IntegerField(default=0)),
                        ('config', models.ForeignKey(
                            on_delete=django.db.models.deletion.CASCADE,
                            related_name='cameras', to='cctv.cctvconfig',
                        )),
                    ],
                    options={
                        'db_table': 'deploy_cctvcamera',
                        'ordering': ['sort_order'],
                    },
                ),
            ],
            database_operations=[],
        ),
    ]
