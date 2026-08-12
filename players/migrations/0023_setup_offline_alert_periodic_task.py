"""Create check_offline_players periodic task for django_celery_beat."""

from django.db import migrations


def create_alert_task(apps, schema_editor):
    IntervalSchedule = apps.get_model('django_celery_beat', 'IntervalSchedule')
    PeriodicTask = apps.get_model('django_celery_beat', 'PeriodicTask')

    interval, _ = IntervalSchedule.objects.get_or_create(
        every=5,
        period='minutes',
    )
    PeriodicTask.objects.get_or_create(
        name='check-offline-player-alerts',
        defaults={
            'task': 'players.tasks.check_offline_players',
            'interval': interval,
            'enabled': True,
        },
    )


def remove_alert_task(apps, schema_editor):
    PeriodicTask = apps.get_model('django_celery_beat', 'PeriodicTask')
    PeriodicTask.objects.filter(name='check-offline-player-alerts').delete()


class Migration(migrations.Migration):

    dependencies = [
        ('players', '0022_player_last_offline_alert_at'),
        ('django_celery_beat', '0018_improve_crontab_helptext'),
    ]

    operations = [
        migrations.RunPython(create_alert_task, remove_alert_task),
    ]
