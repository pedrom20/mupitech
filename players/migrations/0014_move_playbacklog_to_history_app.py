from django.db import migrations


class Migration(migrations.Migration):
    """State-only: PlaybackLog now lives in the `history` app (same
    players_playbacklog table, see history.0001_initial). No real database
    operation runs here.
    """

    dependencies = [
        ('players', '0013_move_group_to_groups_app'),
        ('history', '0001_initial'),
    ]

    operations = [
        migrations.SeparateDatabaseAndState(
            state_operations=[
                migrations.DeleteModel(
                    name='PlaybackLog',
                ),
            ],
            database_operations=[],
        ),
    ]
