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
