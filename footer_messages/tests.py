from unittest.mock import patch

from django.contrib.auth.models import Group as AuthGroup
from django.contrib.auth.models import User
from django.test import TestCase
from rest_framework.test import APIClient

from players.models import Player

from .models import FooterMessage
from .services import compute_message_map_for_players


def _create_message(target_players=(), **kwargs):
    """FooterMessage.objects.create() can't take an M2M field directly —
    Django rejects it as an invalid constructor kwarg — so tests go
    through this helper instead of repeating create()+set() everywhere."""
    message = FooterMessage.objects.create(**kwargs)
    if target_players:
        message.target_players.set(target_players)
    return message


class FooterMessageTargetRestrictionTests(TestCase):
    """Mirrors PlaylistTargetRestrictionTests: editor_simplificado can
    edit a message's own text/order/is_active but not which devices show
    it."""

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
        self.message = FooterMessage.objects.create(title='Hello')

    def test_simplified_editor_can_edit_text(self):
        self.client.force_authenticate(self.simplified_editor)
        resp = self.client.patch(f'/api/footer-messages/{self.message.id}/', {
            'title': 'Renamed',
        }, format='json')
        self.assertEqual(resp.status_code, 200)

    def test_simplified_editor_blocked_from_targets(self):
        self.client.force_authenticate(self.simplified_editor)
        resp = self.client.patch(f'/api/footer-messages/{self.message.id}/', {
            'target_players': [str(self.player.id)],
        }, format='json')
        self.assertEqual(resp.status_code, 400)
        self.message.refresh_from_db()
        self.assertEqual(self.message.target_players.count(), 0)

    def test_plain_editor_can_edit_targets(self):
        self.client.force_authenticate(self.editor)
        resp = self.client.patch(f'/api/footer-messages/{self.message.id}/', {
            'target_players': [str(self.player.id)],
        }, format='json')
        self.assertEqual(resp.status_code, 200)

    def test_admin_can_edit_targets(self):
        self.client.force_authenticate(self.admin)
        resp = self.client.patch(f'/api/footer-messages/{self.message.id}/', {
            'target_players': [str(self.player.id)],
        }, format='json')
        self.assertEqual(resp.status_code, 200)

    def test_simplified_editor_can_create_without_targets(self):
        self.client.force_authenticate(self.simplified_editor)
        resp = self.client.post('/api/footer-messages/', {'title': 'New message'}, format='json')
        self.assertEqual(resp.status_code, 201)

    def test_simplified_editor_blocked_from_setting_targets_at_create(self):
        self.client.force_authenticate(self.simplified_editor)
        resp = self.client.post('/api/footer-messages/', {
            'title': 'New message', 'target_players': [str(self.player.id)],
        }, format='json')
        self.assertEqual(resp.status_code, 400)


class TitleVsMessageTests(TestCase):
    """`title` is admin-only (never reaches a device); `message` is what
    actually feeds the ticker — and is always flattened to one line
    even when authored across several."""

    def setUp(self):
        self.player = Player.objects.create(name='P1', url='http://10.0.0.1')

    def test_title_never_appears_in_resolved_ticker_text(self):
        _create_message(
            title='Internal label for admins',
            message='What shows on screen',
            target_players=[self.player],
        )
        result = compute_message_map_for_players([self.player.id])
        self.assertEqual(result[str(self.player.id)], ['What shows on screen'])

    def test_multiline_message_flattened_to_one_line(self):
        _create_message(
            title='Label',
            message='Line one\nLine two\n\n  Line three  ',
            target_players=[self.player],
        )
        result = compute_message_map_for_players([self.player.id])
        self.assertEqual(result[str(self.player.id)], ['Line one Line two Line three'])

    def test_blank_message_contributes_nothing(self):
        _create_message(title='Label only', message='', target_players=[self.player])
        result = compute_message_map_for_players([self.player.id])
        self.assertEqual(result[str(self.player.id)], [])


class ComputeMessageMapTests(TestCase):
    """compute_message_map_for_players resolves each player's ticker text
    in ``order``, across direct/group/location targeting, and skips
    inactive messages."""

    def setUp(self):
        self.p1 = Player.objects.create(name='P1', url='http://10.0.0.1')
        self.p2 = Player.objects.create(name='P2', url='http://10.0.0.2')

    def test_orders_by_message_order(self):
        _create_message(message='Second', order=1, target_players=[self.p1])
        _create_message(message='First', order=0, target_players=[self.p1])
        result = compute_message_map_for_players([self.p1.id])
        self.assertEqual(result[str(self.p1.id)], ['First', 'Second'])

    def test_inactive_message_excluded(self):
        _create_message(message='Hidden', is_active=False, target_players=[self.p1])
        result = compute_message_map_for_players([self.p1.id])
        self.assertEqual(result[str(self.p1.id)], [])

    def test_untargeted_player_gets_empty_list(self):
        _create_message(message='Only for P1', target_players=[self.p1])
        result = compute_message_map_for_players([self.p1.id, self.p2.id])
        self.assertEqual(result[str(self.p1.id)], ['Only for P1'])
        self.assertEqual(result[str(self.p2.id)], [])


class SyncFooterMessagesTests(TestCase):
    """The deploy task pushes footer_enabled/footer_messages via the same
    /api/v2/device_settings channel used for every other per-device
    setting (players.services.AnthiasAPIClient.update_device_settings)."""

    def setUp(self):
        self.player = Player.objects.create(name='P1', url='http://10.0.0.1')

    @patch('players.services.AnthiasAPIClient.update_device_settings')
    def test_pushes_enabled_with_joined_messages(self, mock_update):
        from .tasks import sync_footer_messages_for_players

        _create_message(message='Hello', order=0, target_players=[self.player])
        _create_message(message='World', order=1, target_players=[self.player])

        sync_footer_messages_for_players([self.player.id])

        mock_update.assert_called_once()
        payload = mock_update.call_args.args[0]
        self.assertTrue(payload['footer_enabled'])
        self.assertEqual(payload['footer_messages'], ['Hello', 'World'])

    @patch('players.services.AnthiasAPIClient.update_device_settings')
    def test_pushes_disabled_when_no_active_messages_target_player(self, mock_update):
        from .tasks import sync_footer_messages_for_players

        sync_footer_messages_for_players([self.player.id])

        payload = mock_update.call_args.args[0]
        self.assertFalse(payload['footer_enabled'])
        self.assertEqual(payload['footer_messages'], [])

    @patch('players.services.AnthiasAPIClient.update_device_settings')
    def test_removed_target_gets_footer_disabled(self, mock_update):
        """Editing a message off a player must still reach that player
        with footer_enabled=False, not just skip it — the view passes
        the union of before/after target ids for exactly this reason."""
        from .tasks import sync_footer_messages_for_players

        message = _create_message(message='Hello', target_players=[self.player])
        message.target_players.clear()

        sync_footer_messages_for_players([self.player.id])

        payload = mock_update.call_args.args[0]
        self.assertFalse(payload['footer_enabled'])

    @patch('players.services.AnthiasAPIClient.update_device_settings')
    def test_noop_with_no_player_ids(self, mock_update):
        from .tasks import sync_footer_messages_for_players

        sync_footer_messages_for_players([])
        mock_update.assert_not_called()


class ViewSetSyncTriggerTests(TestCase):
    """Create/update/delete through the API should enqueue a sync for
    every affected player — verified here via the .delay() call args
    rather than the eager task body (covered above)."""

    def setUp(self):
        for name in ('admin', 'editor', 'editor_simplificado', 'viewer', 'superadmin'):
            AuthGroup.objects.get_or_create(name=name)
        self.client = APIClient()
        self.admin = User.objects.create_user(username='admin1', password='pw123456')
        self.admin.is_superuser = True
        self.admin.save(update_fields=['is_superuser'])
        self.client.force_authenticate(self.admin)
        self.player = Player.objects.create(name='P1', url='http://10.0.0.1')

    @patch('footer_messages.views.sync_footer_messages_for_players.delay')
    def test_create_with_targets_triggers_sync(self, mock_delay):
        resp = self.client.post('/api/footer-messages/', {
            'title': 'Hi', 'target_players': [str(self.player.id)],
        }, format='json')
        self.assertEqual(resp.status_code, 201)
        mock_delay.assert_called_once_with([self.player.id])

    @patch('footer_messages.views.sync_footer_messages_for_players.delay')
    def test_create_without_targets_does_not_trigger_sync(self, mock_delay):
        resp = self.client.post('/api/footer-messages/', {'title': 'Hi'}, format='json')
        self.assertEqual(resp.status_code, 201)
        mock_delay.assert_not_called()

    @patch('footer_messages.views.sync_footer_messages_for_players.delay')
    def test_removing_target_on_update_triggers_sync_for_old_player(self, mock_delay):
        message = FooterMessage.objects.create(title='Hi')
        message.target_players.add(self.player)

        resp = self.client.patch(f'/api/footer-messages/{message.id}/', {
            'target_players': [],
        }, format='json')

        self.assertEqual(resp.status_code, 200)
        mock_delay.assert_called_once_with([self.player.id])

    @patch('footer_messages.views.sync_footer_messages_for_players.delay')
    def test_delete_triggers_sync_for_previous_targets(self, mock_delay):
        message = FooterMessage.objects.create(title='Hi')
        message.target_players.add(self.player)

        resp = self.client.delete(f'/api/footer-messages/{message.id}/')

        self.assertEqual(resp.status_code, 204)
        mock_delay.assert_called_once_with([self.player.id])


class FooterSettingsTests(TestCase):
    """Fleet-wide (not per-device) cycle-interval + logo settings — same
    IsAdmin/cache-backed pattern as fleet_manager.system_views's
    branding_settings/branding_upload_logo."""

    def setUp(self):
        AuthGroup.objects.get_or_create(name='admin')
        self.client = APIClient()
        self.admin = User.objects.create_user(username='admin1', password='pw123456')
        self.admin.is_superuser = True
        self.admin.save(update_fields=['is_superuser'])
        self.client.force_authenticate(self.admin)

    def tearDown(self):
        from django.core.cache import cache
        from .services import FOOTER_CYCLE_INTERVAL_MINUTES_KEY
        cache.delete(FOOTER_CYCLE_INTERVAL_MINUTES_KEY)

    def test_get_defaults_to_zero_interval_and_no_logo(self):
        resp = self.client.get('/api/footer-messages-settings/')
        self.assertEqual(resp.status_code, 200)
        self.assertEqual(
            resp.json(),
            {'cycle_interval_minutes': 0, 'has_logo': False, 'logo_url': None},
        )

    @patch('footer_messages.views.sync_all_footer_players.delay')
    def test_patch_sets_interval_and_triggers_sync(self, mock_delay):
        resp = self.client.patch('/api/footer-messages-settings/', {
            'cycle_interval_minutes': 5,
        }, format='json')
        self.assertEqual(resp.status_code, 200)
        self.assertEqual(resp.json()['cycle_interval_minutes'], 5)
        mock_delay.assert_called_once()

    def test_patch_rejects_negative_interval(self):
        resp = self.client.patch('/api/footer-messages-settings/', {
            'cycle_interval_minutes': -1,
        }, format='json')
        self.assertEqual(resp.status_code, 400)

    def test_non_admin_cannot_read_or_write(self):
        AuthGroup.objects.get_or_create(name='editor')
        editor = User.objects.create_user(username='editor1', password='pw123456')
        AuthGroup.objects.get(name='editor').user_set.add(editor)
        self.client.force_authenticate(editor)
        resp = self.client.get('/api/footer-messages-settings/')
        self.assertEqual(resp.status_code, 403)


class FooterLogoUploadTests(TestCase):
    def setUp(self):
        AuthGroup.objects.get_or_create(name='admin')
        self.client = APIClient()
        self.admin = User.objects.create_user(username='admin1', password='pw123456')
        self.admin.is_superuser = True
        self.admin.save(update_fields=['is_superuser'])
        self.client.force_authenticate(self.admin)

    def tearDown(self):
        import os
        from .services import footer_logo_path
        if os.path.isfile(footer_logo_path()):
            os.remove(footer_logo_path())

    def _sample_png(self):
        import io

        from PIL import Image
        from django.core.files.uploadedfile import SimpleUploadedFile

        buf = io.BytesIO()
        Image.new('RGB', (10, 10), color='blue').save(buf, format='PNG')
        return SimpleUploadedFile('logo.png', buf.getvalue(), content_type='image/png')

    @patch('footer_messages.views.sync_all_footer_players.delay')
    def test_upload_saves_file_and_triggers_sync(self, mock_delay):
        resp = self.client.post('/api/footer-messages-settings/logo/', {
            'logo': self._sample_png(),
        }, format='multipart')
        self.assertEqual(resp.status_code, 200)
        self.assertTrue(resp.json()['success'])
        mock_delay.assert_called_once()

        status_resp = self.client.get('/api/footer-messages-settings/')
        self.assertTrue(status_resp.json()['has_logo'])

    def test_upload_rejects_unsupported_extension(self):
        from django.core.files.uploadedfile import SimpleUploadedFile
        resp = self.client.post('/api/footer-messages-settings/logo/', {
            'logo': SimpleUploadedFile('logo.svg', b'<svg></svg>', content_type='image/svg+xml'),
        }, format='multipart')
        self.assertEqual(resp.status_code, 400)

    @patch('footer_messages.views.sync_all_footer_players.delay')
    def test_delete_removes_file_and_triggers_sync(self, mock_delay):
        self.client.post('/api/footer-messages-settings/logo/', {'logo': self._sample_png()}, format='multipart')
        mock_delay.reset_mock()

        resp = self.client.delete('/api/footer-messages-settings/logo/')
        self.assertEqual(resp.status_code, 204)
        mock_delay.assert_called_once()

        status_resp = self.client.get('/api/footer-messages-settings/')
        self.assertFalse(status_resp.json()['has_logo'])


class FooterLogoAbsoluteUrlTests(TestCase):
    """footer_logo_absolute_url() is what actually reaches the device —
    degrades to '' (no logo shown) rather than erroring when FM_PUBLIC_URL
    isn't configured, since that's an optional opt-in env var."""

    def tearDown(self):
        import os
        from .services import footer_logo_path
        if os.path.isfile(footer_logo_path()):
            os.remove(footer_logo_path())

    def test_empty_when_fm_public_url_not_configured(self):
        from django.test import override_settings
        from .services import footer_logo_absolute_url

        with override_settings(FM_PUBLIC_URL=''):
            self.assertEqual(footer_logo_absolute_url(), '')

    def test_builds_absolute_url_when_logo_exists_and_configured(self):
        import os
        from django.test import override_settings
        from .services import FOOTER_LOGO_DIR, FOOTER_LOGO_FILENAME, footer_logo_absolute_url, footer_logo_path

        os.makedirs(FOOTER_LOGO_DIR, exist_ok=True)
        with open(footer_logo_path(), 'wb') as f:
            f.write(b'fake-png-bytes')

        with override_settings(FM_PUBLIC_URL='https://fm.example.com'):
            url = footer_logo_absolute_url()
        self.assertEqual(url, f'https://fm.example.com/media/footer/{FOOTER_LOGO_FILENAME}')
