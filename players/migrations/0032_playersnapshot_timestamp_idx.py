from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ('players', '0031_alter_provisiontask_total_steps'),
    ]

    operations = [
        migrations.AddIndex(
            model_name='playersnapshot',
            index=models.Index(fields=['-timestamp'], name='idx_playersnapshot_timestamp'),
        ),
    ]
