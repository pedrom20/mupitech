"""Data migration to create the editor_simplificado RBAC group — a
restricted variant of editor that can't change which devices/groups/
locations a playlist targets (see playlists/serializers.py)."""

from django.db import migrations


def create_group(apps, schema_editor):
    Group = apps.get_model('auth', 'Group')
    Group.objects.get_or_create(name='editor_simplificado')


def remove_group(apps, schema_editor):
    Group = apps.get_model('auth', 'Group')
    Group.objects.filter(name='editor_simplificado').delete()


class Migration(migrations.Migration):

    dependencies = [
        ('deploy', '0016_move_auditlog_to_history_app'),
    ]

    operations = [
        migrations.RunPython(create_group, remove_group),
    ]
