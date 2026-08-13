from django.db import migrations


def strip_trailing_slashes(apps, schema_editor):
    """One-time cleanup: a Player whose url was saved with a trailing
    slash (e.g. via "Add existing device" or a manual edit, before
    Player.save() started normalizing this) silently stops matching its
    own phone-home check-ins, which always send the URL without one —
    register_player's get_or_create then treats every check-in as a
    brand new device, spawning a duplicate row each time. Skips a row if
    stripping it would collide with another player's url (the unique
    constraint) — that's a real duplicate needing a human decision on
    which row to keep, not something this migration should guess at.
    """
    Player = apps.get_model('players', 'Player')
    for player in Player.objects.filter(url__endswith='/'):
        stripped = player.url.rstrip('/')
        if not stripped or Player.objects.filter(url=stripped).exclude(pk=player.pk).exists():
            continue
        player.url = stripped
        player.save(update_fields=['url'])


def noop_reverse(apps, schema_editor):
    pass


class Migration(migrations.Migration):

    dependencies = [
        ('players', '0024_brandingimage_soft_delete'),
    ]

    operations = [
        migrations.RunPython(strip_trailing_slashes, noop_reverse),
    ]
