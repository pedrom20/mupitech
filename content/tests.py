from unittest.mock import MagicMock, patch

from django.contrib.auth.models import User
from django.test import TestCase
from rest_framework.test import APIClient

from .models import MediaFile


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
