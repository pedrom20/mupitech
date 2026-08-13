from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ('content', '0001_initial'),
    ]

    operations = [
        migrations.AddField(
            model_name='mediafile',
            name='width',
            field=models.PositiveIntegerField(
                blank=True, null=True,
                help_text='Pixel dimensions for images/videos — extracted at upload time '
                           '(content/tasks.py), used to warn about portrait/landscape '
                           'mismatches before deploying to a device. Null for webpage '
                           'assets, SVGs and anything Pillow/ffprobe could not read.',
            ),
        ),
        migrations.AddField(
            model_name='mediafile',
            name='height',
            field=models.PositiveIntegerField(blank=True, null=True),
        ),
    ]
