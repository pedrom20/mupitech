"""
Custom DRF permission classes for role-based access control.

Four roles: viewer (read-only), editor (viewer + create/update),
admin (full access except superadmin-only areas, e.g. Tailscale),
superadmin (full access to everything, backed by Django's is_superuser).
Non-superadmin roles are stored as Django Group memberships.
"""

from rest_framework.permissions import BasePermission


def _user_role(user):
    """Return the highest role for a user: superadmin > admin > editor > viewer."""
    if not user or not user.is_authenticated:
        return None
    if user.is_superuser:
        return 'superadmin'
    groups = set(user.groups.values_list('name', flat=True))
    if 'superadmin' in groups:
        return 'superadmin'
    if 'admin' in groups:
        return 'admin'
    if 'editor' in groups:
        return 'editor'
    if 'viewer' in groups:
        return 'viewer'
    # Authenticated user with no group — treat as viewer
    return 'viewer'


class IsViewer(BasePermission):
    """Any authenticated user (read-only access)."""

    def has_permission(self, request, view):
        return request.user and request.user.is_authenticated


class IsEditor(BasePermission):
    """User in editor, admin or superadmin group (create/update)."""

    def has_permission(self, request, view):
        role = _user_role(request.user)
        return role in ('editor', 'admin', 'superadmin')


class IsAdmin(BasePermission):
    """Admin or superadmin (full access to everything except superadmin-only areas)."""

    def has_permission(self, request, view):
        role = _user_role(request.user)
        return role in ('admin', 'superadmin')


class IsSuperAdmin(BasePermission):
    """Superadmin only — for areas even an admin shouldn't see (e.g. Tailscale)."""

    def has_permission(self, request, view):
        return _user_role(request.user) == 'superadmin'


class IsEditorOrReadOnly(BasePermission):
    """Editor/admin/superadmin for write ops; any authenticated user for read."""

    def has_permission(self, request, view):
        if not request.user or not request.user.is_authenticated:
            return False
        if request.method in ('GET', 'HEAD', 'OPTIONS'):
            return True
        return _user_role(request.user) in ('editor', 'admin', 'superadmin')


class IsAdminOrReadOnly(BasePermission):
    """Admin/superadmin for write ops; any authenticated user for read."""

    def has_permission(self, request, view):
        if not request.user or not request.user.is_authenticated:
            return False
        if request.method in ('GET', 'HEAD', 'OPTIONS'):
            return True
        return _user_role(request.user) in ('admin', 'superadmin')
