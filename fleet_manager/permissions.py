"""
Custom DRF permission classes for role-based access control.

Seven roles: viewer (read-only), editor_simplificado (viewer + create/
update, same as editor, but can't change which devices/groups/
locations a playlist targets — see PLAYLIST_TARGET_RESTRICTED_ROLES
below — and whose content-library visibility follows their
access.models.UserAccessScope same as any other restricted role),
editor_simplificado_full (identical to editor_simplificado in every
respect except one: always sees the full content library — every
folder and all root-level content — regardless of their own scope and
regardless of Settings > Content Library's root-visibility toggle; see
content/scoping.py), editor (full create/update), admin_viewer (sees
everything an admin sees — reports, users, settings — but can only
write to devices explicitly granted via access/models.py::
UserAccessScope.admin_players; see has_granted_device_access below),
admin (full access except superadmin-only areas, e.g. Tailscale),
superadmin (full access to everything, backed by Django's
is_superuser). Non-superadmin roles are stored as Django Group
memberships.

editor_simplificado (and editor_simplificado_full) are restricted
variants of editor, not a separate tier below it in capability —
EDITOR_ROLES below is the tuple to use anywhere the old code just
checked role == 'editor', so all three count equally except at the
playlist-target check (PLAYLIST_TARGET_RESTRICTED_ROLES) and content
visibility (content/scoping.py), which exist to distinguish them.
"""

from rest_framework.permissions import BasePermission

EDITOR_ROLES = ('editor', 'editor_simplificado', 'editor_simplificado_full')

# The one behaviour editor_simplificado and editor_simplificado_full
# share with each other but not with plain 'editor' — see
# playlists/views.py::remove_from_devices, playlists/serializers.py,
# content/serializers.py and footer_messages/serializers.py, the four
# places that block changing which devices/groups/locations something
# targets.
PLAYLIST_TARGET_RESTRICTED_ROLES = ('editor_simplificado', 'editor_simplificado_full')


def _user_role(user):
    """Return the highest role for a user: superadmin > admin >
    admin_viewer > editor > editor_simplificado_full > editor_simplificado
    > viewer. None means no
    access at all — either not authenticated, or a Microsoft 365
    first-login account still awaiting an admin to assign it a role
    (access/models.py::UserAccessScope.pending_approval) — unlike every
    other groupless authenticated user below, which defaults to viewer."""
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
    if 'admin_viewer' in groups:
        return 'admin_viewer'
    if 'editor' in groups:
        return 'editor'
    if 'editor_simplificado_full' in groups:
        return 'editor_simplificado_full'
    if 'editor_simplificado' in groups:
        return 'editor_simplificado'
    if 'viewer' in groups:
        return 'viewer'
    # Authenticated user with no group — treat as viewer
    return 'viewer'


def has_granted_device_access(user, player_pk):
    """Whether this user (expected to be admin_viewer, but harmless for
    any role) has been explicitly granted full admin-equivalent control
    over this specific device — access/models.py::UserAccessScope.
    admin_players."""
    scope = getattr(user, 'access_scope', None)
    return bool(scope and scope.admin_players.filter(pk=player_pk).exists())


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


class IsAdminOrAdminViewerReadOnly(BasePermission):
    """Admin/superadmin for everything; admin_viewer for read (GET/HEAD/
    OPTIONS) only — same areas an admin sees (reports, users list,
    settings), but never allowed to write them. Drop-in replacement for
    IsAdmin on a view/viewset that should now also admit admin_viewer's
    read-only visibility."""

    def has_permission(self, request, view):
        role = _user_role(request.user)
        if role in ('admin', 'superadmin'):
            return True
        if role == 'admin_viewer':
            return request.method in ('GET', 'HEAD', 'OPTIONS')
        return False
