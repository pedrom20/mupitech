from django.conf import settings
from django.db import migrations, models
import django.db.models.deletion


class Migration(migrations.Migration):

    dependencies = [
        migrations.swappable_dependency(settings.AUTH_USER_MODEL),
        ('mfa', '0001_initial'),
    ]

    operations = [
        migrations.CreateModel(
            name='DuoEnrollment',
            fields=[
                ('id', models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name='ID')),
                ('duo_user_id', models.CharField(max_length=64)),
                ('duo_username', models.CharField(max_length=150)),
                ('activation_code', models.CharField(blank=True, default='', max_length=64)),
                ('confirmed', models.BooleanField(default=False)),
                ('confirmed_at', models.DateTimeField(blank=True, null=True)),
                ('created_at', models.DateTimeField(auto_now_add=True)),
                ('last_used_at', models.DateTimeField(blank=True, null=True)),
                ('user', models.OneToOneField(on_delete=django.db.models.deletion.CASCADE, related_name='duo_enrollment', to=settings.AUTH_USER_MODEL)),
            ],
        ),
    ]
