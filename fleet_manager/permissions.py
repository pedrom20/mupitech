"""
Custom DRF permission classes for role-based access control.

Five roles: viewer (read-only), editor_simplificado (viewer + create/
update, same as editor, but can't change which devices/groups/
locations a playlist targets — see playlists/serializers.py), editor
(full create/update), admin (full access except superadmin-only areas,
e.g. Tailscale), superadmin (full access to everything, backed by
Django's is_superuser). Non-superadmin roles are stored as Django Group
memberships.

editor_simplificado is a restricted variant of editor, not a separate
tier below it in capability — EDITOR_ROLES below is the tuple to use
anywhere the old code just checked role == 'editor', so both count
equally except at the one specific playlist-target check that exists
to distinguish them.
"""

from rest_framework.permissions import BasePermission

EDITOR_ROLES = ('editor', 'editor_simplificado')


def _user_role(user):
    """Return the highest role for a user: superadmin > admin > editor >
    editor_simplificado > viewer. None means no access at all — either
    not authenticated, or a Microsoft 365 first-login account still
    awaiting an admin to assign it a role (access/models.py::
    UserAccessScope.pending_approval) — unlike every other groupless
    authenticated user below, which defaults to viewer."""
    if not user or not user.is_authenticated:
        return None
    if getattr(user, 'access_scope', None) and user.access_scope.pending_approval:
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
    if 'editor_simplificado' in groups:
        return 'editor_simplificado'
    if 'viewer' in groups:
        return 'viewer'
    # Authenticated user with no group — treat as viewer
    return 'viewer'


class IsViewer(BasePermission):
    """Any authenticated user with a role (read-only access) — not just
    anyone with a session, so a pending M365 account (_user_role() ==
    None) doesn't get in here just by being authenticated."""

    def has_permission(self, request, view):
        return _user_role(request.user) is not None


class IsEditor(BasePermission):
    """User in editor, editor_simplificado, admin or superadmin group (create/update)."""

    def has_permission(self, request, view):
        role = _user_role(request.user)
        return role in (*EDITOR_ROLES, 'admin', 'superadmin')


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
    """Editor/admin/superadmin for write ops; any user with a role for read."""

    def has_permission(self, request, view):
        role = _user_role(request.user)
        if role is None:
            return False
        if request.method in ('GET', 'HEAD', 'OPTIONS'):
            return True
        return role in (*EDITOR_ROLES, 'admin', 'superadmin')


def user_can_delete_content(user):
    """Whether this user may delete library content/branding images. Superadmins
    always can; editors/admins default to allowed but can be individually
    opted out via UserAccessScope.can_delete_content (see access/models.py)."""
    role = _user_role(user)
    if role == 'superadmin':
        return True
    if role not in (*EDITOR_ROLES, 'admin'):
        return False
    scope = getattr(user, 'access_scope', None)
    return scope.can_delete_content if scope else True


class IsAdminOrReadOnly(BasePermission):
    """Admin/superadmin for write ops; any user with a role for read."""

    def has_permission(self, request, view):
        role = _user_role(request.user)
        if role is None:
            return False
        if request.method in ('GET', 'HEAD', 'OPTIONS'):
            return True
        return role in ('admin', 'superadmin')
