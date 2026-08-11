"""On-demand screenshot capture for official (non-fork) Anthias devices.

Official Anthias's x86/arm64/pi5 viewer renders through `cage`, a kiosk
Wayland compositor — confirmed from source
(tools/image_builder/utils.py, bin/lib/viewer/common.sh) to run with
XDG_RUNTIME_DIR=/run/user/1000 and WAYLAND_DISPLAY=wayland-0 — but the
image does not ship `grim` (or any screenshot tool).

An earlier version of this tried to reach that runtime directory from a
throwaway sidecar container via /proc/<pid>/root/run/user/1000 (that
path is plain container-writable-layer storage, not a declared volume,
so a bind mount was the only way to expose it without touching the
image). In practice Docker/runc reject bind-mounting through a
/proc/<pid>/root magic-link source with EINVAL — modern container
runtimes specifically harden against this exact cross-container mount
pattern.

Instead, this installs `grim` directly inside the already-running
anthias-viewer container (same mount namespace as the compositor, so
no cross-container mount trick is needed at all) and runs it there via
`docker exec`. The install is a one-off per container lifetime — `which
grim` short-circuits it on every capture after the first — and only
touches that container's writable layer, not the image.
"""

from urllib.parse import urlparse

GRIM_INSTALL_CMD = (
    'which grim > /dev/null 2>&1 || '
    '(apt-get update -qq && apt-get install -y -qq --no-install-recommends grim)'
)


class ScreenshotSidecarError(Exception):
    """Raised when the SSH-based screenshot capture fails."""


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
    """SSH into `player`'s host, ensure `grim` is installed inside the
    running anthias-viewer container, and capture a PNG of whatever it
    is currently displaying.
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
        quoted_container = _shell_quote(container)

        # Install grim in-place (root, default exec user) if it isn't
        # there already — idempotent, and a no-op after the first call.
        _, install_err, install_rc = _ssh_exec_bytes(
            ssh,
            f'docker exec -e DEBIAN_FRONTEND=noninteractive {quoted_container} '
            f'sh -c {_shell_quote(GRIM_INSTALL_CMD)}',
            max(timeout, 60),
        )
        if install_rc != 0:
            raise ScreenshotSidecarError(
                f'Could not install grim inside the viewer container (exit {install_rc}): '
                f'{install_err.strip() or "no output"}'
            )

        # Capture as the viewer user (UID 1000) so grim connects to its
        # Wayland socket with matching ownership.
        cmd = (
            f'docker exec --user 1000 '
            f'-e WAYLAND_DISPLAY=wayland-0 -e XDG_RUNTIME_DIR=/run/user/1000 '
            f'{quoted_container} grim -t png -'
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
