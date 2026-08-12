"""Local Docker registry mirror for the MupiTech player images.

Settings follow the same pattern as tailscale/alerts (system_views.py) —
Redis cache keys, no DB model — since this is one more piece of runtime-
editable infra config. Kept in its own module because players/tasks.py
(the sync Celery task) and players/provision.py (consumes the resolved
registry host during provisioning) both need it, and importing either
of those from system_views.py risks import cycles.

Only the three MupiTech-built images (server/viewer/redis) are mirrored,
per architecture (x86/pi4/pi5) — 9 images total. watchtower's own image
is a small, well-known public image and isn't worth mirroring.
"""
import logging

from django.core.cache import cache

logger = logging.getLogger(__name__)

REGISTRY_ENABLED_KEY = 'system:registry_mirror_enabled'
REGISTRY_HOST_KEY = 'system:registry_mirror_host'
REGISTRY_LAST_SYNC_KEY = 'system:registry_mirror_last_sync'
REGISTRY_SYNC_STATUS_KEY = 'system:registry_mirror_sync_status'

_DEVICE_TYPES = ('x86', 'pi4', 'pi5')
_COMPONENTS = ('server', 'viewer', 'redis')


def get_registry_settings():
    return {
        'enabled': cache.get(REGISTRY_ENABLED_KEY, False),
        'host': cache.get(REGISTRY_HOST_KEY, ''),
        'last_sync': cache.get(REGISTRY_LAST_SYNC_KEY),
    }


def get_sync_status():
    return cache.get(REGISTRY_SYNC_STATUS_KEY, {'state': 'idle', 'message': '', 'images': []})


def _set_sync_status(state, message='', images=None):
    cache.set(REGISTRY_SYNC_STATUS_KEY, {
        'state': state, 'message': message, 'images': images or [],
    }, None)


def _source_images():
    """Yield (device_type, component, source_image, tag) for every image
    this mirror covers, reading the same settings provision.py already
    uses so the two never drift apart."""
    from django.conf import settings

    for device_type in _DEVICE_TYPES:
        registry = getattr(settings, f'ANTHIAS_IMAGE_REGISTRY_{device_type.upper()}')
        tag = getattr(settings, f'ANTHIAS_IMAGE_TAG_SUFFIX_{device_type.upper()}')
        for component in _COMPONENTS:
            yield device_type, component, f'{registry}-{component}:{tag}', tag


def local_image_ref(registry_host, source_image):
    """Map a GHCR source image to its local-mirror equivalent, e.g.
    'ghcr.io/pedrom20/mupitech-player-server:latest-x86' + '192.168.1.10:5050'
    -> '192.168.1.10:5050/pedrom20/mupitech-player-server:latest-x86'."""
    repo_path = source_image.split('/', 1)[1] if source_image.startswith('ghcr.io/') else source_image
    return f'{registry_host}/{repo_path}'


def mirror_all_images():
    """Pull each source image, retag it under the local registry, push it
    there. Runs in a Celery task — see players/tasks.py:sync_local_registry.
    Best-effort per image: one failure doesn't stop the rest."""
    conf = get_registry_settings()
    if not conf['host']:
        _set_sync_status('failed', 'Registry host is not configured.')
        return

    import docker as docker_sdk
    from django.utils import timezone

    client = docker_sdk.from_env()
    images_status = []
    _set_sync_status('running', 'Starting sync...', images_status)

    for device_type, component, source_image, _tag in _source_images():
        label = f'{device_type}/{component}'
        local_image = local_image_ref(conf['host'], source_image)
        entry = {'name': label, 'source': source_image, 'target': local_image, 'status': 'pulling'}
        images_status.append(entry)
        _set_sync_status('running', f'Pulling {source_image}...', images_status)
        try:
            image = client.images.pull(source_image)
            image.tag(local_image)
            entry['status'] = 'pushing'
            _set_sync_status('running', f'Pushing {local_image}...', images_status)
            push_log = client.images.push(local_image)
            if 'errorDetail' in push_log:
                raise RuntimeError(push_log)
            entry['status'] = 'done'
        except Exception as exc:
            logger.exception('Registry mirror: failed to sync %s', source_image)
            entry['status'] = 'failed'
            entry['error'] = str(exc)
        _set_sync_status('running', f'{label} done', images_status)

    failed = [i for i in images_status if i['status'] == 'failed']
    cache.set(REGISTRY_LAST_SYNC_KEY, timezone.now().isoformat(), None)
    if failed:
        _set_sync_status('failed', f'{len(failed)} of {len(images_status)} image(s) failed.', images_status)
    else:
        _set_sync_status('success', f'All {len(images_status)} images synced.', images_status)
