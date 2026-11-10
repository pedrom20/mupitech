from django.contrib.auth.models import User
from django.test import TestCase
from django.utils import timezone
from rest_framework.test import APIClient

from players.models import Player, PlayerSnapshot


class SlaReportTests(TestCase):
    def setUp(self):
        self.client = APIClient()
        admin = User.objects.create_user(username='admin', password='x', is_superuser=True)
        self.client.force_authenticate(user=admin)
        self.player = Player.objects.create(name='P1', url='http://10.0.0.1')

    def _snapshot(self, is_online, when=None):
        snap = PlayerSnapshot.objects.create(player=self.player, is_online=is_online)
        if when is not None:
            PlayerSnapshot.objects.filter(pk=snap.pk).update(timestamp=when)
        return snap

    def test_uptime_percentage(self):
        self._snapshot(True)
        self._snapshot(True)
        self._snapshot(False)
        self._snapshot(False)
        resp = self.client.get('/api/reports/sla/')
        self.assertEqual(resp.status_code, 200)
        data = resp.json()
        self.assertEqual(data['fleet_uptime_pct'], 50.0)
        device = next(d for d in data['devices'] if d['player_id'] == str(self.player.id))
        self.assertEqual(device['uptime_pct'], 50.0)
        self.assertEqual(device['total_snapshots'], 4)

    def test_snapshots_outside_range_excluded(self):
        self._snapshot(True)
        old = timezone.now() - timezone.timedelta(days=60)
        self._snapshot(False, when=old)
        resp = self.client.get('/api/reports/sla/', {
            'start': timezone.localdate().isoformat(),
            'end': timezone.localdate().isoformat(),
        })
        device = next(d for d in resp.json()['devices'] if d['player_id'] == str(self.player.id))
        self.assertEqual(device['total_snapshots'], 1)
        self.assertEqual(device['uptime_pct'], 100.0)

    def test_device_with_no_snapshots_has_null_uptime(self):
        resp = self.client.get('/api/reports/sla/')
        device = next(d for d in resp.json()['devices'] if d['player_id'] == str(self.player.id))
        self.assertIsNone(device['uptime_pct'])

    def test_non_admin_forbidden(self):
        viewer = User.objects.create_user(username='viewer', password='x')
        self.client.force_authenticate(user=viewer)
        resp = self.client.get('/api/reports/sla/')
        self.assertEqual(resp.status_code, 403)
