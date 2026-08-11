from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ('players', '0019_player_device_type_x86'),
    ]

    operations = [
        migrations.AddField(
            model_name='player',
            name='screen_rotation',
            field=models.IntegerField(
                choices=[(0, '0'), (90, '90'), (180, '180'), (270, '270')],
                default=0,
                help_text="Cached screen_rotation from this device's settings — synced "
                          'whenever device-settings is read or updated, so the UI can show '
                          'orientation without a live round-trip to the device.',
            ),
        ),
    ]
