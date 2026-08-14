from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ('players', '0026_fleetmanagertheme'),
    ]

    operations = [
        migrations.AddField(
            model_name='player',
            name='sso_secret_encrypted',
            field=models.CharField(blank=True, default='', help_text="Per-device shared secret for signing SSO login tokens (see players/sso.py). Stored encrypted; pushed to the device's anthias.conf via SSH, never transmitted as part of a login request itself.", max_length=500),
        ),
    ]
