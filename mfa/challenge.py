"""Shared "a single MFA factor just verified — now what?" logic, used by
every provider's login-time verify endpoint in fleet_manager/urls.py
(auth_mfa_verify, auth_privacyidea_verify, auth_duo_verify,
auth_privacyidea_push_verify).

Before dual-MFA, "now what" was always the same one-liner: delete the
cache entry, call login(), return {success}. Centralizing it here means
that logic — and the dual-factor branch added on top of it — exists in
exactly one place instead of duplicated (and potentially drifting) across
four view functions that otherwise each check a different provider.
"""
import logging

from django.contrib.auth import login
from django.contrib.auth.models import User
from django.core.cache import cache
from django.utils import timezone
from rest_framework.response import Response

logger = logging.getLogger(__name__)

CHALLENGE_TTL = 300


def register_factor_success(request, challenge_id, entry, provider_key, log_label=None):
    """Call this instead of `login(request, user)` from a verify
    endpoint's success branch. `entry` is the cache dict already fetched
    by the caller (must still contain 'user_id'; 'passed_methods' may be
    absent, treated as []). `provider_key` is which provider ('totp',
    'duo', 'privacyidea', 'authpoint') just succeeded.

    Single-factor case (the vast majority): finalizes the session and
    returns {success, username}, same shape every verify endpoint
    already returned before dual-MFA existed.

    Dual-factor case: if `entry['dual_required']` is set and this is
    only the first of the two providers passed so far, does NOT log the
    user in yet — advances the cache entry to a second challenge against
    a different enrolled provider and returns {mfa_required, stage: 2,
    ...} instead, the same shape auth_login's initial mfa_required
    response has, so the frontend can reuse its existing challenge UI.
    """
    from history.logging import log_action
    from .providers import enrolled_methods, push_methods

    label = log_label or provider_key
    cache_key = f'mfa_challenge:{challenge_id}'
    user = User.objects.get(pk=entry['user_id'])
    passed = entry.get('passed_methods', []) + [provider_key]

    if entry.get('dual_required') and len(passed) < 2:
        remaining = [m for m in enrolled_methods(user) if m not in passed]
        if remaining:
            entry['passed_methods'] = passed
            entry['method'] = remaining[0]
            entry['attempts'] = 0
            cache.set(cache_key, entry, timeout=CHALLENGE_TTL)
            log_action(request, 'login_factor_passed', 'session',
                       target_name=user.username, details={'mfa': label})
            return Response({
                'mfa_required': True,
                'stage': 2,
                'challenge_id': challenge_id,
                'method': remaining[0],
                'available_methods': remaining,
                'push_methods': [m for m in push_methods(user) if m in remaining],
                'first_method_passed': provider_key,
            })
        # Shouldn't happen — auth_login only sets dual_required when the
        # user has 2+ enrolled providers — but if it ever does (e.g. the
        # user disabled their second method mid-login), degrade to
        # single-factor rather than strand them with no way to finish.
        logger.warning(
            'dual_required challenge for %s had no second distinct provider left; '
            'completing login on %s alone', user.username, provider_key,
        )

    cache.delete(cache_key)
    _mark_last_used(user, provider_key)
    # Two-factor logins log the full sequence (e.g. ['duo', 'totp']); a
    # single-factor login logs just its provider label (which, unlike
    # provider_key, still distinguishes e.g. 'privacyidea-push' from a
    # plain 'privacyidea' code — see auth_privacyidea_push_verify's call).
    mfa_detail = passed if entry.get('passed_methods') else label

    if entry.get('device_login'):
        # A device relaying typed FM credentials (see
        # fleet_manager/urls.py::auth_device_login) has no use for an FM
        # session — it's establishing its *own*, separate local session
        # once it trusts these credentials. Skip login() entirely and
        # hand back the role the device needs to stash, same shape
        # auth_device_login's own password-only success path returns.
        from fleet_manager.permissions import _user_role
        log_action(request, 'login', 'session', target_name=user.username,
                   details={'mfa': mfa_detail, 'via': 'device_login'})
        return Response({'success': True, 'username': user.username, 'role': _user_role(user)})

    login(request, user)
    log_action(request, 'login', 'session', target_name=user.username, details={'mfa': mfa_detail})
    return Response({'success': True, 'username': user.username})


def _mark_last_used(user, provider_key):
    """Stamp last_used_at on whichever enrollment model backs
    provider_key — each verify endpoint used to do this inline right
    before its own login() call; now centralized alongside it."""
    if provider_key == 'totp':
        device = getattr(user, 'totp_device', None)
        if device:
            device.last_used_at = timezone.now()
            device.save(update_fields=['last_used_at'])
    elif provider_key == 'duo':
        enrollment = getattr(user, 'duo_enrollment', None)
        if enrollment:
            enrollment.last_used_at = timezone.now()
            enrollment.save(update_fields=['last_used_at'])
    elif provider_key == 'privacyidea':
        enrollment = getattr(user, 'privacyidea_enrollment', None)
        if enrollment:
            enrollment.last_used_at = timezone.now()
            enrollment.save(update_fields=['last_used_at'])
