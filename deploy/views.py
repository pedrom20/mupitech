import logging

from rest_framework import viewsets

from fleet_manager.permissions import IsEditorOrReadOnly
from history.logging import log_action

from .models import DeployTask
from .serializers import DeployTaskSerializer
from .tasks import execute_deploy

logger = logging.getLogger(__name__)


class DeployTaskViewSet(viewsets.ModelViewSet):
    """ViewSet for managing deploy tasks."""
    queryset = DeployTask.objects.prefetch_related('target_players').all()
    serializer_class = DeployTaskSerializer
    permission_classes = [IsEditorOrReadOnly]

    def perform_create(self, serializer):
        """Save the deploy task and kick off the Celery task."""
        deploy_task = serializer.save()
        player_names = ', '.join(p.name for p in deploy_task.target_players.all())
        log_action(self.request, 'create', 'deploy', target_id=deploy_task.id, target_name=deploy_task.media_file.name if deploy_task.media_file else '', details={'players': player_names})
        execute_deploy.delay(str(deploy_task.id))
