from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ('mfa', '0002_duoenrollment'),
    ]

    operations = [
        migrations.AlterField(
            model_name='duoenrollment',
            name='activation_code',
            field=models.CharField(blank=True, default='', max_length=255),
        ),
    ]
