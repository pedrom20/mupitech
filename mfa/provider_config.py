"""DB-backed configuration for MFA providers (Duo, privacyIDEA,
AuthPoint) — lets an admin set these credentials from the Settings UI
instead of only via container env vars + a redeploy. A field set in
the DB overrides the matching env var; a field left unset there still
falls back to its env var, so an existing env-var-only deployment
keeps working unchanged after this was added.

Each provider's config is a small dict of string fields (declared in
FIELDS below), stored as one Fernet-encrypted JSON blob per provider
row (mfa.models.MFAProviderConfig) — same key as mfa/crypto.py's TOTP
secrets. Fields marked secret=True in FIELDS are write-only from the
API's perspective (mfa/views.py never returns their value, only
whether one is set) and, on save, an empty submitted value leaves the
existing stored secret untouched rather than blanking it — the same
"leave blank to keep" convention as changing your own password.
"""

import json

from django.conf import settings

from .crypto import decrypt_secret, encrypt_secret

# (field name, is_secret, env var name or None if there's no env-var
# fallback for that field/provider).
FIELDS = {
    'duo': [
        ('ikey', False, 'DUO_IKEY'),
        ('skey', True, 'DUO_SKEY'),
        ('host', False, 'DUO_HOST'),
    ],
    'privacyidea': [
        ('url', False, 'PRIVACYIDEA_URL'),
        ('admin_user', False, 'PRIVACYIDEA_ADMIN_USER'),
        ('admin_password', True, 'PRIVACYIDEA_ADMIN_PASSWORD'),
        ('realm', False, 'PRIVACYIDEA_REALM'),
    ],
    'authpoint': [
        ('client_id', False, None),
        ('client_secret', True, None),
    ],
}


def _stored(provider):
    from .models import MFAProviderConfig

    row = MFAProviderConfig.objects.filter(provider=provider).first()
    if not row or not row.config_encrypted:
        return {}
    try:
        return json.loads(decrypt_secret(row.config_encrypted))
    except Exception:
        return {}


def get_config(provider):
    """Merged {field: value} for `provider` — DB value wins per-field
    over the matching env var. Used internally by each provider's own
    module (duo.py, privacyidea.py) instead of reading settings.* or
    os.environ directly."""
    stored = _stored(provider)
    config = {}
    for name, _secret, env_var in FIELDS[provider]:
        value = stored.get(name) or ''
        if not value and env_var:
            value = getattr(settings, env_var, '') or ''
        config[name] = value
    return config


def is_configured(provider):
    config = get_config(provider)
    return all(config.get(name) for name, _secret, _env in FIELDS[provider])


def status_for_ui(provider):
    """Shape the Settings UI actually reads: non-secret fields return
    their current merged value (so an admin can see/edit them),
    secret fields return only whether one is set — never the value
    itself, matching Player.password's write-only API convention."""
    stored = _stored(provider)
    merged = get_config(provider)
    result = {'configured': is_configured(provider)}
    for name, secret, _env in FIELDS[provider]:
        if secret:
            result[name] = {'set': bool(merged.get(name))}
        else:
            result[name] = merged.get(name, '')
    return result


def save_config(provider, submitted, updated_by=None):
    """Persist admin-submitted values for `provider`. Unknown keys are
    ignored; a blank secret field keeps the existing stored secret
    (doesn't overwrite with empty); a blank non-secret field clears
    the DB override (falls back to its env var again, if any)."""
    from .models import MFAProviderConfig

    stored = _stored(provider)
    for name, secret, _env in FIELDS[provider]:
        if name not in submitted:
            continue
        value = (submitted.get(name) or '').strip()
        if secret and not value:
            continue  # leave-blank-to-keep
        stored[name] = value

    row, _created = MFAProviderConfig.objects.get_or_create(provider=provider)
    row.config_encrypted = encrypt_secret(json.dumps(stored))
    row.updated_by = updated_by
    row.save(update_fields=['config_encrypted', 'updated_by', 'updated_at'])
