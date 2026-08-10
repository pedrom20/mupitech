from django.test import TestCase
from django.utils import timezone

from players.models import Player

from .models import PlaybackLog


class PlaybackLogDedupTests(TestCase):
    def setUp(self):
        self.player = Player.objects.create(name='P1', url='http://10.0.0.1')

    def test_unique_constraint_prevents_dupes(self):
        ts = timezone.now()
        PlaybackLog.objects.create(
            player=self.player, asset_id='a1', asset_name='Asset1',
            event='started', timestamp=ts,
        )
        # bulk_create with ignore_conflicts should not raise
        dupes = [PlaybackLog(
            player=self.player, asset_id='a1', asset_name='Asset1',
            event='started', timestamp=ts,
        )]
        PlaybackLog.objects.bulk_create(dupes, ignore_conflicts=True)
        self.assertEqual(PlaybackLog.objects.count(), 1)
