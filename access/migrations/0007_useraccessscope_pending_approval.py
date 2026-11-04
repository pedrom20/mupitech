from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ('access', '0006_useraccessscope_require_dual_mfa'),
    ]

    operations = [
        migrations.AddField(
            model_name='useraccessscope',
            name='pending_approval',
            field=models.BooleanField(default=False, help_text='Set when this account was auto-created by a first-time Microsoft 365 login with no matching local account (see fleet_manager/m365_backend.py ::get_or_create_user) — the user is authenticated but has no role and no access until an admin assigns one. Cleared automatically the moment any role is assigned (see fleet_manager/serializers.py::_assign_role). Never set for an account that already existed (pre-created or matched by email) — those keep the existing "groupless == viewer" default.'),
        ),
    ]
