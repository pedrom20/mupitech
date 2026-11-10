from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ('players', '0032_playersnapshot_timestamp_idx'),
    ]

    operations = [
        migrations.AddField(
            model_name='player',
            name='exclude_from_sla',
            field=models.BooleanField(default=False, help_text="Leaves this device out of the fleet-wide uptime % in reports/views.py::sla (e.g. a device deliberately kept offline for testing) — still listed in that report's per-device table, just marked and not counted toward the fleet total."),
        ),
    ]
