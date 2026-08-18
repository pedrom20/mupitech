import logging

import requests
from django.conf import settings
from rest_framework import status
from requests.adapters import HTTPAdapter
from requests.exceptions import ConnectionError, HTTPError, RetryError, Timeout
from urllib3.util.retry import Retry

logger = logging.getLogger(__name__)


class PlayerConnectionError(Exception):
    """Raised when a player cannot be reached or returns an error."""

    def __init__(self, message, status_code=None, response_data=None):
        super().__init__(message)
        self.status_code = status_code
        self.response_data = response_data


def format_player_error(exc):
    """Extract a human-readable error from PlayerConnectionError.

    DRF validation errors come as dicts like:
        {"field": ["msg1", "msg2"], "non_field_errors": ["msg3"]}
    Player custom errors come as:
        {"error": "some message"}
    """
    data = exc.response_data
    if not data:
        return str(exc), status.HTTP_502_BAD_GATEWAY

    # Player-side HTTP status → forward as-is for 4xx
    http_status = status.HTTP_502_BAD_GATEWAY
    if exc.status_code and 400 <= exc.status_code < 500:
        http_status = exc.status_code

    # {"error": "..."} format
    if isinstance(data, dict) and 'error' in data:
        return data['error'], http_status

    # {"detail": "..."} format (DRF generic)
    if isinstance(data, dict) and 'detail' in data:
        return data['detail'], http_status

    # DRF serializer validation: {"field": ["msg", ...], ...}
    if isinstance(data, dict):
        messages = []
        for field, errors in data.items():
            if isinstance(errors, list):
                for msg in errors:
                    if field == 'non_field_errors':
                        messages.append(str(msg))
                    else:
                        messages.append(f'{field}: {msg}')
            else:
                messages.append(f'{field}: {errors}')
        if messages:
            return '; '.join(messages), http_status

    return str(exc), http_status


def _build_session():
    """Build a requests.Session with retry/backoff on 5xx and 429."""
    session = requests.Session()
    retry = Retry(
        total=3,
        backoff_factor=0.5,
        status_forcelist=[429, 500, 502, 503, 504],
        allowed_methods=['GET', 'POST', 'PATCH', 'DELETE'],
    )
    adapter = HTTPAdapter(max_retries=retry, pool_connections=10, pool_maxsize=10)
    session.mount('http://', adapter)
    session.mount('https://', adapter)
    return session


# Module-level shared session for connection pooling across requests.
_session = _build_session()


class AnthiasAPIClient:
    """Client for communicating with an Anthias player's HTTP API v2."""

    def __init__(self, player):
        self.player = player
        self.base_url = player.get_api_url()
        self.fallback_url = player.get_tailscale_url()
        self.timeout = getattr(settings, 'PLAYER_REQUEST_TIMEOUT', 10)

        self.auth = None
        if player.username:
            self.auth = (player.username, player.get_password())

    def _request(self, method, endpoint, **kwargs):
        """
        Make an HTTP request to the player's API.

        Uses a shared session with connection pooling and automatic
        retry with exponential backoff on 5xx/429.

        If the primary URL fails with a connection/timeout error and
        a Tailscale fallback URL is configured, retries via Tailscale.
        HTTP errors (4xx/5xx) do NOT trigger fallback — the player is
        reachable but returned an error.
        """
        url = f'{self.base_url}{endpoint}'
        kwargs.setdefault('timeout', self.timeout)
        if self.auth:
            kwargs.setdefault('auth', self.auth)

        try:
            return self._do_request(method, url, **kwargs)
        except PlayerConnectionError as primary_exc:
            # Only fallback on connection/timeout errors (no status_code)
            if primary_exc.status_code is not None or not self.fallback_url:
                raise
            # Try Tailscale fallback
            fallback_url = f'{self.fallback_url}{endpoint}'
            logger.info(
                'Primary URL failed for %s, trying Tailscale fallback: %s',
                self.player.name, fallback_url,
            )
            try:
                return self._do_request(method, fallback_url, **kwargs)
            except PlayerConnectionError:
                # Both failed — raise the original error
                raise primary_exc

    def _do_request(self, method, url, **kwargs):
        """Execute a single HTTP request and handle errors."""
        try:
            response = _session.request(method, url, **kwargs)
            response.raise_for_status()
            return response
        except ConnectionError as exc:
            logger.warning(
                'Connection error for player %s (%s): %s',
                self.player.name, url, exc,
            )
            raise PlayerConnectionError(
                f'Cannot connect to player {self.player.name} at {url}'
            ) from exc
        except Timeout as exc:
            logger.warning(
                'Timeout for player %s (%s): %s',
                self.player.name, url, exc,
            )
            raise PlayerConnectionError(
                f'Request to player {self.player.name} at {url} timed out'
            ) from exc
        except RetryError as exc:
            logger.warning(
                'Max retries exceeded for player %s (%s): %s',
                self.player.name, url, exc,
            )
            raise PlayerConnectionError(
                f'Player {self.player.name} at {url} returned repeated errors'
            ) from exc
        except HTTPError as exc:
            resp = exc.response
            code = resp.status_code
            logger.warning(
                'HTTP error from player %s (%s): %s',
                self.player.name, url, exc,
            )
            response_data = None
            try:
                response_data = resp.json()
            except (ValueError, AttributeError):
                pass
            raise PlayerConnectionError(
                f'Player {self.player.name} at {url} returned {code}',
                status_code=code,
                response_data=response_data,
            ) from exc

    def _json(self, response):
        """Parse a response as JSON, or raise PlayerConnectionError.

        A 200 OK with non-JSON content (most commonly an HTML login
        page — the player has auth enabled and the configured
        username/password didn't authenticate, or credentials are
        blank) would otherwise raise an uncaught JSONDecodeError deep
        in a Celery task, silently killing it instead of being
        reported as a normal connection failure.
        """
        try:
            return response.json()
        except ValueError as exc:
            raise PlayerConnectionError(
                f'Player {self.player.name} returned a non-JSON response '
                f'(does it require authentication?)',
                status_code=response.status_code,
            ) from exc

    def get_info(self):
        """GET /api/v2/info - Retrieve player information."""
        response = self._request('GET', '/api/v2/info')
        return self._json(response)

    def get_assets(self):
        """GET /api/v2/assets - Retrieve the list of assets on the player."""
        response = self._request('GET', '/api/v2/assets')
        return self._json(response)

    def get_device_settings(self):
        """GET /api/v2/device_settings - Retrieve device settings."""
        response = self._request('GET', '/api/v2/device_settings')
        return self._json(response)

    def update_device_settings(self, data):
        """PATCH /api/v2/device_settings - Update device settings."""
        response = self._request('PATCH', '/api/v2/device_settings', json=data)
        return self._json(response)

    def create_asset(self, data):
        """POST /api/v2/assets - Create a new asset on the player."""
        response = self._request('POST', '/api/v2/assets', json=data)
        return self._json(response)

    def update_asset(self, asset_id, data):
        """PATCH /api/v2/assets/{asset_id} - Update an existing asset."""
        response = self._request('PATCH', f'/api/v2/assets/{asset_id}', json=data)
        return self._json(response)

    def delete_asset(self, asset_id):
        """DELETE /api/v2/assets/{asset_id} - Delete an asset from the player."""
        self._request('DELETE', f'/api/v2/assets/{asset_id}')

    def upload_file(self, file_obj):
        """POST /api/v2/file_asset - Upload a file to the player (multipart)."""
        files = {'file_upload': file_obj}
        response = self._request('POST', '/api/v2/file_asset', files=files)
        return self._json(response)

    def reboot(self):
        """POST /api/v2/reboot - Reboot the player."""
        self._request('POST', '/api/v2/reboot')

    def shutdown(self):
        """POST /api/v2/shutdown - Shut down the player."""
        self._request('POST', '/api/v2/shutdown')

    def create_backup(self):
        """POST /api/v2/backup - Create a backup of the player's data."""
        response = self._request('POST', '/api/v2/backup')
        return response.text

    def set_playlist_order(self, ids_str):
        """POST /api/v2/assets/order - Set the playlist order."""
        self._request('POST', '/api/v2/assets/order', data={'ids': ids_str})

    def get_viewlog(self, since=None):
        """GET /api/v2/viewlog - Retrieve playback history from the player."""
        params = {}
        if since:
            params['since'] = since
        response = self._request('GET', '/api/v2/viewlog', params=params)
        return self._json(response)

    def get_screenshot(self):
        """GET /api/v2/screenshot - Capture and retrieve a screenshot."""
        response = self._request('GET', '/api/v2/screenshot', timeout=30)
        return response.content

    def control_asset(self, command):
        """GET /api/v2/assets/control/<command> - Control playback (next/previous)."""
        response = self._request('GET', f'/api/v2/assets/control/{command}')
        return response.text

    # Recurring weekly scheduling (play_days/play_time_from/play_time_to)
    # is just fields on the asset itself in current official Anthias —
    # no separate "schedule slot" resource, so no dedicated client
    # methods here. Read via get_assets()/get_info(), write via
    # update_asset() (see players/views.py::asset_update).

    def trigger_update(self):
        """POST /api/v2/update - Trigger Watchtower update on the player."""
        response = self._request('POST', '/api/v2/update')
        return self._json(response)

    # ── CEC TV control ──
    #
    # Official Anthias (our own MupiTech image, not the old alex1981-tech
    # fork) exposes CEC as a single `display_power` field on GET
    # /api/v2/info (populated by a periodic celery-beat probe — see
    # lib/diagnostics.py::get_display_power in the anthias fork), and a
    # single POST /api/v2/display/<on|off> to change it. There is no
    # dedicated /cec/status or /cec/standby|wake endpoint upstream — the
    # separate-endpoints shape below is this client's own translation
    # layer, kept so callers (players/views.py, the frontend) don't need
    # to change.
    _CEC_UNAVAILABLE_VALUES = (
        'No CEC adapter', 'No CEC display detected', 'CEC adapter unresponsive', 'CEC error', None,
    )

    def _cec_status_from_display_power(self, display_power):
        if display_power in self._CEC_UNAVAILABLE_VALUES:
            return {'cec_available': False, 'tv_on': False}
        # get_display_power() returns real bool True/False for a real
        # answer from a real peer, but redis-py rejects bool values, so
        # celery_tasks stores it as the string 'True'/'False'.
        tv_on = display_power in (True, 'True')
        return {'cec_available': True, 'tv_on': tv_on}

    def get_cec_status(self):
        """Derive CEC availability and TV power state from GET /api/v2/info."""
        info = self.get_info()
        return self._cec_status_from_display_power(info.get('display_power'))

    def _set_display_power(self, state):
        """POST /api/v2/display/<state> (state is 'on' or 'off'). Raises
        PlayerConnectionError (503 no adapter, 502 TV/adapter didn't
        respond) on failure — reaching the return means it succeeded."""
        self._request('POST', f'/api/v2/display/{state}')
        return self._cec_status_from_display_power('True' if state == 'on' else 'False')

    def cec_standby(self):
        """Send TV to standby via HDMI-CEC."""
        return self._set_display_power('off')

    def cec_wake(self):
        """Wake TV via HDMI-CEC."""
        return self._set_display_power('on')

    # ── IR remote control ──

    def get_ir_status(self):
        """GET /api/v2/ir/status - Get IR hardware availability."""
        response = self._request('GET', '/api/v2/ir/status')
        return self._json(response)

    def ir_test(self, protocol, scancode):
        """POST /api/v2/ir/test - Send a test IR power code."""
        response = self._request('POST', '/api/v2/ir/test', json={
            'protocol': protocol,
            'scancode': scancode,
        })
        return self._json(response)


# Anthias asset mimetypes, keyed by content.MediaFile.file_type
ASSET_MIMETYPE_MAP = {
    'image': 'image',
    'video': 'video',
    'web': 'webpage',
}


def resolve_players_from_targets(player_ids=None, group_ids=None, location_ids=None):
    """All players resolved from a mix of direct player/group/location ids:
    direct players, plus every player in a target group, plus every player
    in a target location (directly-located ungrouped players and players
    via a located group). Same resolution rule as Playlist.resolve_target_players
    (playlists/models.py) — kept here as a standalone function since the
    content-scheduling action (content/views.py) needs it against an
    ad-hoc list of ids, not a persisted playlist's M2M fields."""
    from groups.models import Group
    from locations.models import Location

    from .models import Player

    ids = set(player_ids or [])
    for group in Group.objects.filter(id__in=group_ids or []):
        ids.update(str(pid) for pid in group.players.values_list('id', flat=True))
    for location in Location.objects.filter(id__in=location_ids or []):
        ids.update(str(pid) for pid in location.players.values_list('id', flat=True))
        for group in location.groups.all():
            ids.update(str(pid) for pid in group.players.values_list('id', flat=True))
    return Player.objects.filter(id__in=ids)


def deploy_media_file_to_player(player, media_file, name=None, duration=10,
                                 start_date=None, end_date=None, base_url=''):
    """Create an asset on `player` from a content.MediaFile.

    Shared by the single-item "asset upload" endpoint and playlist
    deployment: uploads the file to the player first (local media), or
    uses the source URL directly (web pages, CCTV streams). Raises
    PlayerConnectionError on failure.
    """
    from django.utils import timezone
    from datetime import timedelta

    client = AnthiasAPIClient(player)
    name = name or media_file.name

    now = timezone.now()
    start_date = start_date or now.strftime('%Y-%m-%dT%H:%M:%S.000Z')
    # Anthias's own Asset.is_active() treats a null end_date as "never
    # active" (it requires both bounds to be set), so "no expiration"
    # can't be a real null — approximate it with a far-future date
    # instead, unless the caller passed an explicit end_date (a
    # deliberately temporary/scheduled deployment).
    end_date = end_date or (now + timedelta(days=3650)).strftime('%Y-%m-%dT%H:%M:%S.000Z')

    if media_file.file:
        old_timeout = client.timeout
        client.timeout = 60
        try:
            media_file.file.open('rb')
            upload_result = client.upload_file(media_file.file)
            media_file.file.close()
        finally:
            client.timeout = old_timeout

        mimetype = ASSET_MIMETYPE_MAP.get(media_file.file_type, 'image')
        # Video duration must be 0 — Anthias auto-detects it
        asset_duration = 0 if mimetype == 'video' else duration
        asset_data = {
            'name': name,
            'uri': upload_result.get('uri', ''),
            'ext': upload_result.get('ext', ''),
            'mimetype': mimetype,
            'is_enabled': True,
            'nocache': False,
            'start_date': start_date,
            'end_date': end_date,
            'duration': asset_duration,
            'skip_asset_check': False,
        }
    else:
        uri = media_file.source_url
        if media_file.file_type == 'cctv' and uri.startswith('/') and base_url:
            uri = f'{base_url}{uri}'
        asset_data = {
            'name': name,
            'uri': uri,
            'mimetype': 'webpage',
            'is_enabled': True,
            'nocache': False,
            'start_date': start_date,
            'end_date': end_date,
            'duration': duration,
            'skip_asset_check': False,
        }

    return client.create_asset(asset_data)

