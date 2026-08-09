import django.db.models.deletion
from django.db import migrations, models


class Migration(migrations.Migration):
    """State-only: the Group model now lives in the `groups` app (same
    `players_group` table, see groups.0001_initial). This migration only
    updates Player.group's target and drops Group from players' migration
    state — no real database operation runs.
    """

    dependencies = [
        ('players', '0012_player_device_type'),
        ('groups', '0001_initial'),
    ]

    operations = [
        migrations.SeparateDatabaseAndState(
            state_operations=[
                migrations.AlterField(
                    model_name='player',
                    name='group',
                    field=models.ForeignKey(
                        blank=True,
                        null=True,
                        on_delete=django.db.models.deletion.SET_NULL,
                        related_name='players',
                        to='groups.group',
                    ),
                ),
                migrations.DeleteModel(
                    name='Group',
                ),
            ],
            database_operations=[],
        ),
    ]
