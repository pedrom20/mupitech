"""Data migration to create the superadmin RBAC group."""

from django.db import migrations


def create_superadmin_group(apps, schema_editor):
    Group = apps.get_model('auth', 'Group')
    Group.objects.get_or_create(name='superadmin')


def remove_superadmin_group(apps, schema_editor):
    Group = apps.get_model('auth', 'Group')
    Group.objects.filter(name='superadmin').delete()


class Migration(migrations.Migration):

    dependencies = [
        ('access', '0001_initial'),
        ('deploy', '0010_rbac_groups'),
    ]

    operations = [
        migrations.RunPython(create_superadmin_group, remove_superadmin_group),
    ]
