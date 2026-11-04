"""Login com Microsoft 365 / Entra ID — Authorization Code flow via msal,
seguindo o mesmo padrão "pronto mas desligado" do fleet_manager/ldap_backend.py:
inerte (msal nunca é importado) até as três env vars abaixo estarem definidas,
para que uma instalação que não o configure não pague custo nenhum por isto
existir.

O Entra ID exige que o redirect URI registado na app seja https:// — ver
nginx-entrypoint.sh/.env.example (WEB_SSL_PORT) para o certificado
autoassinado que este deployment usa para isso, já que essa validação é só
sobre a *forma* do URL (não liga de verdade ao servidor), um autoassinado
chega.

Diferente do LDAP (que se liga a AUTHENTICATION_BACKENDS e passa por
authenticate()), este fluxo é tratado diretamente pelas views
auth_m365_login/auth_m365_callback em fleet_manager/urls.py — não há
password nenhuma para o Django validar aqui, só um id_token já validado
pela própria Microsoft.

Env vars (as três juntas — ver .env.example):
  MICROSOFT_TENANT_ID
  MICROSOFT_CLIENT_ID
  MICROSOFT_CLIENT_SECRET
"""

import logging
import os

from django.conf import settings

logger = logging.getLogger(__name__)

_SCOPES = ['User.Read', 'email']


def m365_configured():
    return bool(
        os.environ.get('MICROSOFT_TENANT_ID')
        and os.environ.get('MICROSOFT_CLIENT_ID')
        and os.environ.get('MICROSOFT_CLIENT_SECRET')
    )


def _msal_app():
    import msal

    return msal.ConfidentialClientApplication(
        settings.MICROSOFT_CLIENT_ID,
        client_credential=settings.MICROSOFT_CLIENT_SECRET,
        authority=f'https://login.microsoftonline.com/{settings.MICROSOFT_TENANT_ID}',
    )


def _redirect_uri(request):
    base = settings.FM_PUBLIC_URL or request.build_absolute_uri('/').rstrip('/')
    return f'{base}/api/auth/m365/callback/'


def start_flow(request):
    """Begins the Authorization Code flow: stashes the flow's state in the
    session (needed by complete_flow to validate the callback) and returns
    the Microsoft login URL to redirect the browser to."""
    flow = _msal_app().initiate_auth_code_flow(_SCOPES, redirect_uri=_redirect_uri(request))
    request.session['m365_flow'] = flow
    return flow['auth_uri']


def _graph_profile(access_token):
    """The ID token's own 'email' claim is an optional claim — only
    present when requested, and even then not reliably the account's
    real mailbox (can fall back to the UPN, which for plenty of tenants
    is a different address than the one the person actually reads, e.g.
    "pmartinho@..." vs their real "pedro.martinho@..." mailbox). Graph's
    own profile is the authoritative source, and User.Read (already
    requested for login) is enough to read it. Best-effort: any failure
    here just means get_or_create_user falls back to the id_token claims
    (preferred_username) same as before, not a login failure."""
    import requests

    try:
        resp = requests.get(
            'https://graph.microsoft.com/v1.0/me',
            headers={'Authorization': f'Bearer {access_token}'},
            params={'$select': 'mail,userPrincipalName,givenName,surname'},
            timeout=10,
        )
        resp.raise_for_status()
        data = resp.json()
    except requests.RequestException as exc:
        body = getattr(exc.response, 'text', '')
        logger.warning('M365 Graph /me call failed: %s %s', exc, body)
        return {}

    logger.info('M365 Graph /me response: %s', data)
    profile = {}
    if data.get('mail'):
        profile['email'] = data['mail']
    if data.get('givenName'):
        profile['given_name'] = data['givenName']
    if data.get('surname'):
        profile['family_name'] = data['surname']
    return profile


def complete_flow(request):
    """Validates the callback against the stashed flow and exchanges the
    auth code for tokens. Returns the claims dict (email, name, ...) on
    success — Graph's own profile (see _graph_profile) takes priority
    over the id_token's own claims, when available — raises ValueError on
    any failure (expired/missing flow, state mismatch, token error) —
    callers should treat that as "send the user back to /login"."""
    flow = request.session.pop('m365_flow', None)
    if not flow:
        raise ValueError('No pending Microsoft login flow for this session.')

    result = _msal_app().acquire_token_by_auth_code_flow(flow, request.GET.dict())
    if 'error' in result:
        raise ValueError(result.get('error_description', result['error']))

    claims = result.get('id_token_claims')
    if not claims or not claims.get('preferred_username'):
        raise ValueError('Microsoft did not return an email/UPN for this account.')
    logger.info('M365 id_token claims: %s', claims)

    merged = {**claims, **_graph_profile(result['access_token'])}
    logger.info('M365 claims used for account matching: %s', merged)
    return merged


def get_or_create_user(claims):
    """Matches the Microsoft account to a local User by email, case-
    insensitive — this is also how an admin "links" an existing account
    (edit its email to the M365 UPN on the Users page) or pre-provisions
    one with a role already assigned (create it with that email upfront).
    Only a genuinely new account (no match at all) gets auto-created here,
    with no password and no role, and flagged pending_approval — see
    access/models.py::UserAccessScope and permissions.py::_user_role for
    what that blocks until an admin assigns a role."""
    from django.contrib.auth.models import User

    from access.models import UserAccessScope

    email = claims.get('email') or claims['preferred_username']
    first_name = claims.get('given_name', '')
    last_name = claims.get('family_name', '')

    user = User.objects.filter(email__iexact=email).first()
    if user is None:
        user = User.objects.create(
            username=email,
            email=email,
            first_name=first_name,
            last_name=last_name,
        )
        user.set_unusable_password()
        user.save(update_fields=['password'])
        UserAccessScope.objects.create(user=user, pending_approval=True)
    elif user.first_name != first_name or user.last_name != last_name:
        user.first_name = first_name
        user.last_name = last_name
        user.save(update_fields=['first_name', 'last_name'])
    return user
