"""On-demand screenshot capture for official (non-fork) Anthias devices.

Official Anthias's x86/arm64/pi5 viewer renders through `cage`, a kiosk
Wayland compositor — confirmed from source
(tools/image_builder/utils.py, bin/lib/viewer/common.sh) to run with
XDG_RUNTIME_DIR=/run/user/1000 and WAYLAND_DISPLAY=wayland-0 — but the
image does not ship `grim` (or any screenshot tool), and that runtime
directory is plain container-writable-layer storage, not a declared
volume (confirmed against docker-compose.yml.tmpl's anthias-viewer
volumes: none of them touch /run).

Since we don't control/rebuild that image, this runs a tiny throwaway
sidecar container instead: it reaches the viewer's runtime directory
via /proc/<pid>/root/run/user/1000 — bind-mounting into another
container's rootfs through procfs, the standard trick for exposing a
path that was never declared as a volume — and connects to the same
Wayland socket any other client on that compositor would.
"""

from urllib.parse import urlparse

SIDECAR_IMAGE = 'mupitech-grim-sidecar'
SIDECAR_DOCKERFILE = 'FROM alpine:latest\nRUN apk add --no-cache grim\n'


class ScreenshotSidecarError(Exception):
    """Raised when the SSH-based sidecar screenshot capture fails."""


def _ssh_exec_bytes(ssh, cmd, timeout):
    """Run `cmd` over SSH and return its raw stdout as bytes.

    Unlike players/provision.py's _ssh_run, which decodes stdout as
    UTF-8 text, this keeps it binary — required for PNG output.
    """
    _stdin, stdout, stderr = ssh.exec_command(cmd, timeout=timeout)
    channel = stdout.channel
    channel.settimeout(timeout)
    chunks = []
    while True:
        chunk = channel.recv(65536)
        if not chunk:
            break
        chunks.append(chunk)
    exit_code = channel.recv_exit_status()
    err = stderr.read().decode('utf-8', errors='replace')
    return b''.join(chunks), err, exit_code


def capture_screenshot_via_sidecar(player, ssh_user, ssh_password, ssh_port=22, timeout=30):
    """SSH into `player`'s host, ensure the tiny grim sidecar image
    exists (building it once if missing), and capture a PNG of
    whatever the viewer container is currently displaying.
    """
    import paramiko

    from .provision import _shell_quote, _ssh_run

    host = urlparse(player.url).hostname
    if not host:
        raise ScreenshotSidecarError(f"Could not determine host from player URL: {player.url}")

    ssh = paramiko.SSHClient()
    ssh.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    try:
        ssh.connect(host, port=ssh_port, username=ssh_user, password=ssh_password, timeout=timeout)
    except Exception as exc:
        raise ScreenshotSidecarError(f'SSH connection failed: {exc}') from exc

    try:
        out, _, _ = _ssh_run(
            ssh,
            "docker ps --format '{{.Names}}' --filter name=anthias-viewer",
            timeout=timeout,
        )
        container = next((line for line in out.strip().splitlines() if line.strip()), '')
        if not container:
            raise ScreenshotSidecarError(
                'Could not find a running anthias-viewer container on this device.'
            )

        pid_out, _, _ = _ssh_run(
            ssh,
            f'docker inspect -f {_shell_quote("{{.State.Pid}}")} {_shell_quote(container)}',
            timeout=timeout,
        )
        pid = pid_out.strip()
        if not pid.isdigit():
            raise ScreenshotSidecarError(f'Could not determine the viewer container PID (got: {pid!r}).')

        # Build the sidecar image once — a cheap no-op on every capture
        # after the first, since the image then already exists.
        _ssh_run(
            ssh,
            f'docker image inspect {SIDECAR_IMAGE} > /dev/null 2>&1 || '
            f'echo {_shell_quote(SIDECAR_DOCKERFILE)} | docker build -t {SIDECAR_IMAGE} -',
            timeout=max(timeout, 60),
        )

        runtime_mount = f'/proc/{pid}/root/run/user/1000'
        cmd = (
            f'docker run --rm '
            f'-v {_shell_quote(runtime_mount)}:/run/user/1000:ro '
            f'-e WAYLAND_DISPLAY=wayland-0 -e XDG_RUNTIME_DIR=/run/user/1000 '
            f'--user 1000 {SIDECAR_IMAGE} grim -t png -'
        )
        png_bytes, err, exit_code = _ssh_exec_bytes(ssh, cmd, timeout)
        if exit_code != 0 or not png_bytes:
            raise ScreenshotSidecarError(f'grim failed (exit {exit_code}): {err.strip() or "no output"}')
        return png_bytes
    except ScreenshotSidecarError:
        raise
    except Exception as exc:
        raise ScreenshotSidecarError(str(exc)) from exc
    finally:
        ssh.close()
