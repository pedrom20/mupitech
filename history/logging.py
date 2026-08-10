"""Audit logging utility.

This module is the only sanctioned entry point other apps should import
from `history` — everything else here (models, views, serializers) is
private to this app. A Django-signal-based dispatch (other apps `.send()`,
`history` listens) would be a valid future upgrade if more apps need to
react to actions beyond just logging, but is unnecessary complexity today
given this is a single fire-and-forget logging call.
"""

import logging

logger = logging.getLogger(__name__)


def log_action(request, action, target_type, target_id='', target_name='', details=None):
    """Create an AuditLog entry from a DRF request."""
    from .models import AuditLog

    user = None
    if request and hasattr(request, 'user') and request.user.is_authenticated:
        user = request.user

    ip_address = None
    if request:
        ip_address = (
            request.META.get('HTTP_X_FORWARDED_FOR', '').split(',')[0].strip()
            or request.META.get('REMOTE_ADDR')
        )

    try:
        AuditLog.objects.create(
            user=user,
            action=action,
            target_type=target_type,
            target_id=str(target_id) if target_id else '',
            target_name=str(target_name),
            details=details or {},
            ip_address=ip_address,
        )
    except Exception:
        logger.warning('Failed to create audit log entry', exc_info=True)
