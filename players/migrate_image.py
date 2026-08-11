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

Only x86 is supported as a migration target today; Pi4/Pi5 builds of
our own image don't exist yet (see MAINTENANCE.md in the mupitech-player
fork — multi-arch build is a separate, not-yet-done phase).
"""

from urllib.parse import urlparse

from django.conf import settings

from .provision import _home_layout, _render_compose, _shell_quote, _ssh_run

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


def discover_image_source(player, ssh_user, ssh_password, ssh_port=22, timeout=15):
    """Return (source, image) for the device's currently-running Anthias image,
    without changing anything on the device."""
    ssh, _ = _connect(player, ssh_user, ssh_password, ssh_port, timeout)
    try:
        container = _find_anthias_server_container(ssh, timeout)
        image, _, _ = _ssh_run(
            ssh, f"docker inspect -f '{{{{.Config.Image}}}}' {_shell_quote(container)}", timeout=timeout,
        )
        image = image.strip()
        return _classify_image(image), image
    except MigrationError:
        raise
    except Exception as exc:
        raise MigrationError(str(exc)) from exc
    finally:
        ssh.close()


def migrate_player_to_mupitech_image(player, ssh_user, ssh_password, ssh_port=22, timeout=30):
    """SSH into `player`'s host and move it onto the MupiTech Anthias image.

    Returns a dict describing what happened: {'action': 'updated'|'migrated',
    'previous_source': str, 'previous_image': str, 'backup_path': str|None}.
    Raises MigrationError (never touching the device) if the device type
    isn't supported yet, or the current image can't be classified safely.
    """
    if player.device_type not in _MIGRATABLE_DEVICE_TYPES:
        raise MigrationError(
            f'Migration to the MupiTech image is only supported for x86 devices right now '
            f'(this device is "{player.device_type}"). Pi4/Pi5 builds are planned but not yet available.'
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
        return {
            'action': 'migrated', 'previous_source': source, 'previous_image': image,
            'backup_path': backup_path, 'output': out[-2000:],
        }
    except MigrationError:
        raise
    except Exception as exc:
        raise MigrationError(str(exc)) from exc
    finally:
        ssh.close()
