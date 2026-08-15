"""Placeholder for a future WatchGuard AuthPoint integration — explicitly
NOT implemented yet. Registered in mfa/providers.py so it shows up
consistently as "not configured" (never available to enroll or log in
with) rather than needing special-casing elsewhere, and so a future
implementer has one obvious file to fill in.

authpoint_configured() always returns False here — there is no working
integration behind it. What's actually needed to build one:

  1. An AuthPoint tenant + API credentials. WatchGuard's AuthPoint API
     uses an API key + API client id/secret pair issued from the
     WatchGuard Cloud portal (Account Management > API Access), not
     OAuth2 in the "redirect the browser" sense — closer to Duo's
     ikey/skey model. Auth flow: exchange the client id/secret for a
     bearer access token (POST to WatchGuard's identity endpoint),
     then call AuthPoint's own REST API with that token.
  2. AuthPoint's push-auth endpoint (equivalent to mfa/duo.py's
     push_auth()) — trigger a push to the user's AuthPoint Mobile app
     and poll/block for the result. AuthPoint token/user identifiers
     don't map 1:1 to Duo's, so this needs its own request/response
     shapes, not a copy-paste of duo.py.
  3. A `AuthPointEnrollment` model (mirrors DuoEnrollment) — AuthPoint
     enrollment is typically provisioned from the WatchGuard Cloud admin
     console rather than a self-service QR flow like Duo/privacyIDEA,
     so "enrollment" here may just mean recording which AuthPoint user
     identity a Fleet Manager user maps to, not a code path a user
     walks through on the Security page.
  4. mfa/views.py + fleet_manager/urls.py additions mirroring the Duo
     ones (authpoint_status/enroll/confirm/disable, auth_authpoint_verify)
     once the above exists — same shape, not started here.

None of this is wired up — authpoint_configured() below always returns
False, deliberately, until an implementation actually exists behind it.
"""


def authpoint_configured():
    return False
