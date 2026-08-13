import uuid

import django.db.models.deletion
from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ('content', '0004_backfill_media_dimensions'),
        ('playlists', '0002_playlist_deployed_assets'),
        ('players', '0024_brandingimage_soft_delete'),
        ('groups', '0004_group_splash_logo_group_standby_image'),
        ('locations', '0002_location_splash_logo_location_standby_image'),
    ]

    operations = [
        migrations.CreateModel(
            name='ScheduledDeployment',
            fields=[
                ('id', models.UUIDField(default=uuid.uuid4, editable=False, primary_key=True, serialize=False)),
                ('duration', models.PositiveIntegerField(blank=True, help_text='Seconds. Only used for a media_file schedule.', null=True)),
                ('start_date', models.DateTimeField(blank=True, null=True)),
                ('end_date', models.DateTimeField(blank=True, null=True)),
                ('last_deploy_status', models.JSONField(blank=True, default=dict, help_text='Per-player result of the deploy that created this schedule, e.g. {player_id: {name, success, error}}.')),
                ('deployed_assets', models.JSONField(blank=True, default=dict, help_text="Per-player asset IDs this schedule created (media_file schedules only — a playlist schedule's assets are tracked on the Playlist itself), so cancelling can remove them from each device instead of only forgetting the bookkeeping row.")),
                ('created_at', models.DateTimeField(auto_now_add=True)),
                ('media_file', models.ForeignKey(blank=True, null=True, on_delete=django.db.models.deletion.CASCADE, related_name='schedules', to='content.mediafile')),
                ('playlist', models.ForeignKey(blank=True, null=True, on_delete=django.db.models.deletion.CASCADE, related_name='schedules', to='playlists.playlist')),
                ('target_groups', models.ManyToManyField(blank=True, related_name='content_schedules', to='groups.group')),
                ('target_locations', models.ManyToManyField(blank=True, related_name='content_schedules', to='locations.location')),
                ('target_players', models.ManyToManyField(blank=True, related_name='content_schedules', to='players.player')),
            ],
            options={
                'ordering': ['-created_at'],
            },
        ),
    ]
