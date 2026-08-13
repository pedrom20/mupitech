from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ('content', '0002_mediafile_width_height'),
    ]

    operations = [
        migrations.AddField(
            model_name='mediafile',
            name='is_deleted',
            field=models.BooleanField(
                default=False,
                help_text='Soft-deleted — hidden from normal use, recoverable from the '
                           'recycle bin. Only a superadmin can purge it for real.',
            ),
        ),
        migrations.AddField(
            model_name='mediafile',
            name='deleted_at',
            field=models.DateTimeField(blank=True, null=True),
        ),
    ]
