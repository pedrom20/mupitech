# privacyIDEA — standalone deployment

A self-hosted privacyIDEA server for the Fleet Manager's optional third
MFA provider (`mfa/privacyidea.py`). Runs on its own server, separate
from the Fleet Manager's own docker-compose stack.

This was prepared without a live privacyIDEA instance to test against
— treat it as a solid starting point, not a verified-working recipe.
Cross-check the `privacyidea/privacyidea` image's own docs for
whichever tag you deploy, especially the `PI_*` env var names, which
have shifted across releases.

## Deploy

On the target server:

```bash
cd deploy/privacyidea
cp .env.example .env
# edit .env — real secrets, not the placeholders
docker compose -p mupitech-privacyidea --env-file .env up -d
```

## First-run setup

If the image's own init script doesn't pick up `PI_ADMIN_USER`/
`PI_ADMIN_PASSWORD` (varies by tag), create the admin manually:

```bash
docker compose -p mupitech-privacyidea exec privacyidea \
  pi-manage admin add <username> -e <email>
```

privacyIDEA also needs at least one **realm** (a user store TOTP
tokens get enrolled into) before the Fleet Manager can use it — the
Fleet Manager's `PRIVACYIDEA_REALM` setting must match one that exists
here:

```bash
docker compose -p mupitech-privacyidea exec privacyidea \
  pi-manage realm create <realm-name> <resolver-name>
```

privacyIDEA's own admin web UI (`http://<server>:8080/`) is the
easier path for both of the above if you'd rather click through it.

## Wire up the Fleet Manager

Once privacyIDEA is up and has an admin account + realm, set on the
**Fleet Manager's** environment (not here):

```
PRIVACYIDEA_URL=http://<this-server>:8080
PRIVACYIDEA_ADMIN_USER=<the admin username above>
PRIVACYIDEA_ADMIN_PASSWORD=<its password>
PRIVACYIDEA_REALM=<the realm name above>
```

Then restart the Fleet Manager's `web` container. `mfa.privacyidea
.privacyidea_configured()` returns `True` once all four are set, and a
"privacyIDEA" card appears on every user's Account page (Security
tab) to self-enroll a TOTP token.

## Verifying it's actually reachable

```bash
docker exec <fm-web-container> python -c "
from mfa import privacyidea
print(privacyidea.privacyidea_configured())
print(privacyidea._admin_token())
"
```

A printed JWT means the Fleet Manager can authenticate to privacyIDEA
correctly. An exception means the URL, admin credentials, or network
path between the two servers needs fixing.
