from unittest.mock import MagicMock, patch

from django.contrib.auth.models import User
from django.test import TestCase, override_settings
from rest_framework.test import APIClient

from .models import PendingPairing, Player, PlayerSnapshot
from .services import AnthiasAPIClient, PlayerConnectionError


def _make_admin(username):
    user = User.objects.create_user(username=username, password='pw123456')
    user.is_superuser = True
    user.is_staff = True
    user.save(update_fields=['is_superuser', 'is_staff'])
    return user


class PlayerModelTests(TestCase):
    def test_url_unique_constraint(self):
        Player.objects.create(name='P1', url='http://10.0.0.1')
        with self.assertRaises(Exception):
            Player.objects.create(name='P2', url='http://10.0.0.1')

    def test_password_encryption_roundtrip(self):
        p = Player(name='Test', url='http://10.0.0.1')
        p.set_password('secret123')
        p.save()
        self.assertNotEqual(p.password, 'secret123')
        self.assertEqual(p.get_password(), 'secret123')

    def test_empty_password(self):
        p = Player(name='Test', url='http://10.0.0.1')
        p.set_password('')
        self.assertEqual(p.password, '')
        self.assertEqual(p.get_password(), '')

    def test_get_api_url_strips_trailing_slash(self):
        p = Player(name='Test', url='http://10.0.0.1/')
        self.assertEqual(p.get_api_url(), 'http://10.0.0.1')


class PlayerAPITests(TestCase):
    def setUp(self):
        self.client = APIClient()
        user = User.objects.create_user(username='testuser', password='testpass')
        self.client.force_authenticate(user=user)

    def test_list_players_returns_array(self):
        """Players endpoint should NOT be paginated (returns plain array)."""
        Player.objects.create(name='P1', url='http://10.0.0.1')
        resp = self.client.get('/api/players/')
        self.assertEqual(resp.status_code, 200)
        self.assertIsInstance(resp.json(), list)

    def test_create_player(self):
        resp = self.client.post('/api/players/', {
            'name': 'Test', 'url': 'http://10.0.0.1',
        }, format='json')
        self.assertEqual(resp.status_code, 201)
        self.assertEqual(Player.objects.count(), 1)

    def test_register_player_creates(self):
        resp = self.client.post('/api/players/register/', {
            'url': 'http://10.0.0.1', 'name': 'Auto',
        }, format='json')
        self.assertEqual(resp.status_code, 201)
        self.assertEqual(resp.json()['status'], 'created')

    def test_register_player_updates_existing(self):
        Player.objects.create(name='Existing', url='http://10.0.0.1')
        resp = self.client.post('/api/players/register/', {
            'url': 'http://10.0.0.1', 'name': 'Unknown', 'info': {'ver': '1'},
        }, format='json')
        self.assertEqual(resp.status_code, 200)
        self.assertEqual(resp.json()['status'], 'updated')
        # Name should NOT be overwritten by heartbeat
        p = Player.objects.get(url='http://10.0.0.1')
        self.assertEqual(p.name, 'Existing')

    def test_register_player_missing_url(self):
        resp = self.client.post('/api/players/register/', {
            'name': 'No URL',
        }, format='json')
        self.assertEqual(resp.status_code, 400)

    def test_groups_list_returns_array(self):
        """Groups endpoint should NOT be paginated."""
        resp = self.client.get('/api/groups/')
        self.assertEqual(resp.status_code, 200)
        self.assertIsInstance(resp.json(), list)


class AnthiasAPIClientTests(TestCase):
    def setUp(self):
        self.player = Player.objects.create(
            name='Test', url='http://10.0.0.1',
        )
        self.api = AnthiasAPIClient(self.player)

    @patch('players.services._session')
    def test_get_info_success(self, mock_session):
        mock_resp = MagicMock()
        mock_resp.json.return_value = {'up_time': '1:00'}
        mock_resp.raise_for_status.return_value = None
        mock_session.request.return_value = mock_resp

        result = self.api.get_info()
        self.assertEqual(result, {'up_time': '1:00'})
        mock_session.request.assert_called_once()

    @patch('players.services._session')
    def test_connection_error_raises_custom(self, mock_session):
        from requests.exceptions import ConnectionError
        mock_session.request.side_effect = ConnectionError('refused')
        with self.assertRaises(PlayerConnectionError):
            self.api.get_info()

    @patch('players.services._session')
    def test_timeout_raises_custom(self, mock_session):
        from requests.exceptions import Timeout
        mock_session.request.side_effect = Timeout('timed out')
        with self.assertRaises(PlayerConnectionError):
            self.api.get_info()

    def test_auth_set_when_username_present(self):
        self.player.username = 'admin'
        self.player.set_password('pass')
        self.player.save()
        api = AnthiasAPIClient(self.player)
        self.assertIsNotNone(api.auth)
        self.assertEqual(api.auth[0], 'admin')


class PollPlayerTaskTests(TestCase):
    def setUp(self):
        self.player = Player.objects.create(
            name='P1', url='http://10.0.0.1',
        )

    @patch('players.services._session')
    def test_poll_marks_online(self, mock_session):
        mock_resp = MagicMock()
        mock_resp.json.return_value = {'up_time': '1:00', 'assets_count': 2}
        mock_resp.raise_for_status.return_value = None
        mock_session.request.return_value = mock_resp

        from .tasks import poll_player
        poll_player(str(self.player.id))

        self.player.refresh_from_db()
        self.assertTrue(self.player.is_online)
        self.assertIsNotNone(self.player.last_seen)
        self.assertEqual(PlayerSnapshot.objects.count(), 1)

    @patch('players.services._session')
    def test_poll_marks_offline_on_connection_error(self, mock_session):
        from requests.exceptions import ConnectionError
        mock_session.request.side_effect = ConnectionError('refused')

        from .tasks import poll_player
        poll_player(str(self.player.id))

        self.player.refresh_from_db()
        self.assertFalse(self.player.is_online)

    @patch('players.services._session')
    def test_playback_error_does_not_affect_online_status(self, mock_session):
        """Critical fix: playback tracking failure must not set player offline."""
        info_resp = MagicMock()
        info_resp.json.return_value = {'up_time': '1:00'}
        info_resp.raise_for_status.return_value = None

        viewlog_resp = MagicMock()
        viewlog_resp.json.side_effect = Exception('viewlog parse error')
        viewlog_resp.raise_for_status.return_value = None

        def side_effect(method, url, **kwargs):
            if 'viewlog' in url:
                return viewlog_resp
            return info_resp

        mock_session.request.side_effect = side_effect

        from .tasks import poll_player
        poll_player(str(self.player.id))

        self.player.refresh_from_db()
        self.assertTrue(self.player.is_online)  # Must stay online!


class PairingTests(TestCase):
    """Device-initiated pairing (players/pairing_views.py) — a fresh
    device with no prior credential asks to join, an admin approves it
    from the FM's own UI, and the device gets back an sso_secret to
    provision itself with, no SSH round-trip needed."""

    def setUp(self):
        self.client = APIClient()

    def _request_pairing(self, **overrides):
        payload = {'device_name': 'Sala de Reuniões', 'mac_address': 'AA:BB:CC:DD:EE:FF', 'url': 'http://10.0.0.50'}
        payload.update(overrides)
        return self.client.post('/api/pairing/request/', payload, format='json')

    def test_request_creates_pending_row_and_returns_tokens(self):
        resp = self._request_pairing()
        self.assertEqual(resp.status_code, 200)
        data = resp.json()
        self.assertIn('pairing_id', data)
        self.assertIn('pairing_code', data)
        self.assertIn('poll_token', data)
        pairing = PendingPairing.objects.get(pk=data['pairing_id'])
        self.assertEqual(pairing.status, 'pending')
        self.assertEqual(pairing.mac_address, 'aa:bb:cc:dd:ee:ff')
        self.assertEqual(pairing.device_name, 'Sala de Reuniões')

    def test_status_requires_correct_poll_token(self):
        data = self._request_pairing().json()
        wrong = self.client.get(f"/api/pairing/{data['pairing_id']}/status/?poll_token=not-the-real-token")
        self.assertEqual(wrong.status_code, 404)
        right = self.client.get(f"/api/pairing/{data['pairing_id']}/status/?poll_token={data['poll_token']}")
        self.assertEqual(right.status_code, 200)
        self.assertEqual(right.json()['status'], 'pending')

    def test_list_requires_admin(self):
        self._request_pairing()
        anon = self.client.get('/api/pairing/pending/')
        self.assertEqual(anon.status_code, 403)

        viewer = User.objects.create_user(username='viewer1', password='pw123456')
        self.client.force_authenticate(viewer)
        as_viewer = self.client.get('/api/pairing/pending/')
        self.assertEqual(as_viewer.status_code, 403)

        self.client.force_authenticate(_make_admin('admin1'))
        as_admin = self.client.get('/api/pairing/pending/')
        self.assertEqual(as_admin.status_code, 200)
        self.assertEqual(len(as_admin.json()), 1)

    def test_approve_creates_player_and_provisions_sso_secret(self):
        data = self._request_pairing().json()
        admin = _make_admin('admin1')
        self.client.force_authenticate(admin)

        approve = self.client.post(f"/api/pairing/{data['pairing_id']}/approve/")
        self.assertEqual(approve.status_code, 200)
        self.assertTrue(approve.json()['success'])

        player = Player.objects.get(mac_address='aa:bb:cc:dd:ee:ff')
        self.assertEqual(player.url, 'http://10.0.0.50')
        self.assertTrue(player.get_sso_secret())

        # The device's own poll now reports the secret it needs.
        self.client.force_authenticate(None)
        status_resp = self.client.get(f"/api/pairing/{data['pairing_id']}/status/?poll_token={data['poll_token']}")
        body = status_resp.json()
        self.assertEqual(body['status'], 'approved')
        self.assertEqual(body['fm_player_id'], str(player.id))
        self.assertEqual(body['sso_secret'], player.get_sso_secret())

    def test_approve_reuses_existing_player_by_mac(self):
        existing = Player.objects.create(name='Já existente', url='http://10.0.0.99', mac_address='aa:bb:cc:dd:ee:ff')
        data = self._request_pairing().json()
        self.client.force_authenticate(_make_admin('admin1'))

        approve = self.client.post(f"/api/pairing/{data['pairing_id']}/approve/")
        self.assertEqual(approve.status_code, 200)
        self.assertEqual(approve.json()['player_id'], str(existing.id))
        self.assertEqual(Player.objects.count(), 1)

    def test_approve_requires_url(self):
        data = self._request_pairing(url='').json()
        self.client.force_authenticate(_make_admin('admin1'))
        resp = self.client.post(f"/api/pairing/{data['pairing_id']}/approve/")
        self.assertEqual(resp.status_code, 400)

    def test_reject_marks_rejected(self):
        data = self._request_pairing().json()
        self.client.force_authenticate(_make_admin('admin1'))

        resp = self.client.post(f"/api/pairing/{data['pairing_id']}/reject/")
        self.assertEqual(resp.status_code, 200)
        pairing = PendingPairing.objects.get(pk=data['pairing_id'])
        self.assertEqual(pairing.status, 'rejected')

        # Rejected rows don't show up as pending anymore, and can't be approved.
        pending_list = self.client.get('/api/pairing/pending/')
        self.assertEqual(len(pending_list.json()), 0)
        approve_after_reject = self.client.post(f"/api/pairing/{data['pairing_id']}/approve/")
        self.assertEqual(approve_after_reject.status_code, 404)

    def test_expired_pairing_cannot_be_approved(self):
        import datetime
        from django.utils import timezone

        data = self._request_pairing().json()
        pairing = PendingPairing.objects.get(pk=data['pairing_id'])
        pairing.created_at = timezone.now() - datetime.timedelta(minutes=PendingPairing.TTL_MINUTES + 1)
        pairing.save(update_fields=['created_at'])

        self.client.force_authenticate(_make_admin('admin1'))
        resp = self.client.post(f"/api/pairing/{data['pairing_id']}/approve/")
        self.assertEqual(resp.status_code, 400)

        status_resp = self.client.get(f"/api/pairing/{data['pairing_id']}/status/?poll_token={data['poll_token']}")
        self.assertEqual(status_resp.json()['status'], 'expired')


class PlayerEditorPermissionTests(TestCase):
    """Editors manage *content* on devices, not the devices themselves —
    see PlayerViewSet.get_permissions(). An editor may assign/update/
    remove assets on a device or clone another device's content, but
    adding/editing/removing the device record, its credentials, OS
    image, power state, or branding is admin-only. These only assert on
    the permission boundary (403 vs. anything else) — a downstream
    400/502 from a mocked-away Anthias API call still proves the
    request got *past* the permission check, which is all a permission
    test needs to confirm."""

    def setUp(self):
        from django.contrib.auth.models import Group
        for name in ('admin', 'editor', 'viewer', 'superadmin'):
            Group.objects.get_or_create(name=name)
        self.client = APIClient()
        self.editor = User.objects.create_user(username='editor1', password='pw123456')
        Group.objects.get(name='editor').user_set.add(self.editor)
        self.client.force_authenticate(self.editor)
        self.player = Player.objects.create(name='P1', url='http://10.0.0.1')

    def test_editor_cannot_create_player(self):
        resp = self.client.post('/api/players/', {
            'name': 'New', 'url': 'http://10.0.0.2',
        }, format='json')
        self.assertEqual(resp.status_code, 403)

    def test_editor_cannot_update_player(self):
        resp = self.client.patch(f'/api/players/{self.player.id}/', {
            'name': 'Renamed',
        }, format='json')
        self.assertEqual(resp.status_code, 403)

    def test_editor_cannot_delete_player(self):
        resp = self.client.delete(f'/api/players/{self.player.id}/')
        self.assertEqual(resp.status_code, 403)

    def test_editor_cannot_reboot(self):
        resp = self.client.post(f'/api/players/{self.player.id}/reboot/')
        self.assertEqual(resp.status_code, 403)

    def test_editor_cannot_shutdown(self):
        resp = self.client.post(f'/api/players/{self.player.id}/shutdown/')
        self.assertEqual(resp.status_code, 403)

    def test_editor_cannot_manage_ssh_credentials(self):
        resp = self.client.post(f'/api/players/{self.player.id}/ssh-credentials/', {
            'ssh_user': 'pi', 'ssh_password': 'raspberry',
        }, format='json')
        self.assertEqual(resp.status_code, 403)

    def test_editor_cannot_push_branding_logo_or_standby(self):
        for url_path in ('push-branding', 'logo', 'standby'):
            resp = self.client.post(f'/api/players/{self.player.id}/{url_path}/')
            self.assertEqual(resp.status_code, 403, url_path)

    def test_editor_cannot_manage_image(self):
        for url_path in ('image-source', 'migrate-image', 'rebuild-image', 'restore-image'):
            resp = self.client.post(f'/api/players/{self.player.id}/{url_path}/')
            self.assertEqual(resp.status_code, 403, url_path)

    def test_editor_can_update_content_asset(self):
        """400 (missing asset_id) proves the permission check passed —
        an admin-only action would 403 before ever reaching that
        validation."""
        resp = self.client.patch(f'/api/players/{self.player.id}/asset-update/', {}, format='json')
        self.assertEqual(resp.status_code, 400)

    def test_editor_can_delete_content_asset(self):
        resp = self.client.post(f'/api/players/{self.player.id}/asset-delete/', {}, format='json')
        self.assertNotEqual(resp.status_code, 403)

    def test_editor_can_create_content_asset(self):
        resp = self.client.post(f'/api/players/{self.player.id}/asset-create/', {}, format='json')
        self.assertNotEqual(resp.status_code, 403)

    def test_editor_can_clone_content(self):
        """400 (missing source_player_id) proves the permission check
        passed."""
        resp = self.client.post(f'/api/players/{self.player.id}/clone-content/', {}, format='json')
        self.assertEqual(resp.status_code, 400)

    def test_editor_can_still_read(self):
        resp = self.client.get('/api/players/')
        self.assertEqual(resp.status_code, 200)
        resp = self.client.get(f'/api/players/{self.player.id}/')
        self.assertEqual(resp.status_code, 200)

    def test_admin_can_still_manage_devices(self):
        """Regression guard: an admin retains every ability an editor
        just lost."""
        from django.contrib.auth.models import Group
        admin = User.objects.create_user(username='admin1', password='pw123456')
        Group.objects.get(name='admin').user_set.add(admin)
        self.client.force_authenticate(admin)

        resp = self.client.post('/api/players/', {
            'name': 'New', 'url': 'http://10.0.0.2',
        }, format='json')
        self.assertEqual(resp.status_code, 201)
