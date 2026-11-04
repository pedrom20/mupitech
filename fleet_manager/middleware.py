"""Blocks a pending Microsoft 365 account (access/models.py::
UserAccessScope.pending_approval) from the API, not just the frontend's
routing (static/src/components/app.tsx). Most endpoints in this project
rely on DRF's global IsAuthenticated default rather than one of the
role-aware classes in fleet_manager/permissions.py, so fixing those alone
would still leave a pending user able to call anything a plain session
grants — this is the one place that catches all of them regardless.

Reads request.user as resolved by Django's own session-based
AuthenticationMiddleware (below this one in MIDDLEWARE), not DRF's
TokenAuthentication — a pending account always has set_unusable_password()
(see fleet_manager/m365_backend.py::get_or_create_user), so it can never
obtain a token via /api/auth/token/ (which requires a working password)
in the first place.
"""

from django.http import JsonResponse

_ALLOWED_PATHS = {
    '/api/users/me/',
    '/api/auth/logout/',
    '/api/auth/status/',
}


class PendingApprovalMiddleware:
    def __init__(self, get_response):
        self.get_response = get_response

    def __call__(self, request):
        if request.path.startswith('/api/') and request.path not in _ALLOWED_PATHS:
            user = request.user
            if user.is_authenticated:
                scope = getattr(user, 'access_scope', None)
                if scope and scope.pending_approval:
                    return JsonResponse(
                        {'detail': 'Account pending approval.'}, status=403,
                    )
        return self.get_response(request)
