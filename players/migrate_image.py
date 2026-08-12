"""Migrate an already-provisioned device onto the MupiTech Anthias image.

Three possible starting points, told apart by inspecting the image the
device's running anthias-server container was started from (not by
guessing from device_type or compose service count — our own new
x86 template and current official upstream Anthias now share the same
4-service shape, so service topology alone can't tell them apart):

  - already on our `pedrom20/mupitech-player` image: nothing to migrate,
    this is just a `docker compose pull && up` update.
  - the old third-party fork (`alex1981-tech/...`) or genuinely
    unmodified official Anthias (e.g. VM-TESTE): re-provisioned onto our
    compose template, with the previous compose file backed up first.
  - anything else: refused — needs manual inspection.

Only x86 is enabled as a migration target today. Pi4/Pi5 builds of our
own image exist and publish (Phase 5 of the custom-image plan), but
haven't been validated against real Pi4/Pi5 hardware yet — pushing this
onto a real deployed device before that validation would be risky.
Extend _MIGRATABLE_DEVICE_TYPES once that's done (see MAINTENANCE.md in
the mupitech-player fork).
"""

import logging
from urllib.parse import urlparse

from django.conf import settings

from .provision import _home_layout, _render_compose, _shell_quote, _ssh_run

logger = logging.getLogger(__name__)

IMAGE_SOURCE_MUPITECH = 'mupitech'
IMAGE_SOURCE_OFFICIAL = 'official'
IMAGE_SOURCE_FORK = 'fork'
IMAGE_SOURCE_UNKNOWN = 'unknown'

_MIGRATABLE_DEVICE_TYPES = ('x86',)


class MigrationError(Exception):
    """Raised when migrating a device to the MupiTech image fails."""


def _connect(player, ssh_user, ssh_password, ssh_port, timeout):
    import paramiko

    host = urlparse(player.url).hostname
    if not host:
        raise MigrationError(f"Could not determine host from player URL: {player.url}")

    ssh = paramiko.SSHClient()
    ssh.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    try:
        ssh.connect(host, port=ssh_port, username=ssh_user, password=ssh_password, timeout=timeout)
    except Exception as exc:
        raise MigrationError(f'SSH connection failed: {exc}') from exc
    return ssh, host


def _find_anthias_server_container(ssh, timeout):
    out, _, _ = _ssh_run(
        ssh, "docker ps --format '{{.Names}}' --filter name=anthias-server", timeout=timeout,
    )
    container = next((line for line in out.strip().splitlines() if line.strip()), '')
    if not container:
        raise MigrationError('Could not find a running anthias-server container on this device.')
    return container


def _classify_image(image):
    image_lower = image.lower()
    if 'pedrom20/mupitech-player' in image_lower:
        return IMAGE_SOURCE_MUPITECH
    if 'alex1981-tech' in image_lower or 'anthias_play' in image_lower:
        return IMAGE_SOURCE_FORK
    if 'screenly/anthias' in image_lower:
        return IMAGE_SOURCE_OFFICIAL
    return IMAGE_SOURCE_UNKNOWN


def _compose_label(ssh, container, label, timeout):
    out, _, _ = _ssh_run(
        ssh,
        f'docker inspect -f {_shell_quote("{{index .Config.Labels \"" + label + "\"}}")} '
        f'{_shell_quote(container)}',
        timeout=timeout, check=False,
    )
    value = out.strip()
    return '' if value == '<no value>' else value


def _get_compose_context(ssh, container, timeout):
    """Read the docker-compose project dir/file this container was
    actually started from, via the labels Compose itself sets — robust
    regardless of how or where the device was originally provisioned."""
    working_dir = _compose_label(ssh, container, 'com.docker.compose.project.working_dir', timeout)
    config_files = _compose_label(ssh, container, 'com.docker.compose.project.config_files', timeout)
    if not working_dir or not config_files:
        raise MigrationError(
            'Could not determine the docker-compose project directory for this device '
            '(container is not managed by docker compose, or its labels are missing).'
        )
    compose_path = config_files.split(',')[0].strip()
    return working_dir, compose_path


def _detect_and_save_device_type(player, ssh, timeout):
    """A device added via "Add existing" (plain URL, no SSH provisioning
    step) never gets its device_type probed — it stays 'unknown' forever,
    which silently hides the migrate-to-MupiTech-image option since
    that's gated on device_type == 'x86'. Piggyback on the SSH session
    this module already opens (for image-source/migrate/restore) to run
    the same probe provision.py uses for freshly-provisioned Pis, so an
    existing device's type gets filled in the first time it's checked."""
    if player.device_type not in ('unknown', ''):
        return
    try:
        out, _, _ = _ssh_run(ssh, 'uname -m', timeout=timeout, check=False)
        arch = out.strip()
        if arch == 'x86_64':
            player.device_type = 'x86'
        elif arch in ('aarch64', 'armv7l'):
            model_out, _, _ = _ssh_run(
                ssh, 'cat /proc/device-tree/model 2>/dev/null || echo ""', timeout=timeout, check=False,
            )
            model_str = model_out.strip().rstrip('\x00')
            if 'Raspberry Pi 5' in model_str or 'Compute Module 5' in model_str:
                player.device_type = 'pi5'
            elif 'Raspberry Pi 4' in model_str or 'Compute Module 4' in model_str:
                player.device_type = 'pi4'
        if player.device_type != 'unknown':
            player.save(update_fields=['device_type'])
    except Exception:
        # Best-effort — never let detection failure break the actual
        # image-source check/migration this is piggybacking on.
        pass


def _backup_exists(ssh, compose_path, timeout):
    out, _, _ = _ssh_run(
        ssh, f'[ -f {_shell_quote(compose_path + ".bak")} ] && echo yes || echo no',
        timeout=timeout, check=False,
    )
    return out.strip() == 'yes'


def discover_image_source(player, ssh_user, ssh_password, ssh_port=22, timeout=15):
    """Return (source, image, has_backup) for the device's currently-running
    Anthias image, without changing anything on the device. has_backup
    reflects whether a previous migration left a .bak compose file behind
    (i.e. whether "Restore previous" is available)."""
    ssh, _ = _connect(player, ssh_user, ssh_password, ssh_port, timeout)
    try:
        _detect_and_save_device_type(player, ssh, timeout)
        container = _find_anthias_server_container(ssh, timeout)
        image, _, _ = _ssh_run(
            ssh, f"docker inspect -f '{{{{.Config.Image}}}}' {_shell_quote(container)}", timeout=timeout,
        )
        image = image.strip()
        try:
            _, compose_path = _get_compose_context(ssh, container, timeout)
            has_backup = _backup_exists(ssh, compose_path, timeout)
        except MigrationError:
            has_backup = False
        return _classify_image(image), image, has_backup
    except MigrationError:
        raise
    except Exception as exc:
        raise MigrationError(str(exc)) from exc
    finally:
        ssh.close()


def restore_previous_compose(player, ssh_user, ssh_password, ssh_port=22, timeout=30):
    """Roll a device back to the compose file it had before its last
    migration, using the .bak backup left by migrate_player_to_mupitech_image.
    Raises MigrationError (no device changes) if there's no backup to restore.
    """
    ssh, _ = _connect(player, ssh_user, ssh_password, ssh_port, timeout)
    try:
        container = _find_anthias_server_container(ssh, timeout)
        working_dir, compose_path = _get_compose_context(ssh, container, timeout)
        backup_path = f'{compose_path}.bak'

        if not _backup_exists(ssh, compose_path, timeout):
            raise MigrationError(
                f'No backup found at {backup_path} — nothing to restore. A backup is '
                'only created the first time a device is migrated to the MupiTech image.'
            )

        # Keep a copy of what we're restoring FROM (not overwriting .bak
        # itself), in case the operator wants to go back the other way again.
        _ssh_run(
            ssh, f'cp {_shell_quote(compose_path)} {_shell_quote(compose_path + ".before-restore")}',
            timeout=timeout, check=False,
        )
        _ssh_run(ssh, f'cp {_shell_quote(backup_path)} {_shell_quote(compose_path)}', timeout=timeout)

        out, _, _ = _ssh_run(
            ssh,
            f'cd {_shell_quote(working_dir)} && docker compose pull && '
            f'docker compose up -d --remove-orphans 2>&1',
            timeout=300,
        )
        return {'backup_path': backup_path, 'output': out[-2000:]}
    except MigrationError:
        raise
    except Exception as exc:
        raise MigrationError(str(exc)) from exc
    finally:
        ssh.close()


def snapshot_assets(player):
    """Read the device's current asset list (+ raw file bytes for
    locally-uploaded ones) via its stable v2 REST API, before migrating.

    Deliberately NOT filesystem/DB-level: the old fork/official image can
    be a materially different Anthias version, and the v2 asset API is
    the one thing guaranteed compatible across all of them (migration
    eligibility already assumes it, via discover_image_source). Returns
    None (not an empty list) on failure, so callers can tell "nothing to
    restore" apart from "couldn't read the old assets at all"."""
    from .services import AnthiasAPIClient

    try:
        import requests
        client = AnthiasAPIClient(player)
        assets = client.get_assets()
    except Exception:
        logger.warning('Could not read asset list from %s before migrating.', player.name)
        return None

    snapshot = []
    for asset in assets or []:
        uri = asset.get('uri', '')
        file_bytes = None
        if uri and not uri.startswith(('http://', 'https://')):
            # Locally-hosted on the device — fetch the raw bytes now,
            # while the pre-migration server can still serve them.
            try:
                resp = requests.get(f"{player.get_api_url()}{uri}", timeout=30)
                resp.raise_for_status()
                file_bytes = resp.content
            except Exception:
                logger.warning('Could not download asset "%s" (%s) from %s.', asset.get('name'), uri, player.name)
        snapshot.append({
            'name': asset.get('name', ''),
            'mimetype': asset.get('mimetype', 'image'),
            'is_enabled': asset.get('is_enabled', True),
            'nocache': asset.get('nocache', False),
            'start_date': asset.get('start_date'),
            'end_date': asset.get('end_date'),
            'duration': asset.get('duration', 10),
            'uri': uri,
            'ext': asset.get('ext', ''),
            'file_bytes': file_bytes,
        })
    return snapshot


def wait_for_player_ready(player, timeout_seconds=90):
    """Poll the device's own API until it responds again after the compose
    swap restarts its containers, or give up after timeout_seconds."""
    import time as _time

    from .services import AnthiasAPIClient, PlayerConnectionError

    client = AnthiasAPIClient(player)
    deadline = _time.time() + timeout_seconds
    while _time.time() < deadline:
        try:
            client.get_info()
            return True
        except PlayerConnectionError:
            _time.sleep(5)
    return False


def restore_assets(player, snapshot):
    """Re-create each snapshotted asset on the device, now running the
    new image. Best-effort per asset — one failure doesn't stop the rest.
    Returns (restored_count, [names_that_failed])."""
    from io import BytesIO

    from .services import AnthiasAPIClient

    client = AnthiasAPIClient(player)
    client.timeout = max(client.timeout, 60)
    restored = 0
    failed = []
    for entry in snapshot:
        name = entry.get('name', '?')
        try:
            uri = entry['uri']
            ext = ''
            if uri and uri.startswith(('http://', 'https://')):
                asset_uri = uri
            elif entry['file_bytes'] is not None:
                file_obj = BytesIO(entry['file_bytes'])
                file_obj.name = f"restored{entry['ext'] or ''}"
                upload_result = client.upload_file(file_obj)
                asset_uri = upload_result.get('uri', '')
                ext = upload_result.get('ext', '')
            else:
                failed.append(name)
                continue

            client.create_asset({
                'name': name,
                'uri': asset_uri,
                'ext': ext,
                'mimetype': entry['mimetype'],
                'is_enabled': entry['is_enabled'],
                'nocache': entry['nocache'],
                'start_date': entry['start_date'],
                'end_date': entry['end_date'],
                'duration': entry['duration'],
                'skip_asset_check': False,
            })
            restored += 1
        except Exception:
            logger.warning('Could not restore asset "%s" on %s after migration.', name, player.name)
            failed.append(name)
    return restored, failed


def migrate_player_to_mupitech_image(player, ssh_user, ssh_password, ssh_port=22, timeout=30, preserve_content=False):
    """SSH into `player`'s host and move it onto the MupiTech Anthias image.

    When preserve_content=True, snapshots the device's current asset list
    (+ downloads locally-hosted files) via its REST API before migrating,
    then re-creates them afterwards once the device is back online — see
    snapshot_assets/restore_assets. Best-effort: a failure here doesn't
    fail the migration itself, it's reported back in the result dict
    (content_restored / content_restore_failed / content_restore_error).

    Returns a dict describing what happened: {'action': 'updated'|'migrated',
    'previous_source': str, 'previous_image': str, 'backup_path': str|None}.
    Raises MigrationError (never touching the device) if the device type
    isn't supported yet, or the current image can't be classified safely.
    """
    if player.device_type not in _MIGRATABLE_DEVICE_TYPES:
        raise MigrationError(
            f'Migration to the MupiTech image is only supported for x86 devices right now '
            f'(this device is "{player.device_type}"). Pi4/Pi5 images exist but haven\'t been '
            f'validated on real hardware yet.'
        )

    ssh, host = _connect(player, ssh_user, ssh_password, ssh_port, timeout)
    try:
        container = _find_anthias_server_container(ssh, timeout)
        image, _, _ = _ssh_run(
            ssh, f"docker inspect -f '{{{{.Config.Image}}}}' {_shell_quote(container)}", timeout=timeout,
        )
        image = image.strip()
        source = _classify_image(image)

        if source == IMAGE_SOURCE_UNKNOWN:
            raise MigrationError(
                f'Unrecognized image on this device ("{image}") — refusing to migrate '
                'automatically. This device needs manual inspection first.'
            )

        working_dir, compose_path = _get_compose_context(ssh, container, timeout)

        if source == IMAGE_SOURCE_MUPITECH:
            # Already on our image — this is just an update, not a migration.
            out, _, _ = _ssh_run(
                ssh,
                f'cd {_shell_quote(working_dir)} && docker compose pull && '
                f'docker compose up -d 2>&1',
                timeout=300,
            )
            return {
                'action': 'updated', 'previous_source': source, 'previous_image': image,
                'backup_path': None, 'output': out[-2000:],
            }

        # source is 'fork' or 'official' — treat this as re-provisioning
        # onto our own template, keeping the device's existing bind-mount
        # directories/host user (created by whatever provisioned it before).
        content_snapshot = snapshot_assets(player) if preserve_content else None

        layout = _home_layout(player.device_type)
        watchtower_token = 'anthias-player-update'
        compose_content = _render_compose(
            host, ssh_user, watchtower_token, player.mac_address or '',
            device_type=player.device_type,
        )

        backup_path = f'{compose_path}.bak'
        _ssh_run(ssh, f'cp {_shell_quote(compose_path)} {_shell_quote(backup_path)}', timeout=timeout)

        home = f'/home/{ssh_user}'
        media_player_path = f'{home}/{layout["media_player_rel"]}'
        dirs = {
            f'{home}/{layout["project_dir"]}',
            f'{home}/{layout["config_dir"]}',
            f'{home}/{layout["assets_dir"]}',
        }
        _ssh_run(ssh, f'mkdir -p {" ".join(sorted(dirs))}', timeout=timeout)
        _ssh_run(
            ssh,
            f'[ -f {_shell_quote(media_player_path)} ] || '
            f'([ -d {_shell_quote(media_player_path)} ] && rm -rf {_shell_quote(media_player_path)}; '
            f'touch {_shell_quote(media_player_path)})',
            timeout=timeout,
        )

        sftp = ssh.open_sftp()
        try:
            with sftp.file(compose_path, 'w') as f:
                f.write(compose_content)
        finally:
            sftp.close()

        out, _, _ = _ssh_run(
            ssh,
            f'cd {_shell_quote(working_dir)} && docker compose pull && '
            f'docker compose up -d --remove-orphans 2>&1',
            timeout=300,
        )
        result = {
            'action': 'migrated', 'previous_source': source, 'previous_image': image,
            'backup_path': backup_path, 'output': out[-2000:],
        }

        if preserve_content:
            # Isolated from the migration's own error handling below — the
            # compose swap already succeeded at this point, so a restore
            # failure must not be reported as the whole migration failing.
            try:
                if content_snapshot is None:
                    result['content_restore_error'] = (
                        "Could not read the device's asset list before migrating — nothing to restore."
                    )
                elif not content_snapshot:
                    result['content_restored'] = 0
                elif wait_for_player_ready(player):
                    restored, failed = restore_assets(player, content_snapshot)
                    result['content_restored'] = restored
                    if failed:
                        result['content_restore_failed'] = failed
                else:
                    result['content_restore_error'] = 'Device did not come back online in time to restore content.'
            except Exception:
                logger.exception('Content restore failed after migrating %s.', player.name)
                result['content_restore_error'] = 'Unexpected error while restoring content.'

        return result
    except MigrationError:
        raise
    except Exception as exc:
        raise MigrationError(str(exc)) from exc
    finally:
        ssh.close()
