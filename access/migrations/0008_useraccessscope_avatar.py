from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ('access', '0007_useraccessscope_pending_approval'),
    ]

    operations = [
        migrations.AddField(
            model_name='useraccessscope',
            name='avatar',
            field=models.ImageField(blank=True, help_text="Fetched from Microsoft Graph (/me/photo) on every M365 login — see fleet_manager/m365_backend.py::_fetch_avatar. Never set for password/LDAP-only accounts (no equivalent source for those).", null=True, upload_to='avatars/'),
        ),
    ]
