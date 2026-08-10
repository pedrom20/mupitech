import uuid

import django.db.models.deletion
from django.conf import settings
from django.db import migrations, models


class Migration(migrations.Migration):
    """State-only: registers AuditLog (moved from deploy) and PlaybackLog
    (moved from players) against the already-existing deploy_auditlog /
    players_playbacklog tables. No real database operation runs — see
    deploy.0011_auditlog and players.0004/0005/0006 for the original table
    creation.
    """

    initial = True

    dependencies = [
        ('players', '0001_initial'),
        migrations.swappable_dependency(settings.AUTH_USER_MODEL),
    ]

    operations = [
        migrations.SeparateDatabaseAndState(
            state_operations=[
                migrations.CreateModel(
                    name='AuditLog',
                    fields=[
                        ('id', models.UUIDField(default=uuid.uuid4, editable=False, primary_key=True, serialize=False)),
                        ('timestamp', models.DateTimeField(auto_now_add=True, db_index=True)),
                        ('action', models.CharField(max_length=50)),
                        ('target_type', models.CharField(max_length=50)),
                        ('target_id', models.CharField(blank=True, default='', max_length=255)),
                        ('target_name', models.CharField(blank=True, default='', max_length=255)),
                        ('details', models.JSONField(blank=True, default=dict)),
                        ('ip_address', models.GenericIPAddressField(blank=True, null=True)),
                        ('user', models.ForeignKey(
                            blank=True, null=True, on_delete=django.db.models.deletion.SET_NULL,
                            to=settings.AUTH_USER_MODEL,
                        )),
                    ],
                    options={
                        'db_table': 'deploy_auditlog',
                        'ordering': ['-timestamp'],
                    },
                ),
                migrations.CreateModel(
                    name='PlaybackLog',
                    fields=[
                        ('id', models.BigAutoField(primary_key=True, serialize=False)),
                        ('asset_id', models.CharField(max_length=100)),
                        ('asset_name', models.CharField(max_length=200)),
                        ('mimetype', models.CharField(blank=True, default='', max_length=50)),
                        ('event', models.CharField(choices=[('started', 'Started'), ('stopped', 'Stopped')], default='started', max_length=20)),
                        ('timestamp', models.DateTimeField()),
                        ('player', models.ForeignKey(
                            on_delete=django.db.models.deletion.CASCADE,
                            related_name='playback_logs', to='players.player',
                        )),
                    ],
                    options={
                        'db_table': 'players_playbacklog',
                        'ordering': ['-timestamp'],
                        'indexes': [
                            models.Index(fields=['player', '-timestamp'], name='players_pla_player__e39d59_idx'),
                            models.Index(fields=['-timestamp'], name='players_pla_timesta_bf4e2d_idx'),
                        ],
                        'constraints': [
                            models.UniqueConstraint(fields=('player', 'asset_id', 'timestamp', 'event'), name='unique_playback_entry'),
                        ],
                    },
                ),
            ],
            database_operations=[],
        ),
    ]
