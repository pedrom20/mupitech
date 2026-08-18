from django.contrib.auth.models import Group as AuthGroup
from django.contrib.auth.models import User
from django.test import TestCase
from rest_framework.test import APIClient

from players.models import Player

from .models import Playlist
from .settings import set_target_editing_restricted


class PlaylistTargetRestrictionTests(TestCase):
    """Admin-configurable restriction (Settings > Permissões do Editor):
    an editor can always edit a playlist's own content and deploy it,
    but changing which devices/groups/locations it targets can be
    opted into admin-only — see playlists/settings.py and
    PlaylistSerializer.validate()."""

    def setUp(self):
        for name in ('admin', 'editor', 'viewer', 'superadmin'):
            AuthGroup.objects.get_or_create(name=name)
        self.client = APIClient()
        self.editor = User.objects.create_user(username='editor1', password='pw123456')
        AuthGroup.objects.get(name='editor').user_set.add(self.editor)
        self.admin = User.objects.create_user(username='admin1', password='pw123456')
        self.admin.is_superuser = True
        self.admin.save(update_fields=['is_superuser'])
        self.player = Player.objects.create(name='P1', url='http://10.0.0.1')
        self.playlist = Playlist.objects.create(name='Test playlist')

    def tearDown(self):
        set_target_editing_restricted(False)

    def test_editor_can_edit_content_while_restricted(self):
        set_target_editing_restricted(True)
        self.client.force_authenticate(self.editor)
        resp = self.client.patch(f'/api/playlists/{self.playlist.id}/', {
            'name': 'Renamed', 'items': [],
        }, format='json')
        self.assertEqual(resp.status_code, 200)

    def test_editor_blocked_from_targets_while_restricted(self):
        set_target_editing_restricted(True)
        self.client.force_authenticate(self.editor)
        resp = self.client.patch(f'/api/playlists/{self.playlist.id}/', {
            'target_players': [str(self.player.id)],
        }, format='json')
        self.assertEqual(resp.status_code, 400)
        self.playlist.refresh_from_db()
        self.assertEqual(self.playlist.target_players.count(), 0)

    def test_editor_can_edit_targets_when_not_restricted(self):
        self.client.force_authenticate(self.editor)
        resp = self.client.patch(f'/api/playlists/{self.playlist.id}/', {
            'target_players': [str(self.player.id)],
        }, format='json')
        self.assertEqual(resp.status_code, 200)

    def test_admin_can_edit_targets_while_restricted(self):
        set_target_editing_restricted(True)
        self.client.force_authenticate(self.admin)
        resp = self.client.patch(f'/api/playlists/{self.playlist.id}/', {
            'target_players': [str(self.player.id)],
        }, format='json')
        self.assertEqual(resp.status_code, 200)

    def test_editor_can_create_playlist_without_targets_while_restricted(self):
        set_target_editing_restricted(True)
        self.client.force_authenticate(self.editor)
        resp = self.client.post('/api/playlists/', {
            'name': 'New playlist', 'items': [],
        }, format='json')
        self.assertEqual(resp.status_code, 201)

    def test_editor_blocked_from_setting_targets_at_create_while_restricted(self):
        set_target_editing_restricted(True)
        self.client.force_authenticate(self.editor)
        resp = self.client.post('/api/playlists/', {
            'name': 'New playlist', 'items': [], 'target_players': [str(self.player.id)],
        }, format='json')
        self.assertEqual(resp.status_code, 400)


class PlaylistSettingsEndpointTests(TestCase):
    def setUp(self):
        for name in ('admin', 'editor', 'viewer', 'superadmin'):
            AuthGroup.objects.get_or_create(name=name)
        self.client = APIClient()
        self.editor = User.objects.create_user(username='editor2', password='pw123456')
        AuthGroup.objects.get(name='editor').user_set.add(self.editor)
        self.admin = User.objects.create_user(username='admin2', password='pw123456')
        self.admin.is_superuser = True
        self.admin.save(update_fields=['is_superuser'])

    def tearDown(self):
        set_target_editing_restricted(False)

    def test_editor_can_read_setting(self):
        self.client.force_authenticate(self.editor)
        resp = self.client.get('/api/playlist-settings/')
        self.assertEqual(resp.status_code, 200)
        self.assertFalse(resp.json()['restrict_targets_to_admin'])

    def test_editor_cannot_write_setting(self):
        self.client.force_authenticate(self.editor)
        resp = self.client.patch('/api/playlist-settings/', {'restrict_targets_to_admin': True}, format='json')
        self.assertEqual(resp.status_code, 403)

    def test_admin_can_write_setting(self):
        self.client.force_authenticate(self.admin)
        resp = self.client.patch('/api/playlist-settings/', {'restrict_targets_to_admin': True}, format='json')
        self.assertEqual(resp.status_code, 200)
        self.assertTrue(resp.json()['restrict_targets_to_admin'])

    def test_anonymous_cannot_read_setting(self):
        resp = self.client.get('/api/playlist-settings/')
        self.assertEqual(resp.status_code, 401)
