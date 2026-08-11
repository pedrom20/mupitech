from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ('players', '0016_player_splash_logo_player_standby_image'),
    ]

    operations = [
        migrations.AlterField(
            model_name='provisiontask',
            name='total_steps',
            field=models.IntegerField(default=13),
        ),
    ]
