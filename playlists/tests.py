from django.contrib.auth.models import Group as AuthGroup
from django.contrib.auth.models import User
from django.test import TestCase
from rest_framework.test import APIClient

from players.models import Player

from .models import Playlist


class PlaylistTargetRestrictionTests(TestCase):
    """editor_simplificado is a restricted variant of editor: it can
    always edit a playlist's own content and deploy it, but not change
    which devices/groups/locations it targets — see
    PlaylistSerializer.validate(). A plain editor is unrestricted."""

    def setUp(self):
        for name in ('admin', 'editor', 'editor_simplificado', 'viewer', 'superadmin'):
            AuthGroup.objects.get_or_create(name=name)
        self.client = APIClient()
        self.simplified_editor = User.objects.create_user(username='simplified1', password='pw123456')
        AuthGroup.objects.get(name='editor_simplificado').user_set.add(self.simplified_editor)
        self.editor = User.objects.create_user(username='editor1', password='pw123456')
        AuthGroup.objects.get(name='editor').user_set.add(self.editor)
        self.admin = User.objects.create_user(username='admin1', password='pw123456')
        self.admin.is_superuser = True
        self.admin.save(update_fields=['is_superuser'])
        self.player = Player.objects.create(name='P1', url='http://10.0.0.1')
        self.playlist = Playlist.objects.create(name='Test playlist')

    def test_simplified_editor_can_edit_content(self):
        self.client.force_authenticate(self.simplified_editor)
        resp = self.client.patch(f'/api/playlists/{self.playlist.id}/', {
            'name': 'Renamed', 'items': [],
        }, format='json')
        self.assertEqual(resp.status_code, 200)

    def test_simplified_editor_blocked_from_targets(self):
        self.client.force_authenticate(self.simplified_editor)
        resp = self.client.patch(f'/api/playlists/{self.playlist.id}/', {
            'target_players': [str(self.player.id)],
        }, format='json')
        self.assertEqual(resp.status_code, 400)
        self.playlist.refresh_from_db()
        self.assertEqual(self.playlist.target_players.count(), 0)

    def test_plain_editor_can_edit_targets(self):
        self.client.force_authenticate(self.editor)
        resp = self.client.patch(f'/api/playlists/{self.playlist.id}/', {
            'target_players': [str(self.player.id)],
        }, format='json')
        self.assertEqual(resp.status_code, 200)

    def test_admin_can_edit_targets(self):
        self.client.force_authenticate(self.admin)
        resp = self.client.patch(f'/api/playlists/{self.playlist.id}/', {
            'target_players': [str(self.player.id)],
        }, format='json')
        self.assertEqual(resp.status_code, 200)

    def test_simplified_editor_can_create_playlist_without_targets(self):
        self.client.force_authenticate(self.simplified_editor)
        resp = self.client.post('/api/playlists/', {
            'name': 'New playlist', 'items': [],
        }, format='json')
        self.assertEqual(resp.status_code, 201)

    def test_simplified_editor_blocked_from_setting_targets_at_create(self):
        self.client.force_authenticate(self.simplified_editor)
        resp = self.client.post('/api/playlists/', {
            'name': 'New playlist', 'items': [], 'target_players': [str(self.player.id)],
        }, format='json')
        self.assertEqual(resp.status_code, 400)

    def test_simplified_editor_can_deploy(self):
        self.playlist.target_players.add(self.player)
        self.client.force_authenticate(self.simplified_editor)
        resp = self.client.post(f'/api/playlists/{self.playlist.id}/deploy/')
        self.assertEqual(resp.status_code, 200)
