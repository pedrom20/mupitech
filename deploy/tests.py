from unittest.mock import MagicMock, patch

from django.contrib.auth.models import User
from django.test import TestCase

from rest_framework.test import APIClient

from deploy.models import DeployTask
from players.models import Player


class DeployAPITests(TestCase):
    def setUp(self):
        self.client = APIClient()
        user = User.objects.create_user(username='testuser2', password='testpass')
        self.client.force_authenticate(user=user)

    def test_list_deploy_returns_paginated(self):
        """Deploy endpoint should be paginated."""
        resp = self.client.get('/api/deploy/')
        self.assertEqual(resp.status_code, 200)
        data = resp.json()
        self.assertIn('count', data)
        self.assertIn('results', data)


class ExecuteDeployTests(TestCase):
    def setUp(self):
        self.player = Player.objects.create(name='P1', url='http://10.0.0.1')

    @patch('players.services._session')
    def test_deploy_progress_batched(self, mock_session):
        """Progress should be saved in batches, not per-player."""
        mock_resp = MagicMock()
        mock_resp.json.return_value = {'asset_id': 'new'}
        mock_resp.raise_for_status.return_value = None
        mock_session.request.return_value = mock_resp

        task = DeployTask.objects.create(
            name='Test Deploy',
            asset_data={'name': 'test', 'uri': 'http://example.com', 'mimetype': 'webpage'},
        )
        task.target_players.add(self.player)

        from deploy.tasks import execute_deploy
        execute_deploy(str(task.id))

        task.refresh_from_db()
        self.assertEqual(task.status, 'completed')
        self.assertIn(str(self.player.id), task.progress)
        self.assertEqual(task.progress[str(self.player.id)]['status'], 'success')
