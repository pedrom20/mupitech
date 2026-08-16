import re
from unittest import mock

import pyotp
from django.contrib.auth.models import Group, User
from django.test import TestCase
from rest_framework.test import APIClient


def _make_superadmin(username):
    user = User.objects.create_user(username=username, password='pw123456')
    user.is_superuser = True
    user.is_staff = True
    user.save(update_fields=['is_superuser', 'is_staff'])
    return user


class LastSuperadminDemotionTests(TestCase):
    def setUp(self):
        Group.objects.get_or_create(name='admin')
        Group.objects.get_or_create(name='editor')
        Group.objects.get_or_create(name='viewer')
        Group.objects.get_or_create(name='superadmin')
        self.client = APIClient()

    def test_last_superadmin_cannot_self_demote(self):
        solo = _make_superadmin('solo')
        self.client.force_authenticate(solo)
        response = self.client.patch(f'/api/users/{solo.id}/', {'role': 'admin'}, format='json')
        self.assertEqual(response.status_code, 400)
        solo.refresh_from_db()
        self.assertTrue(solo.is_superuser)

    def test_last_superadmin_cannot_be_demoted_by_another_superadmin(self):
        # Not actually reachable with only one superadmin acting, but covers
        # the case of a second superadmin demoting the last *other* one
        # down to zero remaining — e.g. two superadmins, one demotes the
        # other, leaving exactly one, which must still be allowed.
        solo = _make_superadmin('solo')
        other = _make_superadmin('other')
        self.client.force_authenticate(other)
        response = self.client.patch(f'/api/users/{solo.id}/', {'role': 'admin'}, format='json')
        self.assertEqual(response.status_code, 200)
        solo.refresh_from_db()
        self.assertFalse(solo.is_superuser)

    def test_second_to_last_demotion_then_blocks_further(self):
        solo = _make_superadmin('solo')
        other = _make_superadmin('other')
        self.client.force_authenticate(other)
        # other demotes solo -> other is now the only superadmin left.
        first = self.client.patch(f'/api/users/{solo.id}/', {'role': 'admin'}, format='json')
        self.assertEqual(first.status_code, 200)
        # other now tries to demote themselves -> must be blocked.
        second = self.client.patch(f'/api/users/{other.id}/', {'role': 'admin'}, format='json')
        self.assertEqual(second.status_code, 400)
        other.refresh_from_db()
        self.assertTrue(other.is_superuser)

    def test_non_last_superadmin_can_self_demote(self):
        one = _make_superadmin('one')
        _make_superadmin('two')
        self.client.force_authenticate(one)
        response = self.client.patch(f'/api/users/{one.id}/', {'role': 'admin'}, format='json')
        self.assertEqual(response.status_code, 200)
        one.refresh_from_db()
        self.assertFalse(one.is_superuser)


def _enroll_totp(user):
    from mfa.models import TOTPDevice
    secret = pyotp.random_base32()
    device = TOTPDevice(user=user, confirmed=True)
    device.set_secret(secret)
    device.save()
    return secret


def _enroll_duo(user):
    from mfa.models import DuoEnrollment
    DuoEnrollment.objects.create(
        user=user, duo_user_id='DU123', duo_username=user.username, confirmed=True,
    )


def _enroll_email_otp(user):
    from mfa.models import EmailOTPDevice
    EmailOTPDevice.objects.create(user=user, confirmed=True)


def _extract_code(email_body):
    match = re.search(r'\b(\d{6})\b', email_body)
    return match.group(1) if match else ''


class DualMFALoginTests(TestCase):
    """Two challenges from two different providers required to log in —
    the policy can come from an admin-set role rule (MFAPolicy) or the
    user's own self_opt_in (access.UserAccessScope.require_dual_mfa);
    either is sufficient. See mfa/policy.py and mfa/challenge.py."""

    def setUp(self):
        Group.objects.get_or_create(name='admin')
        Group.objects.get_or_create(name='editor')
        Group.objects.get_or_create(name='viewer')
        Group.objects.get_or_create(name='superadmin')
        self.client = APIClient()
        self.user = User.objects.create_user(username='dual', password='pw123456')
        self.totp_secret = _enroll_totp(self.user)
        _enroll_duo(self.user)

    def _enable_self_opt_in(self):
        from access.models import UserAccessScope
        UserAccessScope.objects.update_or_create(user=self.user, defaults={'require_dual_mfa': True})

    @mock.patch('mfa.duo.push_auth', return_value={'result': 'allow'})
    def test_dual_required_needs_two_different_providers(self, mock_push):
        self._enable_self_opt_in()

        login_resp = self.client.post('/api/auth/login/', {'username': 'dual', 'password': 'pw123456'}, format='json')
        self.assertEqual(login_resp.status_code, 200)
        self.assertTrue(login_resp.data['mfa_required'])
        self.assertTrue(login_resp.data['dual_required'])
        self.assertEqual(login_resp.data['method'], 'duo')  # push-kind sorts first
        challenge_id = login_resp.data['challenge_id']

        # First factor (Duo push) succeeds but must NOT establish a session yet.
        first = self.client.post('/api/auth/mfa/duo-verify/', {'challenge_id': challenge_id}, format='json')
        self.assertEqual(first.status_code, 200)
        self.assertTrue(first.data.get('mfa_required'))
        self.assertEqual(first.data.get('stage'), 2)
        self.assertEqual(first.data.get('method'), 'totp')
        me = self.client.get('/api/users/me/')
        self.assertEqual(me.data.get('authenticated'), False)

        # Second factor (TOTP) with a different provider completes login.
        code = pyotp.TOTP(self.totp_secret).now()
        second = self.client.post('/api/auth/mfa/verify/', {'challenge_id': challenge_id, 'code': code}, format='json')
        self.assertEqual(second.status_code, 200)
        self.assertTrue(second.data.get('success'))
        me = self.client.get('/api/users/me/')
        self.assertEqual(me.data.get('username'), 'dual')

    @mock.patch('mfa.duo.push_auth', return_value={'result': 'allow'})
    def test_dual_required_via_role_policy_not_just_self_opt_in(self, mock_push):
        from mfa.models import MFAPolicy
        policy = MFAPolicy.get()
        policy.require_dual_roles = ['viewer']
        policy.save(update_fields=['require_dual_roles'])

        login_resp = self.client.post('/api/auth/login/', {'username': 'dual', 'password': 'pw123456'}, format='json')
        self.assertTrue(login_resp.data['dual_required'])

    def test_degrades_to_single_factor_with_only_one_enrolled_method(self):
        from mfa.models import DuoEnrollment
        DuoEnrollment.objects.filter(user=self.user).delete()
        self._enable_self_opt_in()

        login_resp = self.client.post('/api/auth/login/', {'username': 'dual', 'password': 'pw123456'}, format='json')
        self.assertFalse(login_resp.data['dual_required'])
        challenge_id = login_resp.data['challenge_id']

        code = pyotp.TOTP(self.totp_secret).now()
        verify_resp = self.client.post('/api/auth/mfa/verify/', {'challenge_id': challenge_id, 'code': code}, format='json')
        self.assertTrue(verify_resp.data.get('success'))

    def test_without_policy_or_opt_in_single_factor_suffices(self):
        login_resp = self.client.post('/api/auth/login/', {'username': 'dual', 'password': 'pw123456'}, format='json')
        self.assertFalse(login_resp.data['dual_required'])


class DualMFAPolicyEndpointTests(TestCase):
    def setUp(self):
        Group.objects.get_or_create(name='admin')
        Group.objects.get_or_create(name='editor')
        Group.objects.get_or_create(name='viewer')
        Group.objects.get_or_create(name='superadmin')
        self.client = APIClient()
        self.viewer = User.objects.create_user(username='viewer1', password='pw123456')
        Group.objects.get(name='viewer').user_set.add(self.viewer)
        self.admin = _make_superadmin('admin1')

    def test_non_admin_cannot_set_role_policy(self):
        self.client.force_authenticate(self.viewer)
        response = self.client.post('/api/mfa/dual/policy/', {'require_dual_roles': ['viewer']}, format='json')
        self.assertEqual(response.status_code, 403)

    def test_admin_can_set_role_policy(self):
        self.client.force_authenticate(self.admin)
        response = self.client.post('/api/mfa/dual/policy/', {'require_dual_roles': ['admin', 'superadmin']}, format='json')
        self.assertEqual(response.status_code, 200)
        self.assertEqual(sorted(response.data['require_dual_roles']), ['admin', 'superadmin'])

    def test_invalid_role_rejected(self):
        self.client.force_authenticate(self.admin)
        response = self.client.post('/api/mfa/dual/policy/', {'require_dual_roles': ['not-a-role']}, format='json')
        self.assertEqual(response.status_code, 400)

    def test_self_toggle_reflected_in_status(self):
        self.client.force_authenticate(self.viewer)
        toggle = self.client.post('/api/mfa/dual/self-toggle/', {'enabled': True}, format='json')
        self.assertEqual(toggle.status_code, 200)
        status_resp = self.client.get('/api/mfa/dual/status/')
        self.assertTrue(status_resp.data['self_opt_in'])
        self.assertNotIn('require_dual_roles', status_resp.data)  # non-admin doesn't get the role list

    def test_role_policy_reflected_in_status_for_admin(self):
        from mfa.models import MFAPolicy
        MFAPolicy.get()  # ensure row exists
        policy = MFAPolicy.get()
        policy.require_dual_roles = ['superadmin']
        policy.save(update_fields=['require_dual_roles'])

        self.client.force_authenticate(self.admin)
        status_resp = self.client.get('/api/mfa/dual/status/')
        self.assertTrue(status_resp.data['role_required'])
        self.assertEqual(status_resp.data['require_dual_roles'], ['superadmin'])


class OfflineAlertEmailTests(TestCase):
    """The branded HTML alert email — real subject/body/HTML generation,
    not mocked, so a template typo or a crash building the branded shell
    (e.g. a missing logo file) fails a test instead of only surfacing
    when an operator clicks 'send test' in production."""

    def setUp(self):
        from django.core.cache import cache
        from fleet_manager import alerts
        cache.set(alerts.ALERTS_SMTP_HOST_KEY, 'localhost', None)
        cache.set(alerts.ALERTS_FROM_EMAIL_KEY, 'alerts@mupitech.local', None)

    def test_offline_alert_message_has_html_alternative_in_portuguese(self):
        from django.utils import timezone
        from fleet_manager import alerts

        players = [alerts._SamplePlayer('Loja Centro', timezone.now())]
        conf = alerts.get_alert_settings()
        message = alerts._offline_alert_message(players, conf, ['admin@example.com'])

        self.assertIn('dispositivo(s) offline', message.subject)
        self.assertEqual(len(message.alternatives), 1)
        html, mimetype = message.alternatives[0]
        self.assertEqual(mimetype, 'text/html')
        self.assertIn('Loja Centro', html)
        self.assertIn('MupiTech', html)
        self.assertIn('data:image/svg+xml;base64,', html)  # logo actually embedded, not a broken/missing src

    def test_device_name_is_html_escaped_in_table(self):
        from fleet_manager import alerts

        players = [alerts._SamplePlayer('<script>alert(1)</script>', None)]
        conf = alerts.get_alert_settings()
        message = alerts._offline_alert_message(players, conf, ['admin@example.com'])
        html = message.alternatives[0][0]

        self.assertNotIn('<script>alert(1)</script>', html)
        self.assertIn('&lt;script&gt;', html)

    def test_send_test_offline_alert_email_requires_smtp_configured(self):
        from django.core.cache import cache
        from fleet_manager import alerts

        cache.delete(alerts.ALERTS_SMTP_HOST_KEY)
        with self.assertRaises(ValueError):
            alerts.send_test_offline_alert_email('admin@example.com')

    def test_send_test_offline_alert_email_builds_sample_when_none_offline(self):
        """No real device is offline in this test DB — confirms the
        sample-data fallback path (not send()'s actual SMTP call, which
        this test doesn't reach) builds without crashing."""
        from fleet_manager import alerts

        conf = alerts.get_alert_settings()
        sample_players = [
            alerts._SamplePlayer('Exemplo — Receção', None),
            alerts._SamplePlayer('Exemplo — Balcão 1', None),
        ]
        message = alerts._offline_alert_message(
            sample_players, conf, ['admin@example.com'],
            sample_notice='Nenhum dispositivo está offline neste momento.',
        )
        html = message.alternatives[0][0]
        self.assertIn('Nenhum dispositivo está offline', html)
        self.assertIn('Exemplo — Receção', html)


class DeviceLoginMFATests(TestCase):
    """A device relaying FM credentials typed into its own login page
    (fleet_manager/urls.py::auth_device_login) used to hard-block any
    MFA-enrolled account with a 409. It now issues the same kind of
    challenge auth_login does, and the *same* verify endpoints
    (auth_mfa_verify / auth_duo_verify / ...) complete it — special-
    cased via the cache entry's 'device_login' flag (mfa/challenge.py)
    to hand back a role instead of establishing an FM session, which
    is what the device relay path actually needs."""

    def setUp(self):
        Group.objects.get_or_create(name='admin')
        Group.objects.get_or_create(name='editor')
        Group.objects.get_or_create(name='viewer')
        Group.objects.get_or_create(name='superadmin')
        self.client = APIClient()

        from players.models import Player
        self.player = Player.objects.create(name='device1', url='http://10.0.0.5')
        self.player.set_sso_secret('a-test-sso-secret')
        self.player.save(update_fields=['sso_secret_encrypted'])

        self.user = User.objects.create_user(username='opuser', password='pw123456')
        self.totp_secret = _enroll_totp(self.user)

    def _proof(self):
        from django.core import signing
        from players.sso import DEVICE_AUTH_PROOF_SALT
        return signing.dumps(
            {'player_id': str(self.player.id)},
            key=self.player.get_sso_secret(),
            salt=DEVICE_AUTH_PROOF_SALT,
            compress=True,
        )

    def _device_login(self, **overrides):
        payload = {
            'player_id': str(self.player.id),
            'proof': self._proof(),
            'username': 'opuser',
            'password': 'pw123456',
        }
        payload.update(overrides)
        return self.client.post('/api/auth/device-login/', payload, format='json')

    def test_mfa_enrolled_user_gets_challenge_not_409(self):
        response = self._device_login()
        self.assertEqual(response.status_code, 200)
        self.assertTrue(response.data.get('mfa_required'))
        self.assertEqual(response.data['method'], 'totp')

    def test_verify_completes_device_login_without_fm_session(self):
        challenge = self._device_login().data
        code = pyotp.TOTP(self.totp_secret).now()
        verify = self.client.post(
            '/api/auth/mfa/verify/',
            {'challenge_id': challenge['challenge_id'], 'code': code},
            format='json',
        )
        self.assertEqual(verify.status_code, 200)
        self.assertTrue(verify.data.get('success'))
        self.assertEqual(verify.data.get('role'), 'viewer')
        # No FM session should have been established for this client —
        # a device-login challenge is the device's own auth, not the FM's.
        me = self.client.get('/api/users/me/')
        self.assertEqual(me.data.get('authenticated'), False)

    def test_wrong_code_does_not_complete_device_login(self):
        challenge = self._device_login().data
        verify = self.client.post(
            '/api/auth/mfa/verify/',
            {'challenge_id': challenge['challenge_id'], 'code': '000000'},
            format='json',
        )
        self.assertEqual(verify.status_code, 401)

    def test_no_mfa_enrolled_still_returns_plain_success(self):
        plain_user = User.objects.create_user(username='plain', password='pw123456')
        response = self._device_login(username='plain', password='pw123456')
        self.assertEqual(response.status_code, 200)
        self.assertTrue(response.data.get('success'))
        self.assertNotIn('mfa_required', response.data)


class SetupWizardTests(TestCase):
    """First-run bootstrap: a fresh DB has zero users and no code path
    creates one (no createsuperuser call anywhere in the image) — this
    is the only way in without shelling into the container. Both
    endpoints are AllowAny, safe only because they re-check "does a
    superuser already exist" on every call, not just once at startup."""

    def setUp(self):
        Group.objects.get_or_create(name='admin')
        Group.objects.get_or_create(name='editor')
        Group.objects.get_or_create(name='viewer')
        Group.objects.get_or_create(name='superadmin')
        self.client = APIClient()

    def test_required_true_on_empty_db(self):
        response = self.client.get('/api/system/setup-required/')
        self.assertEqual(response.status_code, 200)
        self.assertTrue(response.data['required'])

    def test_required_false_once_a_superadmin_exists(self):
        _make_superadmin('existing')
        response = self.client.get('/api/system/setup-required/')
        self.assertFalse(response.data['required'])

    def test_run_setup_creates_superadmin_and_logs_in(self):
        response = self.client.post('/api/system/setup/', {
            'username': 'firstadmin', 'password': 'a-real-password-123',
        }, format='json')
        self.assertEqual(response.status_code, 200)
        self.assertTrue(response.data['success'])

        user = User.objects.get(username='firstadmin')
        self.assertTrue(user.is_superuser)
        self.assertTrue(user.is_staff)

        # login() during run_setup should have left this client authenticated.
        me = self.client.get('/api/users/me/')
        self.assertEqual(me.data.get('username'), 'firstadmin')

    def test_run_setup_refuses_once_a_superadmin_already_exists(self):
        _make_superadmin('existing')
        response = self.client.post('/api/system/setup/', {
            'username': 'sneaky', 'password': 'a-real-password-123',
        }, format='json')
        self.assertEqual(response.status_code, 409)
        self.assertFalse(User.objects.filter(username='sneaky').exists())

    def test_run_setup_rejects_short_password(self):
        response = self.client.post('/api/system/setup/', {
            'username': 'firstadmin', 'password': 'short',
        }, format='json')
        self.assertEqual(response.status_code, 400)
        self.assertFalse(User.objects.filter(username='firstadmin').exists())

    def test_run_setup_rejects_duplicate_username(self):
        User.objects.create_user(username='taken', password='whatever123')
        response = self.client.post('/api/system/setup/', {
            'username': 'taken', 'password': 'a-real-password-123',
        }, format='json')
        self.assertEqual(response.status_code, 400)


class PasswordResetTests(TestCase):
    def setUp(self):
        Group.objects.get_or_create(name='admin')
        Group.objects.get_or_create(name='editor')
        Group.objects.get_or_create(name='viewer')
        Group.objects.get_or_create(name='superadmin')
        self.client = APIClient()
        from django.core.cache import cache
        cache.set('system:alerts_smtp_host', 'localhost', None)
        cache.set('system:alerts_from_email', 'alerts@mupitech.local', None)
        self.user = User.objects.create_user(
            username='forgetful', password='old-password-123', email='forgetful@example.com',
        )

    def _make_reset_link(self):
        from django.contrib.auth.tokens import default_token_generator
        from django.utils.encoding import force_bytes
        from django.utils.http import urlsafe_base64_encode
        uid = urlsafe_base64_encode(force_bytes(self.user.pk))
        token = default_token_generator.make_token(self.user)
        return uid, token

    def test_request_always_returns_success_even_for_unknown_email(self):
        response = self.client.post('/api/auth/password-reset/', {
            'email': 'nobody-here@example.com',
        }, format='json')
        self.assertEqual(response.status_code, 200)
        self.assertTrue(response.data['success'])

    def test_request_for_real_email_sends_a_message(self):
        # get_alert_connection() builds an explicit SMTP connection
        # (bypassing Django's EMAIL_BACKEND, so mail.outbox never sees
        # it — same reasoning as the OfflineAlertEmailTests above, which
        # only ever assert on the built message, never a real .send()).
        # Patch the backend's send_messages() (autospec preserves the
        # self binding, unlike patching EmailMultiAlternatives.send
        # directly) so this test doesn't need a real SMTP server, and
        # can still inspect the actual message that would have gone out.
        from django.core.mail.backends.smtp import EmailBackend
        with mock.patch.object(EmailBackend, 'send_messages', autospec=True, return_value=1) as mock_send:
            response = self.client.post('/api/auth/password-reset/', {
                'email': 'forgetful@example.com',
            }, format='json')
        self.assertEqual(response.status_code, 200)
        mock_send.assert_called_once()
        sent_messages = mock_send.call_args[0][1]
        self.assertEqual(len(sent_messages), 1)
        self.assertIn('forgetful@example.com', sent_messages[0].to)
        self.assertIn('reset-password?uid=', sent_messages[0].body)

    def test_confirm_with_valid_token_changes_password(self):
        uid, token = self._make_reset_link()
        response = self.client.post('/api/auth/password-reset-confirm/', {
            'uid': uid, 'token': token, 'new_password': 'a-brand-new-password-456',
        }, format='json')
        self.assertEqual(response.status_code, 200)
        self.user.refresh_from_db()
        self.assertTrue(self.user.check_password('a-brand-new-password-456'))

    def test_confirm_with_wrong_token_is_rejected(self):
        uid, _ = self._make_reset_link()
        response = self.client.post('/api/auth/password-reset-confirm/', {
            'uid': uid, 'token': 'not-a-real-token', 'new_password': 'a-brand-new-password-456',
        }, format='json')
        self.assertEqual(response.status_code, 400)
        self.user.refresh_from_db()
        self.assertTrue(self.user.check_password('old-password-123'))

    def test_confirm_token_is_single_use(self):
        uid, token = self._make_reset_link()
        first = self.client.post('/api/auth/password-reset-confirm/', {
            'uid': uid, 'token': token, 'new_password': 'a-brand-new-password-456',
        }, format='json')
        self.assertEqual(first.status_code, 200)
        # Changing the password rotates the hash the token generator
        # itself is keyed on, so the exact same token must fail once
        # already consumed — no separate "used" flag needed.
        second = self.client.post('/api/auth/password-reset-confirm/', {
            'uid': uid, 'token': token, 'new_password': 'yet-another-password-789',
        }, format='json')
        self.assertEqual(second.status_code, 400)

    def test_confirm_rejects_short_password(self):
        uid, token = self._make_reset_link()
        response = self.client.post('/api/auth/password-reset-confirm/', {
            'uid': uid, 'token': token, 'new_password': 'short',
        }, format='json')
        self.assertEqual(response.status_code, 400)


class EmailOTPTests(TestCase):
    """Email-delivered one-time-code MFA provider — enrollment (self
    service, mfa/views.py) and the login-time send/verify pair
    (fleet_manager/urls.py::auth_email_otp_send/verify). Same SMTP
    mocking pattern as PasswordResetTests above: get_alert_connection()
    builds an explicit connection that bypasses mail.outbox, so assert
    on the message the patched backend actually received instead."""

    def setUp(self):
        Group.objects.get_or_create(name='admin')
        Group.objects.get_or_create(name='editor')
        Group.objects.get_or_create(name='viewer')
        Group.objects.get_or_create(name='superadmin')
        self.client = APIClient()
        from django.core.cache import cache
        cache.set('system:alerts_smtp_host', 'localhost', None)
        cache.set('system:alerts_from_email', 'alerts@mupitech.local', None)
        self.user = User.objects.create_user(
            username='emailer', password='pw123456', email='emailer@example.com',
        )

    def tearDown(self):
        from django.core.cache import cache
        cache.delete('system:alerts_smtp_host')
        cache.delete('system:alerts_from_email')

    def test_status_reports_configured_and_account_email(self):
        self.client.force_authenticate(self.user)
        response = self.client.get('/api/mfa/email/status/')
        self.assertTrue(response.data['configured'])
        self.assertFalse(response.data['enabled'])
        self.assertEqual(response.data['email'], 'emailer@example.com')

    def test_enroll_and_confirm_activates_device(self):
        from django.core.mail.backends.smtp import EmailBackend
        self.client.force_authenticate(self.user)
        with mock.patch.object(EmailBackend, 'send_messages', autospec=True, return_value=1) as mock_send:
            enroll_resp = self.client.post('/api/mfa/email/enroll/', {}, format='json')
        self.assertEqual(enroll_resp.status_code, 200)
        code = _extract_code(mock_send.call_args[0][1][0].body)

        confirm_resp = self.client.post('/api/mfa/email/confirm/', {'code': code}, format='json')
        self.assertEqual(confirm_resp.status_code, 200)
        self.assertTrue(confirm_resp.data['success'])
        self.assertTrue(self.client.get('/api/mfa/email/status/').data['enabled'])

    def test_confirm_with_wrong_code_fails(self):
        from django.core.mail.backends.smtp import EmailBackend
        self.client.force_authenticate(self.user)
        with mock.patch.object(EmailBackend, 'send_messages', autospec=True, return_value=1):
            self.client.post('/api/mfa/email/enroll/', {}, format='json')
        confirm_resp = self.client.post('/api/mfa/email/confirm/', {'code': '000000'}, format='json')
        self.assertEqual(confirm_resp.status_code, 400)

    def test_enroll_fails_without_account_email(self):
        no_email_user = User.objects.create_user(username='noemail', password='pw123456')
        self.client.force_authenticate(no_email_user)
        response = self.client.post('/api/mfa/email/enroll/', {}, format='json')
        self.assertEqual(response.status_code, 400)

    def test_disable_requires_password(self):
        from mfa.models import EmailOTPDevice
        EmailOTPDevice.objects.create(user=self.user, confirmed=True)
        self.client.force_authenticate(self.user)
        wrong = self.client.post('/api/mfa/email/disable/', {'password': 'wrong'}, format='json')
        self.assertEqual(wrong.status_code, 400)
        right = self.client.post('/api/mfa/email/disable/', {'password': 'pw123456'}, format='json')
        self.assertEqual(right.status_code, 200)
        self.assertFalse(EmailOTPDevice.objects.filter(user=self.user).exists())

    def test_login_with_only_email_enrolled_offers_email_method(self):
        _enroll_email_otp(self.user)
        login_resp = self.client.post('/api/auth/login/', {'username': 'emailer', 'password': 'pw123456'}, format='json')
        self.assertTrue(login_resp.data['mfa_required'])
        self.assertEqual(login_resp.data['method'], 'email')
        self.assertEqual(login_resp.data['available_methods'], ['email'])
        self.assertEqual(login_resp.data['push_methods'], [])

    def test_send_endpoint_emails_code_and_verify_completes_login(self):
        _enroll_email_otp(self.user)
        login_resp = self.client.post('/api/auth/login/', {'username': 'emailer', 'password': 'pw123456'}, format='json')
        challenge_id = login_resp.data['challenge_id']

        from django.core.mail.backends.smtp import EmailBackend
        with mock.patch.object(EmailBackend, 'send_messages', autospec=True, return_value=1) as mock_send:
            send_resp = self.client.post('/api/auth/mfa/email-send/', {'challenge_id': challenge_id}, format='json')
        self.assertEqual(send_resp.status_code, 200)
        self.assertTrue(send_resp.data['sent'])
        code = _extract_code(mock_send.call_args[0][1][0].body)

        verify_resp = self.client.post('/api/auth/mfa/email-verify/', {'challenge_id': challenge_id, 'code': code}, format='json')
        self.assertEqual(verify_resp.status_code, 200)
        self.assertTrue(verify_resp.data['success'])
        me = self.client.get('/api/users/me/')
        self.assertEqual(me.data.get('username'), 'emailer')

    def test_verify_with_wrong_code_does_not_login(self):
        _enroll_email_otp(self.user)
        login_resp = self.client.post('/api/auth/login/', {'username': 'emailer', 'password': 'pw123456'}, format='json')
        challenge_id = login_resp.data['challenge_id']
        from django.core.mail.backends.smtp import EmailBackend
        with mock.patch.object(EmailBackend, 'send_messages', autospec=True, return_value=1):
            self.client.post('/api/auth/mfa/email-send/', {'challenge_id': challenge_id}, format='json')
        verify_resp = self.client.post('/api/auth/mfa/email-verify/', {'challenge_id': challenge_id, 'code': '000000'}, format='json')
        self.assertEqual(verify_resp.status_code, 401)
        me = self.client.get('/api/users/me/')
        self.assertEqual(me.data.get('authenticated'), False)

    def test_verify_without_prior_send_fails(self):
        _enroll_email_otp(self.user)
        login_resp = self.client.post('/api/auth/login/', {'username': 'emailer', 'password': 'pw123456'}, format='json')
        challenge_id = login_resp.data['challenge_id']
        verify_resp = self.client.post('/api/auth/mfa/email-verify/', {'challenge_id': challenge_id, 'code': '123456'}, format='json')
        self.assertEqual(verify_resp.status_code, 401)
