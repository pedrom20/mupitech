from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ('players', '0021_brandingimage'),
    ]

    operations = [
        migrations.AddField(
            model_name='player',
            name='last_offline_alert_at',
            field=models.DateTimeField(
                blank=True, null=True,
                help_text='When an offline-alert email was last sent for this device. '
                           'Reset to null once it comes back online, so the next '
                           'offline period sends a fresh alert instead of staying silent forever.',
            ),
        ),
    ]
