"""Filters the content library (folders + files) down to what an
editor's access.models.UserAccessScope allows them to see — same
"unrestricted unless scoped" convention as access/scoping.py, which
this reuses directly for the location/group id resolution rather than
re-deriving it.

A folder is visible if: the user is unrestricted (admin/superadmin, or
an editor with an empty scope), OR the folder (or its nearest scoped
ancestor — see MediaFolder.effective_location/effective_group/
effective_is_common) is marked common, OR its effective location/group
is one the user is allowed to see.

A file with no folder (root-level content) is visible to admins/
superadmins/viewers unconditionally, but to editors only if an admin
has opted that in via ROOT_CONTENT_VISIBLE_KEY (Settings > Content
Library) — defaults to hidden, since unorganized root content is
usually meant for whoever uploaded it, not the whole editor pool.
"""
from django.core.cache import cache
from django.db.models import Q

from access.scoping import allowed_group_ids, allowed_location_ids, is_restricted

ROOT_CONTENT_VISIBLE_KEY = 'content:root_visible_to_editors'


def is_root_content_visible_to_editors():
    return bool(cache.get(ROOT_CONTENT_VISIBLE_KEY, False))


def set_root_content_visible_to_editors(visible):
    cache.set(ROOT_CONTENT_VISIBLE_KEY, bool(visible), None)


def _visible_folder_ids(user):
    """None if unrestricted (caller should skip filtering entirely),
    otherwise the set of MediaFolder ids this user may see."""
    if not is_restricted(user):
        return None

    from .models import MediaFolder

    location_ids = allowed_location_ids(user) or set()
    group_ids = allowed_group_ids(user) or set()

    visible = set()
    # Folder trees are small (a content library, not a filesystem) —
    # one query plus an in-Python walk is simpler and fast enough here,
    # versus a recursive CTE this app has no existing precedent for.
    all_folders = list(MediaFolder.objects.all())
    by_id = {f.id: f for f in all_folders}

    for folder in all_folders:
        # Walk via the prefetched dict instead of folder.parent (which
        # would issue a query per hop) — same effective_* logic as the
        # model properties, just backed by the in-memory map above.
        node, seen, is_common, eff_location_id, eff_group_id = folder, set(), False, None, None
        while node is not None and node.pk not in seen:
            if node.is_common:
                is_common = True
            if eff_location_id is None and node.location_id:
                eff_location_id = node.location_id
            if eff_group_id is None and node.group_id:
                eff_group_id = node.group_id
            seen.add(node.pk)
            node = by_id.get(node.parent_id) if node.parent_id else None

        if is_common or eff_location_id in location_ids or eff_group_id in group_ids:
            visible.add(folder.id)

    return visible


def filter_folders(queryset, user):
    ids = _visible_folder_ids(user)
    return queryset if ids is None else queryset.filter(id__in=ids)


def filter_media_files(queryset, user):
    from fleet_manager.permissions import _user_role
    hide_root = _user_role(user) == 'editor' and not is_root_content_visible_to_editors()

    ids = _visible_folder_ids(user)
    if ids is None:
        return queryset.exclude(folder__isnull=True) if hide_root else queryset
    if hide_root:
        return queryset.filter(folder_id__in=ids)
    return queryset.filter(Q(folder__isnull=True) | Q(folder_id__in=ids))
