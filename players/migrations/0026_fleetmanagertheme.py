from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ('players', '0025_normalize_player_url_trailing_slash'),
    ]

    operations = [
        migrations.CreateModel(
            name='FleetManagerTheme',
            fields=[
                ('id', models.PositiveSmallIntegerField(default=1, editable=False, primary_key=True, serialize=False)),
                ('partner_logo', models.FileField(blank=True, null=True, upload_to='branding/fleet_manager/')),
                ('updated_at', models.DateTimeField(auto_now=True)),
            ],
            options={
                'verbose_name': 'Fleet Manager theme',
                'verbose_name_plural': 'Fleet Manager theme',
            },
        ),
    ]
