"""Custom first-party weather widget — a small, animated, fully
translated alternative to pulling in an external app from
signage-apps.com for this specific case. Fetches from Open-Meteo (free,
no API key, generous rate limits) server-side and renders a full-
screen HTML page with CSS-driven weather animations. Used exactly like
any other web-source content item (source_url pointing here) — see
static/src/components/deploy/apps-tab.tsx, which offers it alongside
the external app catalog as a "MupiTech" first-party entry.
"""
import logging

import requests
from django.shortcuts import render
from django.views.decorators.clickjacking import xframe_options_exempt

logger = logging.getLogger(__name__)

# WMO weather interpretation codes (used by Open-Meteo) collapsed into
# the handful of animation buckets weather_widget.html knows how to
# draw — see https://open-meteo.com/en/docs#weathervariables for the
# full table this is derived from.
_CONDITION_BUCKETS = {
    0: 'clear',
    1: 'partly-cloudy', 2: 'partly-cloudy',
    3: 'cloudy',
    45: 'fog', 48: 'fog',
    51: 'drizzle', 53: 'drizzle', 55: 'drizzle', 56: 'drizzle', 57: 'drizzle',
    61: 'rain', 63: 'rain', 65: 'rain', 66: 'rain', 67: 'rain',
    71: 'snow', 73: 'snow', 75: 'snow', 77: 'snow',
    80: 'rain', 81: 'rain', 82: 'rain',
    85: 'snow', 86: 'snow',
    95: 'thunderstorm', 96: 'thunderstorm', 99: 'thunderstorm',
}

_DEFAULT_LAT, _DEFAULT_LNG = 38.7223, -9.1393  # Lisbon — a sane fallback rather than a blank page


def _condition_for(code, is_day):
    bucket = _CONDITION_BUCKETS.get(code, 'cloudy')
    if is_day:
        return bucket
    if bucket == 'clear':
        return 'clear-night'
    if bucket == 'partly-cloudy':
        return 'partly-cloudy-night'
    return bucket


@xframe_options_exempt
def weather_widget(request):
    """Public, unauthenticated — same trust model as any other web-
    source content a device embeds directly (and, unlike
    cctv_player_view's same-origin-only preview, this has to be
    frameable from whatever origin the *device* itself serves its
    dashboard from, hence xframe_options_exempt rather than
    xframe_options_sameorigin)."""
    try:
        lat = float(request.GET.get('lat', ''))
        lng = float(request.GET.get('lng', ''))
    except (TypeError, ValueError):
        lat, lng = _DEFAULT_LAT, _DEFAULT_LNG

    context = {
        'condition': 'clear',
        'temp': None,
        'temp_min': None,
        'temp_max': None,
        'place': request.GET.get('place', 'Lisboa'),
        'error': False,
        # 'rain' falls faster/longer than a light 'drizzle' — computed
        # here rather than with the template's {% if %}/yesno (yesno
        # treats any non-empty string as truthy, so it can't branch on
        # which *specific* condition this is).
        'drop_height': '10px',
        'drop_duration': '1.4s',
    }
    try:
        resp = requests.get(
            'https://api.open-meteo.com/v1/forecast',
            params={
                'latitude': lat,
                'longitude': lng,
                'current_weather': 'true',
                'daily': 'temperature_2m_max,temperature_2m_min',
                'timezone': 'auto',
            },
            timeout=8,
        )
        resp.raise_for_status()
        data = resp.json()
        current = data.get('current_weather') or {}
        daily = data.get('daily') or {}

        temp = current.get('temperature')
        context['temp'] = round(temp) if temp is not None else None
        context['condition'] = _condition_for(current.get('weathercode', 0), current.get('is_day', 1))

        highs = daily.get('temperature_2m_max') or []
        lows = daily.get('temperature_2m_min') or []
        context['temp_max'] = round(highs[0]) if highs else None
        context['temp_min'] = round(lows[0]) if lows else None

        if context['condition'] == 'rain':
            context['drop_height'] = '16px'
            context['drop_duration'] = '0.8s'
    except Exception as exc:
        logger.warning('Weather widget fetch failed (lat=%s, lng=%s): %s', lat, lng, exc)
        context['error'] = True

    return render(request, 'weather_widget.html', context)
