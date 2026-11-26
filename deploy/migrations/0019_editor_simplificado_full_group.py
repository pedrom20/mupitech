"""Data migration to create the editor_simplificado_full RBAC group — a
variant of editor_simplificado that always sees the entire content
library (every folder, all root-level content) regardless of its own
access scope and regardless of Settings > Content Library's root-
visibility toggle (see content/scoping.py and fleet_manager/
permissions.py's module docstring)."""

from django.db import migrations


def create_group(apps, schema_editor):
    Group = apps.get_model('auth', 'Group')
    Group.objects.get_or_create(name='editor_simplificado_full')


def remove_group(apps, schema_editor):
    Group = apps.get_model('auth', 'Group')
    Group.objects.filter(name='editor_simplificado_full').delete()


class Migration(migrations.Migration):

    dependencies = [
        ('deploy', '0018_admin_viewer_group'),
    ]

    operations = [
        migrations.RunPython(create_group, remove_group),
    ]
