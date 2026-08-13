from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ('players', '0023_setup_offline_alert_periodic_task'),
    ]

    operations = [
        migrations.AddField(
            model_name='brandingimage',
            name='is_deleted',
            field=models.BooleanField(
                default=False,
                help_text='Soft-deleted — hidden from normal use, recoverable from the '
                           'recycle bin. Only a superadmin can purge it for real.',
            ),
        ),
        migrations.AddField(
            model_name='brandingimage',
            name='deleted_at',
            field=models.DateTimeField(blank=True, null=True),
        ),
    ]
