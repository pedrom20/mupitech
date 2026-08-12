from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ('access', '0002_superadmin_group'),
    ]

    operations = [
        migrations.AddField(
            model_name='useraccessscope',
            name='receive_offline_alerts',
            field=models.BooleanField(
                default=True,
                help_text='Whether this user (if admin/superadmin) receives device-offline '
                           'alert emails. Only relevant if alert emails are enabled system-wide.',
            ),
        ),
    ]
