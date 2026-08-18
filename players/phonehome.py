"""Shared phone-home script body — the actual curl-calling bash script
written to /usr/local/bin/anthias-phonehome.sh, used by both the
fresh SSH-provisioning flow (provision.py, Step 10) and the manual
"(re)install phone-home on an already-provisioned device" endpoint
(views.py::install_phonehome).

These two call sites used to carry their own independently-copied
version of this script and had drifted apart: provision.py's copy was
missing the `case "$INFO" in ...` safeguard below entirely, so any
device provisioned through that flow (the normal path for a fresh
device) silently sent invalid JSON on every single heartbeat whenever
its local /api/v2/info call didn't return a real JSON object (e.g. a
302-to-/login/ redirect on a device with local auth enabled, which
`curl -f` treats as success) — register_player's JSON parser rejected
the whole request with 400, so the device's IP/status never updated
again, indefinitely. One shared function means a fix here reaches both
paths at once instead of relying on someone remembering to patch both.
"""


def build_phonehome_script(server_url, auth_header_line=''):
    """server_url: the Fleet Manager's base URL. The caller is
    responsible for validating it isn't attacker-controlled shell
    input — install_phonehome validates its query-param version against
    shell metacharacters; provision.py's comes from a trusted
    admin-entered field, not user input.

    auth_header_line: '' or a pre-formatted
    '\\n  -H "Authorization: Bearer <token>" \\\\' fragment (kept as a
    plain string rather than a token param so each caller's own
    PLAYER_REGISTER_TOKEN lookup stays where it already is).
    """
    return f'''#!/bin/bash
SERVER="{server_url}"
NAME="$(hostname)"
INFO=$(curl -sf http://localhost/api/v2/info 2>/dev/null || echo '{{}}')
# /api/v2/info requires a login when the device has local auth enabled
# (auth_backend set) — this unauthenticated local curl then gets a 302
# to /login/ instead of a 4xx/5xx, which `curl -f` does NOT treat as a
# failure (only >=400 is), so it exits 0 with an empty body instead of
# falling through to the '{{}}' default above. Left unguarded, that
# empty $INFO produces `"info":` with no value in the JSON built below
# — invalid JSON, so the Fleet Manager's own /api/players/register/
# call rejects the whole heartbeat with a parse error, and the
# device's IP/status silently never updates again. System stats just
# won't populate via phone-home on such a device (view them from its
# own dashboard once logged in, or via the SSH-based checks
# elsewhere) — that's an accepted gap, but the heartbeat itself must
# not break because of it.
case "$INFO" in
  '{{'*) ;;
  *) INFO='{{}}' ;;
esac

# Resolve the LAN-facing interface once (whichever owns the default
# route) and derive both the reported URL's IP and the MAC from it —
# covers any interface naming scheme (systemd predictable names like
# ens18/enp1s0 on VMs, eth0/end0 on Pis, wlan0, etc.) instead of a
# hardcoded allowlist that found nothing on non-eth0-named hardware.
# Deriving the IP this way (instead of `hostname -I`'s first token,
# whose order isn't guaranteed and can shift once Docker creates its
# own bridge networks — docker0, compose bridges — ahead of the real
# LAN interface) avoids reporting a Docker-internal IP as this
# device's URL, which register_player would then treat as a brand
# new device instead of updating the existing one.
DEFAULT_IFACE=$(ip route show default 2>/dev/null | awk '/^default/ {{print $5; exit}}')

IP=""
if [ -n "$DEFAULT_IFACE" ]; then
  IP=$(ip -4 -o addr show dev "$DEFAULT_IFACE" 2>/dev/null | awk '{{print $4}}' | cut -d/ -f1 | head -1)
fi
if [ -z "$IP" ]; then
  IP=$(hostname -I | awk '{{print $1}}')
fi
URL="http://$IP"

MAC=""
if [ -n "$DEFAULT_IFACE" ] && [ -f "/sys/class/net/$DEFAULT_IFACE/address" ]; then
  MAC=$(cat "/sys/class/net/$DEFAULT_IFACE/address")
fi
if [ -z "$MAC" ]; then
  for addr_file in /sys/class/net/*/address; do
    iface=$(basename "$(dirname "$addr_file")")
    [ "$iface" = "lo" ] && continue
    MAC=$(cat "$addr_file")
    [ -n "$MAC" ] && break
  done
fi
MAC_FIELD=""
if [ -n "$MAC" ]; then
  MAC_FIELD=",\\"mac_address\\":\\"$MAC\\""
fi

# Detect Tailscale IP if available
TS_IP=""
if command -v tailscale >/dev/null 2>&1; then
  TS_IP=$(tailscale ip -4 2>/dev/null || true)
fi
TS_FIELD=""
if [ -n "$TS_IP" ]; then
  TS_FIELD=",\\"tailscale_ip\\":\\"$TS_IP\\""
fi

curl -sf -X POST "${{SERVER}}/api/players/register/" \\
  -H "Content-Type: application/json" \\{auth_header_line}
  -d "{{\\"url\\":\\"${{URL}}\\",\\"name\\":\\"${{NAME}}\\",\\"info\\":${{INFO}}$MAC_FIELD$TS_FIELD}}"
'''
