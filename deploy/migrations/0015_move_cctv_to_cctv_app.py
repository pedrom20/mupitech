from django.db import migrations


class Migration(migrations.Migration):
    """State-only: CctvConfig/CctvCamera now live in the `cctv` app (same
    deploy_cctvconfig/deploy_cctvcamera tables, see cctv.0001_initial). No
    real database operation runs here.
    """

    dependencies = [
        ('deploy', '0014_move_media_to_content_app'),
        ('cctv', '0001_initial'),
    ]

    operations = [
        migrations.SeparateDatabaseAndState(
            state_operations=[
                migrations.DeleteModel(
                    name='CctvCamera',
                ),
                migrations.DeleteModel(
                    name='CctvConfig',
                ),
            ],
            database_operations=[],
        ),
    ]
