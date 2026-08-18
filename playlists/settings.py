"""Admin-configurable restriction: whether an editor may change which
devices/groups/locations a playlist targets (Playlist.target_players/
target_groups/target_locations) — separate from editing the playlist's
own content (items) and deploying it, which editors always retain.

When enabled, an editor picks content and hits "apply"; the content
goes out to whatever devices the playlist is already configured for,
same as before. Only an admin can change *where* it goes. Off by
default — this only restricts editors once an admin opts in.

Stored the same way as the other system-wide settings (fleet_manager/
alerts.py, content/scoping.py) — a Redis cache key with no TTL, no DB
model.
"""
from django.core.cache import cache

RESTRICT_TARGETS_KEY = 'playlists:restrict_targets_to_admin'


def is_target_editing_restricted():
    return bool(cache.get(RESTRICT_TARGETS_KEY, False))


def set_target_editing_restricted(value):
    cache.set(RESTRICT_TARGETS_KEY, bool(value), None)
