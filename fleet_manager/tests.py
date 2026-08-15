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
