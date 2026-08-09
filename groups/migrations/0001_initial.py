import uuid

from django.db import migrations, models


class Migration(migrations.Migration):
    """State-only: registers the Group model (moved from players) against the
    already-existing `players_group` table. No real database operation runs
    here — the table was created by players.0001_initial and is left untouched.
    """

    initial = True

    dependencies = []

    operations = [
        migrations.SeparateDatabaseAndState(
            state_operations=[
                migrations.CreateModel(
                    name='Group',
                    fields=[
                        ('id', models.UUIDField(default=uuid.uuid4, editable=False, primary_key=True, serialize=False)),
                        ('name', models.CharField(max_length=100)),
                        ('color', models.CharField(default='#8819C7', max_length=7)),
                        ('description', models.TextField(blank=True, default='')),
                        ('created_at', models.DateTimeField(auto_now_add=True)),
                    ],
                    options={
                        'db_table': 'players_group',
                        'ordering': ['name'],
                    },
                ),
            ],
            database_operations=[],
        ),
    ]
