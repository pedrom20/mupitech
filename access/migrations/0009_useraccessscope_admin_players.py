from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ('access', '0008_useraccessscope_avatar'),
        ('players', '0033_player_exclude_from_sla'),
    ]

    operations = [
        migrations.AddField(
            model_name='useraccessscope',
            name='admin_players',
            field=models.ManyToManyField(blank=True, help_text="Devices where this user (if role 'admin_viewer') has full admin-equivalent control — independent of the visibility scope above, which admin_viewer always ignores (same as admin/superadmin, see access/scoping.py::is_restricted).", related_name='admin_granted_users', to='players.player'),
        ),
    ]
