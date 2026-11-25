"""Resolve which locations/groups/players a user may see and control.

Bypassed entirely for admins (superuser, 'admin' or 'admin_viewer' role
group), same as the rest of the permission system in
fleet_manager/permissions.py. admin_viewer's WRITE access is still
restricted per-device — see fleet_manager/permissions.py::
has_granted_device_access — but that's a separate, write-only check,
not visibility, so it doesn't belong in is_restricted() here.
"""

from fleet_manager.permissions import _user_role


def get_scope(user):
    if not user or not user.is_authenticated:
        return None
    return getattr(user, 'access_scope', None)


def is_restricted(user):
    # admin_viewer's visibility is always global too, same as admin —
    # only its WRITE access is ever device-scoped (see
    # fleet_manager/permissions.py::has_granted_device_access).
    if _user_role(user) in ('admin', 'superadmin', 'admin_viewer'):
        return False
    scope = get_scope(user)
    return bool(scope and scope.is_restricted())


def allowed_location_ids(user):
    """Location IDs the user may access, or None if unrestricted."""
    if not is_restricted(user):
        return None
    scope = get_scope(user)
    return set(scope.locations.values_list('id', flat=True))


def allowed_group_ids(user):
    """Group IDs the user may access, or None if unrestricted."""
    if not is_restricted(user):
        return None
    from groups.models import Group
    scope = get_scope(user)
    location_ids = allowed_location_ids(user)
    ids = set(scope.groups.values_list('id', flat=True))
    ids |= set(Group.objects.filter(location_id__in=location_ids).values_list('id', flat=True))
    return ids


def allowed_player_ids(user):
    """Player IDs the user may access, or None if unrestricted."""
    if not is_restricted(user):
        return None
    from players.models import Player
    scope = get_scope(user)
    location_ids = allowed_location_ids(user)
    group_ids = allowed_group_ids(user)
    ids = set(scope.players.values_list('id', flat=True))
    ids |= set(Player.objects.filter(group_id__in=group_ids).values_list('id', flat=True))
    ids |= set(Player.objects.filter(location_id__in=location_ids).values_list('id', flat=True))
    return ids


def filter_locations(queryset, user):
    ids = allowed_location_ids(user)
    return queryset if ids is None else queryset.filter(id__in=ids)


def filter_groups(queryset, user):
    ids = allowed_group_ids(user)
    return queryset if ids is None else queryset.filter(id__in=ids)


def filter_players(queryset, user):
    ids = allowed_player_ids(user)
    return queryset if ids is None else queryset.filter(id__in=ids)
