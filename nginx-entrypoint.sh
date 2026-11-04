#!/bin/sh
set -e

CERT=/etc/nginx/ssl/selfsigned.crt
KEY=/etc/nginx/ssl/selfsigned.key

# WEB_SSL_SAN (see .env.example) is the IP or hostname users actually type
# in the browser — current browsers reject a cert whose Subject
# Alternative Name doesn't match that (CN alone is no longer honoured),
# showing a scarier "wrong name" error on top of the expected "self-signed"
# one. Falls back to a bare CN-only cert (old behaviour) when unset, since
# that's still enough for the Microsoft redirect URI's own validation
# (which only checks the URI's scheme is https://, never connects to it).
case "$WEB_SSL_SAN" in
    '') SAN='' ;;
    *[!0-9.]*) SAN="DNS:$WEB_SSL_SAN" ;;
    *) SAN="IP:$WEB_SSL_SAN" ;;
esac

# /etc/nginx/ssl is a named volume (docker-compose.yml) so this only runs
# once per deployment, not on every `docker compose up --build` — a fresh
# self-signed cert each deploy would mean re-accepting the browser's
# "not trusted" warning (and re-registering the redirect URI's TLS
# fingerprint where anything pins it) every single update.
if [ ! -f "$CERT" ] || [ ! -f "$KEY" ]; then
    echo "Generating self-signed certificate for HTTPS (needed for the Microsoft 365 login redirect)..."
    mkdir -p /etc/nginx/ssl
    if [ -n "$SAN" ]; then
        openssl req -x509 -nodes -days 3650 -newkey rsa:2048 \
            -keyout "$KEY" -out "$CERT" \
            -subj "/CN=fleet-manager" -addext "subjectAltName=$SAN"
    else
        openssl req -x509 -nodes -days 3650 -newkey rsa:2048 \
            -keyout "$KEY" -out "$CERT" \
            -subj "/CN=fleet-manager"
    fi
fi

exec nginx -g 'daemon off;'
