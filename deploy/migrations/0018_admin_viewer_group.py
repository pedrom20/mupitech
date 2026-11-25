"""Data migration to create the admin_viewer RBAC group — a read-only
variant of admin that sees everything an admin does (reports, users,
settings) but can only write to devices explicitly granted via
access/models.py::UserAccessScope.admin_players."""

from django.db import migrations


def create_group(apps, schema_editor):
    Group = apps.get_model('auth', 'Group')
    Group.objects.get_or_create(name='admin_viewer')


def remove_group(apps, schema_editor):
    Group = apps.get_model('auth', 'Group')
    Group.objects.filter(name='admin_viewer').delete()


class Migration(migrations.Migration):

    dependencies = [
        ('deploy', '0017_editor_simplificado_group'),
    ]

    operations = [
        migrations.RunPython(create_group, remove_group),
    ]
