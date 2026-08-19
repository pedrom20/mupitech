import json
import logging
import os
import socket
import time
import uuid
from string import Template

from django.conf import settings
from django.core.cache import cache
from django.db import models
from django.utils import timezone

logger = logging.getLogger(__name__)


class ProvisionTask(models.Model):
    STATUS_CHOICES = [
        ('pending', 'Pending'),
        ('running', 'Running'),
        ('success', 'Success'),
        ('failed', 'Failed'),
    ]

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    ip_address = models.GenericIPAddressField()
    ssh_user = models.CharField(max_length=100, default='pi')
    ssh_port = models.IntegerField(default=22)
    player_name = models.CharField(max_length=200, blank=True, default='')
    status = models.CharField(max_length=20, choices=STATUS_CHOICES, default='pending')
    current_step = models.IntegerField(default=0)
    total_steps = models.IntegerField(default=14)
    steps = models.JSONField(default=list)
    error_message = models.CharField(max_length=1000, blank=True, default='')
    log_output = models.TextField(blank=True, default='')
    player = models.ForeignKey(
        'Player', null=True, blank=True, on_delete=models.SET_NULL,
        related_name='provision_tasks',
    )
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ['-created_at']

    def __str__(self):
        return f'Provision {self.ip_address} [{self.status}]'


def _update_step(task, step_num, name, status, message=''):
    """Update a step in the task's steps JSONField."""
    entry = {
        'step': step_num,
        'name': name,
        'status': status,
        'message': message,
        'timestamp': timezone.now().isoformat(),
    }
    steps = list(task.steps)
    # Replace existing step or append
    found = False
    for i, s in enumerate(steps):
        if s.get('step') == step_num:
            steps[i] = entry
            found = True
            break
    if not found:
        steps.append(entry)
    task.steps = steps
    task.current_step = step_num
    task.updated_at = timezone.now()
    task.save(update_fields=['steps', 'current_step', 'updated_at'])


def _append_log(task, text):
    """Append text to task log output."""
    task.log_output += text + '\n'
    task.save(update_fields=['log_output'])


def _ssh_run(ssh, cmd, sudo_password=None, timeout=30, check=True):
    """Execute command via SSH, return (stdout, stderr, exit_code).

    Uses channel.settimeout() to prevent indefinite blocking on
    recv_exit_status() — a known Paramiko issue with long-running commands.
    """
    if sudo_password and cmd.strip().startswith('sudo '):
        # Use stdin for sudo password
        cmd_to_run = f'echo {_shell_quote(sudo_password)} | sudo -S bash -c {_shell_quote(cmd[5:])}'
    else:
        cmd_to_run = cmd

    stdin, stdout, stderr = ssh.exec_command(cmd_to_run, timeout=timeout)
    # Set channel timeout so recv_exit_status doesn't block forever
    channel = stdout.channel
    channel.settimeout(timeout)
    try:
        exit_code = channel.recv_exit_status()
    except socket.timeout:
        # Force close the channel on timeout
        channel.close()
        raise RuntimeError(f'SSH command timed out after {timeout}s: {cmd[:100]}')

    out = stdout.read().decode('utf-8', errors='replace')
    err = stderr.read().decode('utf-8', errors='replace')

    if check and exit_code != 0:
        raise RuntimeError(f'Command failed (exit {exit_code}): {err or out}')

    return out, err, exit_code


def _shell_quote(s):
    """Simple shell quoting."""
    return "'" + s.replace("'", "'\\''") + "'"


_COMPOSE_TEMPLATE_BY_DEVICE_TYPE = {
    'pi4': ('docker-compose-player-pi4.yml', 'ANTHIAS_IMAGE_TAG_SUFFIX_PI4', 'ANTHIAS_IMAGE_REGISTRY_PI4'),
    'pi5': ('docker-compose-player-pi5.yml', 'ANTHIAS_IMAGE_TAG_SUFFIX_PI5', 'ANTHIAS_IMAGE_REGISTRY_PI5'),
    'x86': ('docker-compose-player-x86.yml', 'ANTHIAS_IMAGE_TAG_SUFFIX_X86', 'ANTHIAS_IMAGE_REGISTRY_X86'),
}

# Host-side bind-mount layout expected by each compose template's
# volumes: section. All three device types now run our own
# mupitech-player image, built from current-upstream Anthias, whose own
# docker-compose.yml.tmpl uses .anthias/anthias_assets and only
# overrides media_player.py (viewer/__init__.py isn't a bind mount
# there at all). The old third-party fork's .screenly/screenly_assets
# layout (which bind-mounted the whole viewer/ package) is kept as
# _DEFAULT_HOME_LAYOUT purely as a defensive fallback for an unknown
# device_type — no real device type maps to it anymore since Phase 5.
_DEFAULT_HOME_LAYOUT = {
    'project_dir': 'screenly',
    'config_dir': '.screenly',
    'assets_dir': 'screenly_assets',
    'media_player_rel': 'screenly/viewer/media_player.py',
    'needs_media_player_override': True,
    'extract_viewer_init': True,
    'viewer_init_rel': 'screenly/viewer/__init__.py',
    'extra_dirs': ['screenly/staticfiles'],
}
# needs_media_player_override=False here on purpose: the current
# mupitech-player docker-compose-player-{x86,pi4,pi5}.yml templates no
# longer bind-mount media_player.py over the image's own copy (see the
# fix that removed it — a placeholder/stale-template file bind-mounted
# there was silently replacing ~950 lines of the real, current
# anthias_viewer/media_player.py with an empty or out-of-date one,
# breaking the viewer's screen capture, video playback and PulseAudio
# routing entirely: ImportError: cannot import name 'MediaPlayerProxy'.
# That bind mount made sense for the old third-party fork, where this
# file was a small genuinely-overridable shim — it was never revisited
# when this repo moved to the current, much larger upstream-based file.
_NEW_SHAPE_HOME_LAYOUT = {
    'project_dir': 'anthias',
    'config_dir': '.anthias',
    'assets_dir': 'anthias_assets',
    'media_player_rel': 'anthias/media_player.py',
    'needs_media_player_override': False,
    'extract_viewer_init': False,
    'viewer_init_rel': None,
    'extra_dirs': [],
}
_HOME_LAYOUT_BY_DEVICE_TYPE = {
    'x86': _NEW_SHAPE_HOME_LAYOUT,
    'pi4': _NEW_SHAPE_HOME_LAYOUT,
    'pi5': _NEW_SHAPE_HOME_LAYOUT,
}


def _home_layout(device_type):
    return _HOME_LAYOUT_BY_DEVICE_TYPE.get(device_type, _DEFAULT_HOME_LAYOUT)


def _prepare_player_directories(ssh, home, ssh_user, device_type, sudo_password, timeout=10):
    """Create (or normalize) the host directories docker-compose bind-mounts
    into the containers, idempotently — safe to call both on a fresh
    device and on one already running a different compose shape (e.g.
    migrating an existing device onto a new image/template)."""
    layout = _home_layout(device_type)
    media_player_path = f'{home}/{layout["media_player_rel"]}'
    dirs = {
        f'{home}/{layout["project_dir"]}',
        f'{home}/{layout["config_dir"]}',
        f'{home}/{layout["assets_dir"]}',
    }
    if layout['needs_media_player_override']:
        dirs.add(os.path.dirname(media_player_path))
    dirs.update(f'{home}/{d}' for d in layout['extra_dirs'])
    dirs_str = ' '.join(sorted(dirs))
    _ssh_run(ssh, f'sudo mkdir -p {dirs_str}', sudo_password=sudo_password, timeout=timeout)
    _ssh_run(ssh, f'sudo chown -R {ssh_user}:{ssh_user} {dirs_str}', sudo_password=sudo_password, timeout=timeout)

    placeholder_paths = [media_player_path] if layout['needs_media_player_override'] else []
    if layout['extract_viewer_init']:
        placeholder_paths.append(f'{home}/{layout["viewer_init_rel"]}')
    if placeholder_paths:
        placeholder_cmd = '; '.join(
            f'[ -d {_shell_quote(p)} ] && rm -rf {_shell_quote(p)}; touch {_shell_quote(p)}'
            for p in placeholder_paths
        )
        _ssh_run(ssh, placeholder_cmd, timeout=timeout)

    _touch_device_label_placeholder(ssh, home, layout, timeout)
    return layout


def _touch_device_label_placeholder(ssh, home, layout, timeout=10):
    """Ensure the device-label JSON (players/branding.py's
    push_device_label_to_player) exists at its host path before the
    compose file's volumes: entry ever bind-mounts it into the
    container — otherwise Docker creates an empty directory there
    instead (the exact bug that broke media_player.py earlier: a bind
    mount whose host side doesn't exist yet shadows the container's real
    file with a directory rather than failing loudly). `[ -f ... ] ||`
    makes this a no-op on repeat calls (migrate/rebuild), so a device's
    already-pushed label survives being re-provisioned. Shared by
    provision.py and migrate_image.py's two directory-prep call sites.
    """
    label_path = f'{home}/{layout["config_dir"]}/mupitech-device-label.json'
    _ssh_run(
        ssh, f'[ -f {_shell_quote(label_path)} ] || echo {_shell_quote("{}")} > {_shell_quote(label_path)}',
        timeout=timeout,
    )


def _render_compose(ip_address, ssh_user, watchtower_token, mac_address='', device_type='pi4', registry_override=None):
    """Render docker-compose template with variables.

    registry_override, when given, replaces the GHCR registry path with
    the local mirror's (see fleet_manager/registry_mirror.py) — used
    when the local registry mirror is enabled, so newly-provisioned
    devices pull from the LAN instead of the internet.
    """
    template_name, tag_suffix_setting, registry_setting = _COMPOSE_TEMPLATE_BY_DEVICE_TYPE.get(
        device_type, ('docker-compose-player.yml', 'ANTHIAS_IMAGE_TAG_SUFFIX_PI4', 'ANTHIAS_IMAGE_REGISTRY'),
    )
    template_path = os.path.join(
        settings.BASE_DIR, 'provision', 'templates', template_name,
    )
    with open(template_path) as f:
        template = Template(f.read())
    registry = registry_override or getattr(settings, registry_setting)
    return template.safe_substitute(
        PI_IP=ip_address,
        PI_USER=ssh_user,
        WATCHTOWER_TOKEN=watchtower_token,
        MAC_ADDRESS=mac_address,
        ANTHIAS_REGISTRY=registry,
        ANTHIAS_TAG_SUFFIX=getattr(settings, tag_suffix_setting),
    )


try:
    from celery import shared_task

    @shared_task(bind=True, max_retries=0, time_limit=1800, soft_time_limit=1700)
    def provision_player(self, task_id, ssh_password, fm_server_url=''):
        """Provision a new Anthias player on a Raspberry Pi via SSH."""
        import paramiko

        task = ProvisionTask.objects.get(id=task_id)
        task.status = 'running'
        task.save(update_fields=['status'])

        ssh = None
        sftp = None

        try:
            # Step 1: SSH Connect (with retry)
            _update_step(task, 1, 'ssh_connect', 'running', 'Connecting via SSH...')
            _append_log(task, f'[Step 1] Connecting to {task.ip_address}:{task.ssh_port}...')

            # Pre-check: TCP connect to SSH port
            def _check_port(host, port, timeout=3):
                try:
                    s = socket.create_connection((host, port), timeout=timeout)
                    s.close()
                    return True
                except (socket.timeout, ConnectionRefusedError, OSError):
                    return False

            if not _check_port(task.ip_address, task.ssh_port):
                _append_log(task, f'Port {task.ssh_port} on {task.ip_address} is not open. Waiting for host to come online...')
                _update_step(task, 1, 'ssh_connect', 'running', 'Waiting for host to come online...')
                # Wait up to 60s for SSH port to open
                port_ok = False
                for wait_i in range(12):
                    time.sleep(5)
                    if _check_port(task.ip_address, task.ssh_port):
                        port_ok = True
                        _append_log(task, f'SSH port is open after ~{(wait_i + 1) * 5}s')
                        break
                if not port_ok:
                    raise RuntimeError(
                        f'Host {task.ip_address}:{task.ssh_port} is unreachable. '
                        'Check that the device is powered on, connected to the network, and SSH is enabled.'
                    )

            ssh = paramiko.SSHClient()
            ssh.set_missing_host_key_policy(paramiko.AutoAddPolicy())

            # SSH connect with retry (device may still be booting)
            max_ssh_attempts = 5
            ssh_delays = [5, 10, 15, 20, 25]  # backoff delays
            last_error = None
            for attempt in range(1, max_ssh_attempts + 1):
                try:
                    ssh.connect(
                        hostname=task.ip_address,
                        port=task.ssh_port,
                        username=task.ssh_user,
                        password=ssh_password,
                        timeout=15,
                        look_for_keys=False,
                        allow_agent=False,
                    )
                    last_error = None
                    break
                except paramiko.AuthenticationException as e:
                    # Auth errors won't fix themselves — fail immediately
                    raise RuntimeError(
                        f'SSH authentication failed for user "{task.ssh_user}". '
                        'Check username and password.'
                    ) from e
                except (socket.timeout, TimeoutError, OSError, paramiko.SSHException) as e:
                    last_error = e
                    if attempt < max_ssh_attempts:
                        delay = ssh_delays[attempt - 1]
                        _append_log(
                            task,
                            f'SSH attempt {attempt}/{max_ssh_attempts} failed: {e}. '
                            f'Retrying in {delay}s...',
                        )
                        _update_step(
                            task, 1, 'ssh_connect', 'running',
                            f'SSH retry {attempt}/{max_ssh_attempts}...',
                        )
                        time.sleep(delay)
                except Exception as e:
                    raise RuntimeError(f'SSH connection failed: {e}') from e

            if last_error is not None:
                # Classify the final error
                if isinstance(last_error, (socket.timeout, TimeoutError)):
                    raise RuntimeError(
                        f'SSH connection timed out after {max_ssh_attempts} attempts. '
                        'The device may still be booting or SSH service is not running.'
                    ) from last_error
                elif isinstance(last_error, ConnectionRefusedError):
                    raise RuntimeError(
                        f'SSH connection refused on port {task.ssh_port}. '
                        'SSH server may not be enabled on the device.'
                    ) from last_error
                else:
                    raise RuntimeError(
                        f'SSH connection failed after {max_ssh_attempts} attempts: {last_error}'
                    ) from last_error

            out, _, _ = _ssh_run(ssh, 'uname -m', timeout=10)
            arch = out.strip()
            _append_log(task, f'Connected. Architecture: {arch}')
            if arch not in ('aarch64', 'armv7l', 'x86_64'):
                raise RuntimeError(f'Unsupported architecture: {arch}. Expected aarch64, armv7l or x86_64.')

            # x86 has no /proc/device-tree (that's a Pi/device-tree-boot
            # concept) — check it first so an x86 box doesn't fall through
            # to the Pi-model-detection block below and get mislabeled
            # pi4. NOTE: the rest of this function (silent-boot config,
            # SD-card-oriented disk checks, etc.) was written for Pi
            # devices and has not been fully audited for x86 — this only
            # fixes device-type detection, not every downstream step.
            if arch == 'x86_64':
                device_type = 'x86'
                model_str = 'x86_64'
            else:
                # Detect Pi model (Pi4 vs Pi5)
                model_out, _, _ = _ssh_run(ssh, 'cat /proc/device-tree/model 2>/dev/null || echo ""', timeout=5, check=False)
                model_str = model_out.strip().rstrip('\x00')
                if 'Raspberry Pi 5' in model_str or 'Compute Module 5' in model_str:
                    device_type = 'pi5'
                elif 'Raspberry Pi 4' in model_str or 'Compute Module 4' in model_str:
                    device_type = 'pi4'
                else:
                    device_type = 'pi4'  # fallback
            _append_log(task, f'Device type: {device_type} ({model_str})')
            _update_step(task, 1, 'ssh_connect', 'success', f'Connected ({arch}, {device_type})')

            from fleet_manager.registry_mirror import get_registry_settings, local_image_ref
            registry_conf = get_registry_settings()

            # Step 2: Prerequisites check
            task = ProvisionTask.objects.get(id=task_id)
            if task.status == 'failed':
                return
            _update_step(task, 2, 'prerequisites', 'running', 'Checking disk space...')
            _append_log(task, '[Step 2] Checking prerequisites...')

            out, _, _ = _ssh_run(ssh, 'df -BG / | tail -1', timeout=30)
            _append_log(task, f'Disk: {out.strip()}')

            # Check internet (try curl docker, fallback to ping)
            _, _, rc = _ssh_run(ssh, 'curl -sf --max-time 10 https://download.docker.com > /dev/null 2>&1', timeout=15, check=False)
            if rc != 0:
                _, _, rc2 = _ssh_run(ssh, 'ping -c 1 -W 5 8.8.8.8 > /dev/null 2>&1', timeout=10, check=False)
                if rc2 != 0:
                    raise RuntimeError('No internet connection. Check network settings.')
                _append_log(task, 'Internet: available (ping ok, curl to docker.com failed)')
            else:
                _append_log(task, 'Internet: available')

            # Sync system clock (fresh Pi has no RTC battery — clock may be wrong)
            # Wrong time breaks apt GPG signature verification
            _update_step(task, 2, 'prerequisites', 'running', 'Syncing system clock...')
            out, _, _ = _ssh_run(ssh, 'date "+%Y-%m-%d %H:%M:%S %Z"', timeout=10)
            _append_log(task, f'Clock before sync: {out.strip()}')
            # Try timedatectl (systemd-timesyncd), fallback to manual date from FM
            ntp_out, _, rc = _ssh_run(
                ssh,
                'sudo timedatectl set-ntp true 2>/dev/null; sleep 3; '
                'timedatectl show --property=NTPSynchronized --value 2>/dev/null',
                sudo_password=ssh_password, timeout=20, check=False,
            )
            if rc == 0 and 'yes' in (ntp_out or ''):
                _append_log(task, 'Clock synced via systemd-timesyncd')
            else:
                # Fallback: set time from Fleet Manager server. `timezone`
                # is already imported at module level (top of this file) —
                # a local `import` here previously shadowed it for this
                # ENTIRE method (Python scopes a name as local to the
                # whole function the moment any assignment to it appears
                # anywhere in the body, including a conditional import),
                # so whenever THIS branch was skipped (NTP sync succeeded,
                # the common case), every later `timezone.now()` call in
                # provision_player — e.g. setting Player.last_seen during
                # registration — crashed with UnboundLocalError.
                now_utc = timezone.now().strftime('%Y-%m-%d %H:%M:%S')
                _append_log(task, f'NTP unavailable, setting time from FM server: {now_utc} UTC')
                _ssh_run(
                    ssh,
                    f'sudo date -u -s "{now_utc}"',
                    sudo_password=ssh_password, timeout=10, check=False,
                )
            out, _, _ = _ssh_run(ssh, 'date "+%Y-%m-%d %H:%M:%S %Z"', timeout=10)
            _append_log(task, f'Clock after sync: {out.strip()}')

            _update_step(task, 2, 'prerequisites', 'success', 'Prerequisites OK')

            # Step 3: Install Docker
            task = ProvisionTask.objects.get(id=task_id)
            if task.status == 'failed':
                return
            _update_step(task, 3, 'install_docker', 'running', 'Installing Docker...')
            _append_log(task, '[Step 3] Installing Docker...')

            docker_freshly_installed = False
            _, _, rc = _ssh_run(ssh, 'command -v docker', timeout=10, check=False)
            if rc == 0:
                _append_log(task, 'Docker already installed, skipping.')
                # Also ensure docker compose plugin
                _, _, rc2 = _ssh_run(ssh, 'docker compose version', timeout=10, check=False)
                if rc2 != 0:
                    _append_log(task, 'Installing docker-compose-plugin...')
                    _ssh_run(ssh, 'sudo apt-get update -qq && sudo apt-get install -y -qq docker-compose-plugin',
                             sudo_password=ssh_password, timeout=120)
            else:
                _append_log(task, 'Installing Docker via get.docker.com...')
                _ssh_run(
                    ssh,
                    'curl -fsSL https://get.docker.com | sh',
                    timeout=300,
                )
                _append_log(task, 'Adding user to docker group...')
                _ssh_run(ssh, f'sudo usermod -aG docker {task.ssh_user}',
                         sudo_password=ssh_password, timeout=10)
                docker_freshly_installed = True

            out, _, _ = _ssh_run(ssh, 'docker --version', timeout=10)
            _append_log(task, f'Docker: {out.strip()}')

            # Reconnect SSH to pick up new docker group membership
            if docker_freshly_installed:
                _append_log(task, 'Reconnecting SSH to apply docker group...')
                if sftp:
                    sftp.close()
                    sftp = None
                ssh.close()
                time.sleep(2)
                ssh = paramiko.SSHClient()
                ssh.set_missing_host_key_policy(paramiko.AutoAddPolicy())
                for attempt in range(1, 4):
                    try:
                        ssh.connect(
                            hostname=task.ip_address,
                            port=task.ssh_port,
                            username=task.ssh_user,
                            password=ssh_password,
                            timeout=15,
                            look_for_keys=False,
                            allow_agent=False,
                        )
                        break
                    except Exception as e:
                        if attempt == 3:
                            raise RuntimeError(f'SSH reconnect failed after docker install: {e}') from e
                        _append_log(task, f'SSH reconnect attempt {attempt}/3 failed: {e}. Retrying in 5s...')
                        time.sleep(5)
                _append_log(task, 'SSH reconnected.')

            if registry_conf['enabled'] and registry_conf['host']:
                _append_log(task, f"Trusting local registry mirror {registry_conf['host']} (insecure-registries)...")
                daemon_config = json.dumps({'insecure-registries': [registry_conf['host']]})
                _ssh_run(
                    ssh, f'echo {_shell_quote(daemon_config)} | sudo tee /etc/docker/daemon.json > /dev/null',
                    sudo_password=ssh_password, timeout=15, check=False,
                )
                _ssh_run(ssh, 'sudo systemctl restart docker', sudo_password=ssh_password, timeout=30, check=False)
                time.sleep(3)

            _update_step(task, 3, 'install_docker', 'success', 'Docker installed')

            # Step 4: Create directories
            task = ProvisionTask.objects.get(id=task_id)
            if task.status == 'failed':
                return
            _update_step(task, 4, 'create_dirs', 'running', 'Creating directories...')
            _append_log(task, '[Step 4] Creating directories...')

            home = f'/home/{task.ssh_user}'
            layout = _prepare_player_directories(ssh, home, task.ssh_user, device_type, ssh_password)
            _append_log(task, 'Directories created.')
            _update_step(task, 4, 'create_dirs', 'success', 'Directories created')

            # Step 5: Upload docker-compose.yml
            task = ProvisionTask.objects.get(id=task_id)
            if task.status == 'failed':
                return
            _update_step(task, 5, 'upload_compose', 'running', 'Uploading docker-compose.yml...')
            _append_log(task, '[Step 5] Uploading docker-compose.yml...')

            watchtower_token = 'anthias-player-update'
            # Read host MAC address for passing to container
            host_mac, _, _ = _ssh_run(
                ssh,
                "cat /sys/class/net/eth0/address 2>/dev/null || "
                "cat /sys/class/net/end0/address 2>/dev/null || "
                "cat /sys/class/net/wlan0/address 2>/dev/null || "
                "echo ''",
                timeout=5, check=False,
            )
            host_mac = host_mac.strip()
            registry_override = None
            if registry_conf['enabled'] and registry_conf['host']:
                source_registry = getattr(
                    settings,
                    _COMPOSE_TEMPLATE_BY_DEVICE_TYPE.get(device_type, (None, None, 'ANTHIAS_IMAGE_REGISTRY'))[2],
                )
                registry_override = local_image_ref(registry_conf['host'], source_registry)
            compose_content = _render_compose(
                task.ip_address, task.ssh_user, watchtower_token, host_mac, device_type, registry_override,
            )
            sftp = ssh.open_sftp()
            compose_dir = f'{home}/{layout["project_dir"]}'
            compose_path = f'{compose_dir}/docker-compose.yml'
            with sftp.file(compose_path, 'w') as f:
                f.write(compose_content)
            _append_log(task, f'Uploaded {compose_path}')
            _update_step(task, 5, 'upload_compose', 'success', 'docker-compose.yml uploaded')

            # Step 6: Upload configs
            task = ProvisionTask.objects.get(id=task_id)
            if task.status == 'failed':
                return
            _update_step(task, 6, 'upload_configs', 'running', 'Uploading configs...')
            _append_log(task, '[Step 6] Uploading configuration files...')

            # .asoundrc for HDMI audio
            asoundrc = (
                'pcm.!default {\n'
                '  type hw\n'
                '  card 0\n'
                '}\n'
                'ctl.!default {\n'
                '  type hw\n'
                '  card 0\n'
                '}\n'
            )
            with sftp.file(f'{home}/.asoundrc', 'w') as f:
                f.write(asoundrc)
            _append_log(task, 'Uploaded .asoundrc')

            # screenly.conf (minimal defaults) — only the old third-party
            # fork (pi4/pi5) reads this; current upstream Anthias (x86)
            # keeps its own settings inside .anthias, no ini file needed.
            if device_type not in _HOME_LAYOUT_BY_DEVICE_TYPE:
                screenly_conf = (
                    '[viewer]\n'
                    'player_name =\n'
                    'show_splash = no\n'
                    'audio_output = hdmi\n'
                    'shuffle_playlist = no\n'
                    'default_duration = 10\n'
                    'default_streaming_duration = 300\n'
                    'use_24_hour_clock = yes\n'
                    'date_format = YYYY/MM/DD\n'
                    'debug_logging = no\n'
                    'verify_ssl = no\n'
                )
                with sftp.file(f'{home}/.screenly/screenly.conf', 'w') as f:
                    f.write(screenly_conf)
                _append_log(task, 'Uploaded screenly.conf')

            # media_player.py (bind-mounted into viewer container) — only
            # the old third-party fork's compose template still mounts
            # this; the current mupitech-player templates don't (see
            # needs_media_player_override in this module). This template
            # is the OLD fork's VLC-based file (~145 lines) — uploading
            # it for a device on the current image would bind-mount it
            # straight over the real ~950-line anthias_viewer/media_player.py,
            # breaking the viewer exactly like the empty-placeholder bug
            # this guard also prevents (ImportError: cannot import name
            # 'MediaPlayerProxy').
            if layout['needs_media_player_override']:
                media_player_src = os.path.join(
                    settings.BASE_DIR, 'provision', 'templates', 'media_player.py'
                )
                if os.path.exists(media_player_src):
                    with open(media_player_src, 'r') as src:
                        mp_content = src.read()
                    with sftp.file(f'{home}/{layout["media_player_rel"]}', 'w') as f:
                        f.write(mp_content)
                    _append_log(task, f'Uploaded {layout["media_player_rel"]}')
                else:
                    _append_log(task, 'WARNING: media_player.py template not found, skipping')

            _update_step(task, 6, 'upload_configs', 'success', 'Configs uploaded')

            # Step 7: Docker pull (one image at a time for reliability + progress)
            task = ProvisionTask.objects.get(id=task_id)
            if task.status == 'failed':
                return
            _update_step(task, 7, 'docker_pull', 'running', 'Pulling Docker images...')
            _append_log(task, '[Step 7] Pulling Docker images (this may take a while)...')

            # Pull images one-by-one instead of `docker compose pull` which can hang
            _, tag_suffix_setting, registry_setting = _COMPOSE_TEMPLATE_BY_DEVICE_TYPE.get(
                device_type, ('', 'ANTHIAS_IMAGE_TAG_SUFFIX_PI4', 'ANTHIAS_IMAGE_REGISTRY'),
            )
            registry = getattr(settings, registry_setting)
            tag = getattr(settings, tag_suffix_setting)
            if device_type in _HOME_LAYOUT_BY_DEVICE_TYPE:
                # Our own mupitech-player image (x86/pi4/pi5): 4-service
                # shape, celery shares the server image (no separate
                # pull), no nginx/websocket. Registry setting already
                # includes the full image basename (see
                # docker-compose-player-{x86,pi4,pi5}.yml).
                images = [
                    ('redis', f'{registry}-redis:{tag}'),
                    ('watchtower', 'containrrr/watchtower:latest'),
                    ('server', f'{registry}-server:{tag}'),
                    ('viewer', f'{registry}-viewer:{tag}'),
                ]
            else:
                # Unknown device type falling back to the old third-party
                # fork's 6-service image shape (see _DEFAULT_HOME_LAYOUT).
                images = [
                    ('redis', f'{registry}/anthias-redis:{tag}'),
                    ('watchtower', 'containrrr/watchtower:latest'),
                    ('nginx', f'{registry}/anthias-nginx:{tag}'),
                    ('websocket', f'{registry}/anthias-websocket:{tag}'),
                    ('server', f'{registry}/anthias-server:{tag}'),
                    ('celery', f'{registry}/anthias-celery:{tag}'),
                    ('viewer', f'{registry}/anthias-viewer:{tag}'),
                ]
            for idx, (name, image) in enumerate(images, 1):
                task = ProvisionTask.objects.get(id=task_id)
                if task.status == 'failed':
                    return
                _update_step(task, 7, 'docker_pull', 'running',
                             f'Pulling {name} ({idx}/{len(images)})...')
                _append_log(task, f'  Pulling {name} ({idx}/{len(images)}): {image}')
                out, err, _ = _ssh_run(
                    ssh,
                    f'docker pull {image} 2>&1',
                    timeout=600,
                )
                # Log last 500 chars of output (digest/status)
                short_out = out.strip().split('\n')[-1] if out.strip() else ''
                _append_log(task, f'  -> {short_out}')

            _update_step(task, 7, 'docker_pull', 'success', f'All {len(images)} images pulled')

            # Extract bind-mounted files from the viewer image (placeholders would
            # break it) — only the old fork's template mounts viewer/__init__.py.
            if layout['extract_viewer_init']:
                viewer_image = f'{registry}/anthias-viewer:{tag}'
                _ssh_run(ssh, (
                    f'docker run --rm {viewer_image} cat /usr/src/app/viewer/__init__.py'
                    f' > {home}/{layout["viewer_init_rel"]}'
                ), timeout=30)
                _append_log(task, f'Extracted {layout["viewer_init_rel"]} from image')

            # Step 8: Docker up
            task = ProvisionTask.objects.get(id=task_id)
            if task.status == 'failed':
                return
            _update_step(task, 8, 'docker_up', 'running', 'Starting containers...')
            _append_log(task, '[Step 8] Starting containers...')

            out, err, _ = _ssh_run(
                ssh,
                f'cd {compose_dir} && docker compose up -d 2>&1',
                timeout=120,
            )
            _append_log(task, out[-1000:] if len(out) > 1000 else out)
            _update_step(task, 8, 'docker_up', 'success', 'Containers started')

            # Step 9: Wait for player to be ready
            task = ProvisionTask.objects.get(id=task_id)
            if task.status == 'failed':
                return
            _update_step(task, 9, 'wait_ready', 'running', 'Waiting for player API...')
            _append_log(task, '[Step 9] Waiting for player to be ready...')

            # 40 attempts * 5s = ~200s. A fresh device's FIRST boot of the
            # anthias-server container runs its DB migrations, a sqlite
            # backup and uvicorn startup all before it answers anything —
            # live-observed on a real Pi 4 taking well past the previous
            # 24*5s=120s budget under that one-time first-boot load
            # (subsequent boots/restarts are seconds, not minutes). Mirrors
            # the same real-device-needs-more-time reasoning already
            # applied to migrate_image.py's wait_for_player_ready (90s ->
            # 180s) — this is provision's own equivalent, checked via SSH
            # + localhost curl rather than AnthiasAPIClient since no
            # Player row exists yet at this point in a fresh provision.
            max_attempts = 40
            ready = False
            for attempt in range(max_attempts):
                time.sleep(5)
                _, _, rc = _ssh_run(
                    ssh,
                    'curl -sf --max-time 5 http://localhost/api/v2/info > /dev/null 2>&1',
                    timeout=10,
                    check=False,
                )
                if rc == 0:
                    ready = True
                    _append_log(task, f'Player API ready (attempt {attempt + 1})')
                    break
                _append_log(task, f'Attempt {attempt + 1}/{max_attempts}: not ready yet...')

            if not ready:
                raise RuntimeError(
                    f'Player API did not become ready within {max_attempts * 5} seconds.'
                )
            _update_step(task, 9, 'wait_ready', 'success', 'Player is ready')

            # Step 10: Install phone-home timer
            task = ProvisionTask.objects.get(id=task_id)
            if task.status == 'failed':
                return
            _update_step(task, 10, 'phonehome', 'running', 'Installing phone-home...')
            _append_log(task, '[Step 10] Installing phone-home timer...')

            if fm_server_url:
                # Get register token from settings
                register_token = getattr(settings, 'PLAYER_REGISTER_TOKEN', '')

                auth_header = ''
                if register_token:
                    auth_header = f'\n  -H "Authorization: Bearer {register_token}" \\'

                from .phonehome import build_phonehome_script
                phonehome_script = build_phonehome_script(fm_server_url, auth_header)

                _ssh_run(ssh, f'sudo mkdir -p /usr/local/bin', sudo_password=ssh_password, timeout=10)
                with sftp.file(f'{home}/anthias-phonehome.sh', 'w') as f:
                    f.write(phonehome_script)
                _ssh_run(ssh, f'sudo mv {home}/anthias-phonehome.sh /usr/local/bin/anthias-phonehome.sh',
                         sudo_password=ssh_password, timeout=10)
                _ssh_run(ssh, 'sudo chmod +x /usr/local/bin/anthias-phonehome.sh',
                         sudo_password=ssh_password, timeout=10)

                # systemd service
                service_unit = '''[Unit]
Description=Anthias Phone Home
After=network-online.target docker.service
Wants=network-online.target

[Service]
Type=oneshot
ExecStart=/usr/local/bin/anthias-phonehome.sh
'''
                with sftp.file(f'{home}/anthias-phonehome.service', 'w') as f:
                    f.write(service_unit)
                _ssh_run(ssh, f'sudo mv {home}/anthias-phonehome.service /etc/systemd/system/',
                         sudo_password=ssh_password, timeout=10)

                # systemd timer
                timer_unit = '''[Unit]
Description=Anthias Phone Home Timer

[Timer]
OnBootSec=30
OnUnitActiveSec=5min
Unit=anthias-phonehome.service

[Install]
WantedBy=timers.target
'''
                with sftp.file(f'{home}/anthias-phonehome.timer', 'w') as f:
                    f.write(timer_unit)
                _ssh_run(ssh, f'sudo mv {home}/anthias-phonehome.timer /etc/systemd/system/',
                         sudo_password=ssh_password, timeout=10)

                _ssh_run(ssh, 'sudo systemctl daemon-reload && sudo systemctl enable --now anthias-phonehome.timer',
                         sudo_password=ssh_password, timeout=15)
                _append_log(task, 'Phone-home timer installed and started.')
            else:
                _append_log(task, 'No FM server URL provided, skipping phone-home.')

            _update_step(task, 10, 'phonehome', 'success', 'Phone-home installed')

            # Step 11: Install Tailscale (optional, non-fatal)
            task = ProvisionTask.objects.get(id=task_id)
            if task.status == 'failed':
                return
            _update_step(task, 11, 'tailscale', 'running', 'Installing Tailscale...')
            _append_log(task, '[Step 11] Installing Tailscale (optional)...')

            tailscale_ip = None
            try:
                # Check if FM has a Tailscale authkey configured
                ts_authkey_encrypted = cache.get('system:tailscale_authkey')
                if ts_authkey_encrypted:
                    from players.models import _get_fernet as _get_model_fernet
                    try:
                        f = _get_model_fernet()
                        ts_authkey = f.decrypt(ts_authkey_encrypted.encode()).decode()
                    except Exception:
                        ts_authkey = ''

                    if ts_authkey:
                        # Install Tailscale
                        _, _, rc = _ssh_run(ssh, 'command -v tailscale', timeout=10, check=False)
                        if rc != 0:
                            _append_log(task, 'Installing Tailscale...')
                            _ssh_run(
                                ssh,
                                'curl -fsSL https://tailscale.com/install.sh | sh',
                                timeout=120,
                            )
                        else:
                            _append_log(task, 'Tailscale already installed.')

                        # Authenticate with hostname and tag (tagged nodes never expire)
                        _append_log(task, 'Authenticating with Tailscale...')
                        ts_hostname = (task.player_name or f'anthias-{task.ip_address}').lower()
                        # Sanitize hostname: only alphanumeric and hyphens
                        ts_hostname = ''.join(c if c.isalnum() or c == '-' else '-' for c in ts_hostname).strip('-')[:63]
                        _ssh_run(
                            ssh,
                            f'sudo tailscale up --authkey={_shell_quote(ts_authkey)}'
                            f' --hostname={_shell_quote(ts_hostname)}',
                            sudo_password=ssh_password,
                            timeout=30,
                        )

                        # Get Tailscale IP
                        out, _, _ = _ssh_run(ssh, 'tailscale ip -4', timeout=10)
                        tailscale_ip = out.strip()
                        _append_log(task, f'Tailscale connected: {tailscale_ip}')
                        _update_step(task, 11, 'tailscale', 'success', f'Tailscale: {tailscale_ip}')
                    else:
                        _append_log(task, 'Tailscale authkey decryption failed, skipping.')
                        _update_step(task, 11, 'tailscale', 'skipped', 'Auth key error')
                else:
                    _append_log(task, 'No Tailscale authkey configured in FM settings, skipping.')
                    _update_step(task, 11, 'tailscale', 'skipped', 'No auth key configured')
            except Exception as e:
                _append_log(task, f'Tailscale setup failed (non-fatal): {e}')
                _update_step(task, 11, 'tailscale', 'skipped', f'Non-fatal: {e}')

            # Step 12: Silent boot (non-fatal)
            task = ProvisionTask.objects.get(id=task_id)
            if task.status == 'failed':
                return
            _update_step(task, 12, 'silent_boot', 'running', 'Configuring silent boot...')
            _append_log(task, '[Step 12] Configuring silent boot (non-fatal)...')

            if device_type == 'x86':
                # Rainbow-splash/HDMI-hotplug/cmdline.txt tweaks below are
                # all Raspberry Pi bootloader concepts (/boot/firmware) —
                # nothing to do on a BIOS/UEFI x86 box.
                _append_log(task, 'Not applicable on x86, skipping.')
                _update_step(task, 12, 'silent_boot', 'skipped', 'Not applicable on x86')
            else:
                try:
                    silent_boot_script = '''#!/bin/bash
set -e
FLAG="$HOME/.screenly/.silent-boot-done"
[ -f "$FLAG" ] && exit 0

# Disable rainbow splash
sudo bash -c 'grep -q "disable_splash" /boot/firmware/config.txt 2>/dev/null || echo "disable_splash=1" >> /boot/firmware/config.txt'
# Force HDMI output even without monitor (creates /dev/fb0 always)
sudo bash -c 'grep -q "hdmi_force_hotplug" /boot/firmware/config.txt 2>/dev/null || echo "hdmi_force_hotplug=1" >> /boot/firmware/config.txt'
# Hide kernel text, redirect console to tty3
sudo bash -c 'if [ -f /boot/firmware/cmdline.txt ]; then sed -i "s/console=tty1/console=tty3/" /boot/firmware/cmdline.txt; fi'
sudo bash -c 'if [ -f /boot/firmware/cmdline.txt ]; then grep -q "quiet" /boot/firmware/cmdline.txt || sed -i "s/$/ quiet loglevel=0 logo.nologo vt.global_cursor_default=0 consoleblank=0/" /boot/firmware/cmdline.txt; fi'
# Disable login prompt on tty1
sudo systemctl disable getty@tty1.service 2>/dev/null || true

touch "$FLAG"
'''
                    with sftp.file(f'{home}/setup-silent-boot.sh', 'w') as f:
                        f.write(silent_boot_script)
                    _ssh_run(ssh, f'chmod +x {home}/setup-silent-boot.sh && bash {home}/setup-silent-boot.sh',
                             sudo_password=ssh_password, timeout=30, check=False)
                    # Disable cursor immediately (kernel param takes effect after reboot)
                    _ssh_run(ssh, 'sudo bash -c "echo 0 > /sys/class/graphics/fbcon/cursor_blink; '
                             'setterm -cursor off > /dev/tty1 2>/dev/null; '
                             'setterm -cursor off > /dev/tty0 2>/dev/null" || true',
                             sudo_password=ssh_password, timeout=10, check=False)
                    _append_log(task, 'Silent boot configured + cursor hidden.')
                    _update_step(task, 12, 'silent_boot', 'success', 'Silent boot configured')
                except Exception as e:
                    _append_log(task, f'Silent boot setup failed (non-fatal): {e}')
                    _update_step(task, 12, 'silent_boot', 'skipped', f'Non-fatal: {e}')

            # Step 13: Boot splash animation (non-fatal). Raspberry-Pi-only
            # (Plymouth reads /boot/firmware/cmdline.txt, same as silent
            # boot above — a BIOS/UEFI x86 box has no such concept). Ships
            # the same animated Plymouth theme used when building a fresh
            # Pi image from ansible/site.yml in the mupitech-player repo,
            # normally only applied there — devices provisioned through
            # this SSH flow used to boot with a blank screen instead
            # (Plymouth was simply never installed on that path). Only
            # takes visible effect after the device's next reboot,
            # Plymouth being an initramfs-time thing.
            task = ProvisionTask.objects.get(id=task_id)
            if task.status == 'failed':
                return
            _update_step(task, 13, 'boot_splash', 'running', 'Installing boot splash animation...')
            _append_log(task, '[Step 13] Installing boot splash animation (non-fatal)...')

            if device_type == 'x86':
                _append_log(task, 'Not applicable on x86, skipping.')
                _update_step(task, 13, 'boot_splash', 'skipped', 'Not applicable on x86')
            else:
                try:
                    tarball_local_path = os.path.join(
                        settings.BASE_DIR, 'provision', 'assets', 'plymouth-mupitech-theme.tar.gz',
                    )
                    tarball_remote_path = f'{home}/mupitech-plymouth-theme.tar.gz'
                    sftp.put(tarball_local_path, tarball_remote_path)

                    boot_splash_script = '''#!/bin/bash
set -e
FLAG="$HOME/.screenly/.boot-splash-done"
[ -f "$FLAG" ] && exit 0

rm -rf /tmp/mupitech-plymouth-extract
mkdir -p /tmp/mupitech-plymouth-extract
tar xzf "$HOME/mupitech-plymouth-theme.tar.gz" -C /tmp/mupitech-plymouth-extract

sudo apt-get update -qq
sudo DEBIAN_FRONTEND=noninteractive apt-get install -y -qq plymouth plymouth-themes plymouth-label

# Old themes (upstream Screenly + our own former Anthias-named theme)
sudo rm -rf /usr/share/plymouth/themes/screenly /usr/share/plymouth/themes/anthias

sudo mkdir -p /usr/share/plymouth/themes/mupitech
sudo cp -r /tmp/mupitech-plymouth-extract/mupitech/. /usr/share/plymouth/themes/mupitech/
sudo cp /tmp/mupitech-plymouth-extract/plymouthd.default /usr/share/plymouth/plymouthd.defaults
sudo cp /tmp/mupitech-plymouth-extract/plymouthd.default /etc/plymouth/plymouthd.conf
sudo plymouth-set-default-theme mupitech

if [ -f /boot/firmware/cmdline.txt ]; then
    sudo bash -c 'grep -q "splash" /boot/firmware/cmdline.txt || sed -i "s/$/ splash plymouth.ignore-serial-consoles/" /boot/firmware/cmdline.txt'
fi

# plymouthd reads its theme/config from the initramfs, not the rootfs —
# inert until this runs (see plymouthd.default's own comment on why).
sudo update-initramfs -u -k all

rm -rf /tmp/mupitech-plymouth-extract "$HOME/mupitech-plymouth-theme.tar.gz"
mkdir -p "$HOME/.screenly"
touch "$FLAG"
'''
                    with sftp.file(f'{home}/setup-boot-splash.sh', 'w') as f:
                        f.write(boot_splash_script)
                    _ssh_run(ssh, f'chmod +x {home}/setup-boot-splash.sh && bash {home}/setup-boot-splash.sh',
                             sudo_password=ssh_password, timeout=240, check=False)
                    _append_log(task, 'Boot splash animation installed (visible from next reboot).')
                    _update_step(task, 13, 'boot_splash', 'success', 'Boot splash installed')
                except Exception as e:
                    _append_log(task, f'Boot splash setup failed (non-fatal): {e}')
                    _update_step(task, 13, 'boot_splash', 'skipped', f'Non-fatal: {e}')

            # All done — create Player record
            from .models import Player
            player_name = task.player_name or f'Player {task.ip_address}'
            player_url = f'http://{task.ip_address}'

            player_defaults = {
                'name': player_name,
                'is_online': True,
                'last_seen': timezone.now(),
                'device_type': device_type,
                'mac_address': host_mac,
            }
            if tailscale_ip:
                player_defaults['tailscale_ip'] = tailscale_ip
                player_defaults['tailscale_enabled'] = True
                player_defaults['url'] = f'http://{tailscale_ip}'
            else:
                player_defaults['url'] = player_url

            # Match by MAC first (avoids duplicates when IP changes),
            # then fall back to URL match, then create new.
            player = None
            created = False
            if host_mac:
                player = Player.objects.filter(mac_address=host_mac).first()
            if not player:
                player = Player.objects.filter(url=player_url).first()

            if player:
                player.name = player_name
                player.url = player_defaults['url']
                player.is_online = True
                player.last_seen = timezone.now()
                player.device_type = device_type
                player.mac_address = host_mac
                if tailscale_ip:
                    player.tailscale_ip = tailscale_ip
                    player.tailscale_enabled = True
                player.save(update_fields=['name', 'url', 'is_online', 'last_seen',
                                           'device_type', 'mac_address',
                                           'tailscale_ip', 'tailscale_enabled'])
            else:
                player = Player.objects.create(**player_defaults)
                created = True

            # Save the SSH login used for this provisioning session on the
            # device itself, so branding pushes and future management
            # actions don't need to ask for it again.
            player.ssh_username = task.ssh_user
            player.set_ssh_password(ssh_password)
            player.ssh_port = task.ssh_port
            player.save(update_fields=['ssh_username', 'ssh_password_encrypted', 'ssh_port'])

            task.player = player
            task.save(update_fields=['player'])

            # Step 14: push branding overrides. The blue palette/PT copy/
            # default logo+standby are baked into the image itself now
            # (see players/branding.py's module docstring) — nothing to
            # push for those. What's left: a custom logo (only if this
            # player/its group/location actually has one — the bundled
            # MupiTech default is already correct with no push needed),
            # the identification chip, and a custom standby if configured.
            # Best-effort — a device that provisioned fine but isn't ready
            # for a branding push yet shouldn't be reported as a failed
            # enrollment.
            _update_step(task, 14, 'push_branding', 'running', 'Applying branding...')
            _append_log(task, '[Step 14] Pushing branding to the new device...')
            try:
                from .branding import (
                    BrandingPushError, push_device_label_to_player, push_splash_logo_to_player,
                    push_standby_image_to_player, get_standby_path,
                )
                push_splash_logo_to_player(player, task.ssh_user, ssh_password, task.ssh_port)
                push_device_label_to_player(player, task.ssh_user, ssh_password, task.ssh_port)
                if get_standby_path(player):
                    push_standby_image_to_player(player, task.ssh_user, ssh_password, task.ssh_port)
                _update_step(task, 14, 'push_branding', 'success', 'Branding applied')
            except BrandingPushError as e:
                _update_step(task, 14, 'push_branding', 'skipped', f'Non-fatal: {e}')
            except Exception as e:
                _update_step(task, 14, 'push_branding', 'skipped', f'Non-fatal: {e}')

            task.status = 'success'
            task.save(update_fields=['status'])
            _append_log(task, f'Provisioning complete! Player "{player.name}" added.')

        except Exception as e:
            logger.exception('Provisioning failed for task %s', task_id)
            task = ProvisionTask.objects.get(id=task_id)
            task.status = 'failed'
            task.error_message = str(e)[:1000]
            task.save(update_fields=['status', 'error_message'])
            _append_log(task, f'ERROR: {e}')

            # Mark current step as failed
            if task.steps:
                last_step = task.steps[-1]
                if last_step.get('status') == 'running':
                    _update_step(
                        task, last_step['step'], last_step['name'],
                        'failed', str(e)[:200],
                    )

        finally:
            if sftp:
                try:
                    sftp.close()
                except Exception:
                    pass
            if ssh:
                try:
                    ssh.close()
                except Exception:
                    pass

except ImportError:
    # Celery not available (e.g., during migrations)
    pass
