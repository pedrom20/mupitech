from unittest.mock import patch

from django.contrib.auth.models import Group as AuthGroup
from django.contrib.auth.models import User
from django.test import TestCase
from rest_framework.test import APIClient

from players.models import Player

from .models import Playlist, PlaylistItem


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


class RemoveFromDevicesTests(TestCase):
    """The reverse of "Apply to": untargets the given players and cleans
    up whatever the playlist had deployed there — see
    PlaylistViewSet.remove_from_devices."""

    def setUp(self):
        for name in ('admin', 'editor', 'editor_simplificado', 'viewer', 'superadmin'):
            AuthGroup.objects.get_or_create(name=name)
        self.client = APIClient()
        self.admin = User.objects.create_user(username='admin4', password='pw123456')
        self.admin.is_superuser = True
        self.admin.save(update_fields=['is_superuser'])
        self.simplified_editor = User.objects.create_user(username='simplified3', password='pw123456')
        AuthGroup.objects.get(name='editor_simplificado').user_set.add(self.simplified_editor)

        self.player = Player.objects.create(name='P1', url='http://10.0.0.1')
        self.other_player = Player.objects.create(name='P2', url='http://10.0.0.2')
        self.playlist = Playlist.objects.create(
            name='Test playlist',
            deployed_assets={str(self.player.id): ['asset-1', 'asset-2'], str(self.other_player.id): ['asset-3']},
        )
        self.playlist.target_players.add(self.player, self.other_player)

    @patch('players.services.AnthiasAPIClient.delete_asset')
    def test_admin_removes_player_and_cleans_up_assets(self, mock_delete):
        self.client.force_authenticate(self.admin)
        resp = self.client.post(f'/api/playlists/{self.playlist.id}/remove-from-devices/', {
            'player_ids': [str(self.player.id)],
        }, format='json')
        self.assertEqual(resp.status_code, 200)
        self.assertEqual(mock_delete.call_count, 2)

        self.playlist.refresh_from_db()
        self.assertNotIn(self.player, self.playlist.target_players.all())
        self.assertIn(self.other_player, self.playlist.target_players.all())
        self.assertNotIn(str(self.player.id), self.playlist.deployed_assets)
        self.assertIn(str(self.other_player.id), self.playlist.deployed_assets)

    def test_requires_at_least_one_target(self):
        self.client.force_authenticate(self.admin)
        resp = self.client.post(f'/api/playlists/{self.playlist.id}/remove-from-devices/', {}, format='json')
        self.assertEqual(resp.status_code, 400)

    def test_simplified_editor_blocked(self):
        self.client.force_authenticate(self.simplified_editor)
        resp = self.client.post(f'/api/playlists/{self.playlist.id}/remove-from-devices/', {
            'player_ids': [str(self.player.id)],
        }, format='json')
        self.assertEqual(resp.status_code, 403)
        self.playlist.refresh_from_db()
        self.assertIn(self.player, self.playlist.target_players.all())


class DeployPlaylistOrderTests(TestCase):
    """Device playback order is driven strictly by Asset.play_order
    (anthias_viewer/scheduling.py::generate_asset_list, mupitech-player) —
    every asset used to land with the model default of 0 regardless of
    the playlist's own item order, since deploy_media_file_to_player()
    never sent one. deploy_playlist must now pass each item's position
    explicitly."""

    def setUp(self):
        from content.models import MediaFile

        self.player = Player.objects.create(name='P1', url='http://10.0.0.1')
        self.playlist = Playlist.objects.create(name='Test playlist')
        self.playlist.target_players.add(self.player)
        self.files = [
            MediaFile.objects.create(name=f'File {i}', source_url=f'https://example.com/{i}', file_type='webpage')
            for i in range(3)
        ]
        # Deliberately out-of-order creation vs. intended playback order,
        # to prove play_order (not row/creation order) drives the assertion.
        PlaylistItem.objects.create(playlist=self.playlist, media_file=self.files[2], order=0)
        PlaylistItem.objects.create(playlist=self.playlist, media_file=self.files[0], order=1)
        PlaylistItem.objects.create(playlist=self.playlist, media_file=self.files[1], order=2)

    @patch('players.services.AnthiasAPIClient.create_asset')
    def test_play_order_matches_item_order(self, mock_create):
        from .tasks import deploy_playlist

        mock_create.return_value = {'asset_id': 'a'}
        deploy_playlist(str(self.playlist.id))

        sent_play_orders = [call.args[0]['play_order'] for call in mock_create.call_args_list]
        self.assertEqual(sent_play_orders, [0, 1, 2])
        sent_names = [call.args[0]['name'] for call in mock_create.call_args_list]
        self.assertEqual(sent_names, ['File 2', 'File 0', 'File 1'])
