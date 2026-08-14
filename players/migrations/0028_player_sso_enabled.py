from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ('players', '0027_player_sso_secret_encrypted'),
    ]

    operations = [
        migrations.AddField(
            model_name='player',
            name='sso_enabled',
            field=models.BooleanField(default=True, help_text='Whether the "open local dashboard" SSO login button is allowed for this device. Off by request disables it even if a secret is already provisioned — the secret itself is left alone so re-enabling needs no new SSH push.'),
        ),
    ]
