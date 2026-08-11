import uuid

from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ('players', '0020_player_screen_rotation'),
    ]

    operations = [
        migrations.CreateModel(
            name='BrandingImage',
            fields=[
                ('id', models.UUIDField(default=uuid.uuid4, editable=False, primary_key=True, serialize=False)),
                ('name', models.CharField(max_length=200)),
                ('kind', models.CharField(choices=[('logo', 'Logo'), ('standby', 'Standby')], max_length=10)),
                ('file', models.FileField(upload_to='branding/library/')),
                ('created_at', models.DateTimeField(auto_now_add=True)),
            ],
            options={
                'ordering': ['-created_at'],
            },
        ),
    ]
