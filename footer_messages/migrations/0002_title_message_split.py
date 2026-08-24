from django.db import migrations, models


def copy_title_into_message(apps, schema_editor):
    """The old `text` field (just renamed to `title` by this same
    migration) is what every existing device is currently showing in
    its footer ticker. `message` is the new field that actually feeds
    the ticker going forward — seeding it with the same content keeps
    every device's footer showing exactly what it showed before this
    deploy, instead of going blank until an admin edits each message."""
    FooterMessage = apps.get_model('footer_messages', 'FooterMessage')
    for message in FooterMessage.objects.all():
        message.message = message.title
        message.save(update_fields=['message'])


def noop_reverse(apps, schema_editor):
    pass


class Migration(migrations.Migration):

    dependencies = [
        ('footer_messages', '0001_initial'),
    ]

    operations = [
        migrations.RenameField(
            model_name='footermessage',
            old_name='text',
            new_name='title',
        ),
        migrations.AddField(
            model_name='footermessage',
            name='message',
            field=models.TextField(max_length=1000, blank=True, default=''),
        ),
        migrations.RunPython(copy_title_into_message, noop_reverse),
    ]
