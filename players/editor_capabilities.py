"""Admin-configurable granular permissions for the editor role on
PlayerViewSet device-management actions.

Editors always get content management (asset assign/update/remove, clone
content, playback control — see PlayerViewSet._CONTENT_ACTIONS). Everything
about the device itself (its record, credentials, OS image, power, branding)
defaults to admin-only, but an admin can opt individual capability groups
back in for editors here — one toggle per group rather than per raw DRF
action, since the actions within a group are always used together from the
UI's point of view.

Stored the same way as the other system-wide settings (fleet_manager/
alerts.py, system_views.py's tailscale/alert settings) — Redis cache keys
with no TTL, no DB model — for consistency with that existing convention.
"""
from django.core.cache import cache

CAPABILITY_KEY_PREFIX = 'system:editor_capability:'

# capability -> the PlayerViewSet action names it unlocks for editors
CAPABILITY_ACTIONS = {
    'manage_devices': ('create', 'update', 'partial_update', 'destroy'),
    'device_settings': ('test_connection', 'device_settings'),
    'power_control': ('reboot', 'shutdown'),
    'screenshot': ('screenshot_sidecar',),
    'branding': ('push_branding', 'logo', 'standby'),
    'image_management': ('image_source', 'migrate_image', 'rebuild_image', 'restore_image', 'backup'),
    'credentials': ('ssh_credentials', 'reveal_credentials'),
    'sso': ('sso_login', 'push_sso_secret'),
}

ACTION_TO_CAPABILITY = {
    action: capability
    for capability, actions in CAPABILITY_ACTIONS.items()
    for action in actions
}


def get_editor_capabilities():
    """Current enabled/disabled state for every capability group, each
    defaulting to disabled — matches the "editor manages content only"
    baseline until an admin opts a group back in."""
    return {
        capability: bool(cache.get(f'{CAPABILITY_KEY_PREFIX}{capability}', False))
        for capability in CAPABILITY_ACTIONS
    }


def set_editor_capabilities(updates):
    """updates: dict of capability -> bool. Unknown keys are ignored."""
    for capability, enabled in updates.items():
        if capability in CAPABILITY_ACTIONS:
            cache.set(f'{CAPABILITY_KEY_PREFIX}{capability}', bool(enabled), None)


def action_allowed_for_editor(action):
    capability = ACTION_TO_CAPABILITY.get(action)
    if capability is None:
        return False
    return bool(cache.get(f'{CAPABILITY_KEY_PREFIX}{capability}', False))
