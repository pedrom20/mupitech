from django.db import migrations


class Migration(migrations.Migration):
    """State-only: AuditLog now lives in the `history` app (same
    deploy_auditlog table, see history.0001_initial). No real database
    operation runs here.
    """

    dependencies = [
        ('deploy', '0015_move_cctv_to_cctv_app'),
        ('history', '0001_initial'),
    ]

    operations = [
        migrations.SeparateDatabaseAndState(
            state_operations=[
                migrations.DeleteModel(
                    name='AuditLog',
                ),
            ],
            database_operations=[],
        ),
    ]
