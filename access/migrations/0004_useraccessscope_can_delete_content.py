from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ('access', '0003_useraccessscope_receive_offline_alerts'),
    ]

    operations = [
        migrations.AddField(
            model_name='useraccessscope',
            name='can_delete_content',
            field=models.BooleanField(
                default=True,
                help_text='Whether this user (if editor/admin) may delete library content and '
                           'branding images. Superadmins are always allowed; viewers never are '
                           '(no write access at all). Lets an admin grant upload/edit rights '
                           'without also granting deletion rights.',
            ),
        ),
    ]
