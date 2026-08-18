from unittest.mock import MagicMock, patch

from django.contrib.auth.models import Group as AuthGroup
from django.contrib.auth.models import User
from django.test import TestCase
from rest_framework.test import APIClient

from groups.models import Group as DeviceGroup
from locations.models import Location
from players.models import Player

from .models import MediaFile, MediaFolder


class MediaFileModelTests(TestCase):
    def test_detect_file_type_video(self):
        from .models import detect_file_type
        self.assertEqual(detect_file_type('clip.mp4'), 'video')
        self.assertEqual(detect_file_type('clip.MOV'), 'video')

    def test_detect_file_type_image(self):
        from .models import detect_file_type
        self.assertEqual(detect_file_type('photo.jpg'), 'image')
        self.assertEqual(detect_file_type('photo.PNG'), 'image')

    def test_detect_file_type_web(self):
        from .models import detect_file_type
        self.assertEqual(detect_file_type('page.html'), 'web')

    def test_detect_file_type_other(self):
        from .models import detect_file_type
        self.assertEqual(detect_file_type('data.zip'), 'other')


class MediaAPITests(TestCase):
    def setUp(self):
        self.client = APIClient()
        user = User.objects.create_user(username='testuser', password='testpass')
        self.client.force_authenticate(user=user)

    def test_list_media_returns_paginated(self):
        """Media endpoint should be paginated (returns {count, results})."""
        resp = self.client.get('/api/media/')
        self.assertEqual(resp.status_code, 200)
        data = resp.json()
        self.assertIn('count', data)
        self.assertIn('results', data)

    def test_create_url_media_dispatches_og_task(self):
        with patch('content.views.fetch_og_image_task') as mock_task:
            resp = self.client.post('/api/media/', {
                'source_url': 'https://example.com',
                'name': 'Example',
            }, format='json')
            self.assertEqual(resp.status_code, 201)
            mock_task.delay.assert_called_once()
            mf = MediaFile.objects.get()
            self.assertEqual(mf.file_type, 'web')


class FolderFileCountTests(TestCase):
    """MediaFolderViewSet.get_queryset()'s file_count annotation must
    match what an operator actually sees in the folder — a soft-deleted
    file (recycle bin, is_deleted=True) is still FK-linked to its
    folder forever (until purged), so an unfiltered Count('files')
    over-counts by exactly the number of deleted-but-not-purged files
    sitting in that folder, and never corrects itself on delete since
    the FK never actually goes away."""

    def setUp(self):
        for name in ('admin', 'editor', 'viewer', 'superadmin'):
            AuthGroup.objects.get_or_create(name=name)
        self.client = APIClient()
        admin = User.objects.create_user(username='admin1', password='pw123456')
        admin.is_superuser = True
        admin.save(update_fields=['is_superuser'])
        self.client.force_authenticate(admin)

        self.folder = MediaFolder.objects.create(name='Folder')
        for i in range(4):
            MediaFile.objects.create(name=f'file-{i}', folder=self.folder, source_url='https://example.com')

    def _file_count(self):
        resp = self.client.get('/api/folders/')
        data = resp.json()
        results = data['results'] if isinstance(data, dict) and 'results' in data else data
        return next(f['file_count'] for f in results if f['id'] == str(self.folder.id))

    def test_soft_deleted_files_are_not_counted(self):
        self.assertEqual(self._file_count(), 4)

        deleted = self.folder.files.first()
        deleted.is_deleted = True
        deleted.save(update_fields=['is_deleted'])

        self.assertEqual(self._file_count(), 3)


class FetchOgImageTests(TestCase):
    @patch('content.tasks._is_safe_url', return_value=True)
    @patch('content.tasks.urllib.request.urlopen')
    def test_extracts_og_image(self, mock_urlopen, _mock_safe):
        html = b'<html><head><meta property="og:image" content="https://example.com/img.jpg"></head></html>'

        # HEAD response — text/html (not an image)
        head_resp = MagicMock()
        head_resp.headers = MagicMock()
        head_resp.headers.get.return_value = 'text/html; charset=utf-8'
        head_resp.__enter__ = MagicMock(return_value=head_resp)
        head_resp.__exit__ = MagicMock(return_value=False)

        # GET response — HTML with og:image
        get_resp = MagicMock()
        get_resp.read.return_value = html
        get_resp.__enter__ = MagicMock(return_value=get_resp)
        get_resp.__exit__ = MagicMock(return_value=False)

        mock_urlopen.side_effect = [head_resp, get_resp]

        from .tasks import _fetch_og_image
        result = _fetch_og_image('https://example.com')
        self.assertEqual(result, 'https://example.com/img.jpg')

    @patch('content.tasks._is_safe_url', return_value=True)
    @patch('content.tasks.urllib.request.urlopen')
    def test_returns_none_on_error(self, mock_urlopen, _mock_safe):
        mock_urlopen.side_effect = Exception('network error')

        from .tasks import _fetch_og_image
        result = _fetch_og_image('https://example.com')
        self.assertIsNone(result)


class ContentLibraryScopingTests(TestCase):
    """Editors scoped by access.models.UserAccessScope only see folders
    (and the files inside them) for their own location/group, plus
    anything marked common — see content/scoping.py. A subfolder with
    no location/group of its own inherits its parent's (MediaFolder.
    effective_location/effective_group)."""

    def setUp(self):
        from access.models import UserAccessScope

        for name in ('admin', 'editor', 'viewer', 'superadmin'):
            AuthGroup.objects.get_or_create(name=name)
        self.client = APIClient()

        self.location_a = Location.objects.create(name='Location A')
        self.location_b = Location.objects.create(name='Location B')
        self.device_group = DeviceGroup.objects.create(name='Devices Group')

        self.folder_a = MediaFolder.objects.create(name='Folder A', location=self.location_a)
        self.subfolder_a = MediaFolder.objects.create(name='Subfolder A', parent=self.folder_a)
        self.folder_b = MediaFolder.objects.create(name='Folder B', location=self.location_b)
        self.folder_group = MediaFolder.objects.create(name='Folder Group', group=self.device_group)
        self.folder_common = MediaFolder.objects.create(name='Common Folder', is_common=True)
        self.folder_unscoped = MediaFolder.objects.create(name='Unscoped Folder')

        self.editor_a = User.objects.create_user(username='editor_a', password='pw123456')
        AuthGroup.objects.get(name='editor').user_set.add(self.editor_a)
        scope_a = UserAccessScope.objects.create(user=self.editor_a)
        scope_a.locations.add(self.location_a)

        self.editor_group = User.objects.create_user(username='editor_group', password='pw123456')
        AuthGroup.objects.get(name='editor').user_set.add(self.editor_group)
        scope_g = UserAccessScope.objects.create(user=self.editor_group)
        scope_g.groups.add(self.device_group)

        self.admin = User.objects.create_user(username='admin1', password='pw123456')
        self.admin.is_superuser = True
        self.admin.save(update_fields=['is_superuser'])

    def _folder_names(self, resp):
        return {f['name'] for f in resp.json()['results']}

    def test_scoped_editor_sees_own_location_subfolder_and_common_not_others(self):
        self.client.force_authenticate(self.editor_a)
        names = self._folder_names(self.client.get('/api/folders/'))
        self.assertIn('Folder A', names)
        self.assertIn('Subfolder A', names)  # inherits parent's location
        self.assertIn('Common Folder', names)
        self.assertNotIn('Folder B', names)
        self.assertNotIn('Folder Group', names)
        self.assertNotIn('Unscoped Folder', names)

    def test_scoped_editor_by_group_sees_group_folder_only(self):
        self.client.force_authenticate(self.editor_group)
        names = self._folder_names(self.client.get('/api/folders/'))
        self.assertIn('Folder Group', names)
        self.assertNotIn('Folder A', names)

    def test_unrestricted_admin_sees_everything(self):
        self.client.force_authenticate(self.admin)
        names = self._folder_names(self.client.get('/api/folders/'))
        self.assertEqual(names, {
            'Folder A', 'Subfolder A', 'Folder B', 'Folder Group', 'Common Folder', 'Unscoped Folder',
        })

    def test_files_in_hidden_folder_are_not_visible(self):
        MediaFile.objects.create(name='In A', folder=self.folder_a, file_type='image')
        MediaFile.objects.create(name='In B', folder=self.folder_b, file_type='image')

        self.client.force_authenticate(self.editor_a)
        names = {f['name'] for f in self.client.get('/api/media/').json()['results']}
        self.assertIn('In A', names)
        self.assertNotIn('In B', names)

    def test_root_files_hidden_from_editor_by_default(self):
        MediaFile.objects.create(name='No folder', folder=None, file_type='image')

        self.client.force_authenticate(self.editor_a)
        names = {f['name'] for f in self.client.get('/api/media/').json()['results']}
        self.assertNotIn('No folder', names)

    def test_root_files_visible_to_editor_once_enabled(self):
        from .scoping import set_root_content_visible_to_editors
        set_root_content_visible_to_editors(True)
        self.addCleanup(set_root_content_visible_to_editors, False)

        MediaFile.objects.create(name='No folder', folder=None, file_type='image')
        self.client.force_authenticate(self.editor_a)
        names = {f['name'] for f in self.client.get('/api/media/').json()['results']}
        self.assertIn('No folder', names)

    def test_root_files_always_visible_to_admin(self):
        MediaFile.objects.create(name='No folder', folder=None, file_type='image')
        self.client.force_authenticate(self.admin)
        names = {f['name'] for f in self.client.get('/api/media/').json()['results']}
        self.assertIn('No folder', names)

    def test_content_library_settings_round_trip(self):
        self.client.force_authenticate(self.admin)
        resp = self.client.get('/api/content-library-settings/')
        self.assertEqual(resp.status_code, 200)
        self.assertFalse(resp.json()['root_visible_to_editors'])

        resp = self.client.patch('/api/content-library-settings/', {'root_visible_to_editors': True}, format='json')
        self.assertEqual(resp.status_code, 200)
        self.assertTrue(resp.json()['root_visible_to_editors'])

        from .scoping import set_root_content_visible_to_editors
        self.addCleanup(set_root_content_visible_to_editors, False)

    def test_content_library_settings_requires_admin(self):
        self.client.force_authenticate(self.editor_a)
        resp = self.client.get('/api/content-library-settings/')
        self.assertEqual(resp.status_code, 403)
        resp = self.client.patch('/api/content-library-settings/', {'root_visible_to_editors': True}, format='json')
        self.assertEqual(resp.status_code, 403)

    def test_set_common_requires_admin(self):
        self.client.force_authenticate(self.editor_a)
        resp = self.client.post(f'/api/folders/{self.folder_b.id}/set-common/', {'is_common': True}, format='json')
        self.assertEqual(resp.status_code, 403)

    def test_admin_can_toggle_common_and_it_becomes_visible(self):
        self.client.force_authenticate(self.admin)
        resp = self.client.post(f'/api/folders/{self.folder_b.id}/set-common/', {'is_common': True}, format='json')
        self.assertEqual(resp.status_code, 200)
        self.folder_b.refresh_from_db()
        self.assertTrue(self.folder_b.is_common)

        self.client.force_authenticate(self.editor_a)
        names = self._folder_names(self.client.get('/api/folders/'))
        self.assertIn('Folder B', names)

    def test_regular_update_cannot_set_is_common(self):
        self.client.force_authenticate(self.admin)
        self.client.patch(f'/api/folders/{self.folder_b.id}/', {'is_common': True}, format='json')
        self.folder_b.refresh_from_db()
        self.assertFalse(self.folder_b.is_common)

    def test_folder_cannot_be_its_own_parent(self):
        self.client.force_authenticate(self.admin)
        resp = self.client.patch(
            f'/api/folders/{self.folder_a.id}/', {'parent': str(self.folder_a.id)}, format='json',
        )
        self.assertEqual(resp.status_code, 400)

    def test_folder_cannot_move_into_own_subfolder(self):
        self.client.force_authenticate(self.admin)
        resp = self.client.patch(
            f'/api/folders/{self.folder_a.id}/', {'parent': str(self.subfolder_a.id)}, format='json',
        )
        self.assertEqual(resp.status_code, 400)


class ScheduledPlaylistAdHocTargetTests(TestCase):
    """A playlist schedule normally reuses the playlist's own configured
    targets (see playlists/tasks.py::deploy_playlist), but can override
    them with ad-hoc targets on the schedule itself — lets an admin
    apply a playlist somewhere different from where it's normally
    deployed without editing the playlist. Only the dispatch (what gets
    passed to deploy_playlist.delay) is asserted here — the task's own
    device-deploy logic is exercised for real in a live environment,
    not worth mocking out AnthiasAPIClient for in a unit test."""

    def setUp(self):
        from playlists.models import Playlist

        for name in ('admin', 'editor', 'editor_simplificado', 'viewer', 'superadmin'):
            AuthGroup.objects.get_or_create(name=name)
        self.client = APIClient()
        self.admin = User.objects.create_user(username='admin3', password='pw123456')
        self.admin.is_superuser = True
        self.admin.save(update_fields=['is_superuser'])
        self.simplified_editor = User.objects.create_user(username='simplified2', password='pw123456')
        AuthGroup.objects.get(name='editor_simplificado').user_set.add(self.simplified_editor)

        self.default_player = Player.objects.create(name='Default', url='http://10.0.0.1')
        self.adhoc_player = Player.objects.create(name='AdHoc', url='http://10.0.0.2')
        self.playlist = Playlist.objects.create(name='Test playlist')
        self.playlist.target_players.add(self.default_player)

        self.client.force_authenticate(self.admin)

    @patch('playlists.tasks.deploy_playlist.delay')
    def test_no_ad_hoc_targets_falls_back_to_playlist_defaults(self, mock_delay):
        resp = self.client.post('/api/schedules/', {
            'playlist': str(self.playlist.id),
        }, format='json')
        self.assertEqual(resp.status_code, 201)
        mock_delay.assert_called_once()
        args = mock_delay.call_args[0]
        self.assertEqual(args[0], str(self.playlist.id))
        self.assertIsNone(args[3])  # player_ids
        self.assertIsNone(args[4])  # schedule_id

    @patch('playlists.tasks.deploy_playlist.delay')
    def test_ad_hoc_targets_override_playlist_defaults(self, mock_delay):
        resp = self.client.post('/api/schedules/', {
            'playlist': str(self.playlist.id),
            'target_players': [str(self.adhoc_player.id)],
        }, format='json')
        self.assertEqual(resp.status_code, 201)
        mock_delay.assert_called_once()
        args = mock_delay.call_args[0]
        self.assertEqual(args[0], str(self.playlist.id))
        self.assertEqual(args[3], [str(self.adhoc_player.id)])
        self.assertIsNotNone(args[4])  # schedule_id

    @patch('playlists.tasks.deploy_playlist.delay')
    def test_simplified_editor_blocked_from_ad_hoc_targets(self, mock_delay):
        self.client.force_authenticate(self.simplified_editor)
        resp = self.client.post('/api/schedules/', {
            'playlist': str(self.playlist.id),
            'target_players': [str(self.adhoc_player.id)],
        }, format='json')
        self.assertEqual(resp.status_code, 400)
        mock_delay.assert_not_called()

    @patch('playlists.tasks.deploy_playlist.delay')
    def test_simplified_editor_can_schedule_without_ad_hoc_targets(self, mock_delay):
        self.client.force_authenticate(self.simplified_editor)
        resp = self.client.post('/api/schedules/', {
            'playlist': str(self.playlist.id),
        }, format='json')
        self.assertEqual(resp.status_code, 201)
        mock_delay.assert_called_once()
