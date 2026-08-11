from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ('players', '0018_player_ssh_credentials'),
    ]

    operations = [
        migrations.AlterField(
            model_name='player',
            name='device_type',
            field=models.CharField(
                blank=True,
                choices=[
                    ('pi4', 'Raspberry Pi 4'),
                    ('pi5', 'Raspberry Pi 5'),
                    ('x86', 'x86'),
                    ('unknown', 'Unknown'),
                ],
                default='unknown',
                help_text='Detected hardware type (pi4, pi5).',
                max_length=10,
            ),
        ),
    ]
