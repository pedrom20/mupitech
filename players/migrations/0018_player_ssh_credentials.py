from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ('players', '0017_provisiontask_total_steps'),
    ]

    operations = [
        migrations.AddField(
            model_name='player',
            name='ssh_username',
            field=models.CharField(blank=True, default='', help_text='Saved SSH login for branding pushes/provisioning actions on this device.', max_length=100),
        ),
        migrations.AddField(
            model_name='player',
            name='ssh_password_encrypted',
            field=models.CharField(blank=True, default='', help_text='Stored encrypted.', max_length=500),
        ),
        migrations.AddField(
            model_name='player',
            name='ssh_port',
            field=models.IntegerField(default=22),
        ),
    ]
