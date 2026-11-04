#!/bin/sh
set -e

CERT=/etc/nginx/ssl/selfsigned.crt
KEY=/etc/nginx/ssl/selfsigned.key

# /etc/nginx/ssl is a named volume (docker-compose.yml) so this only runs
# once per deployment, not on every `docker compose up --build` — a fresh
# self-signed cert each deploy would mean re-accepting the browser's
# "not trusted" warning (and re-registering the redirect URI's TLS
# fingerprint where anything pins it) every single update.
if [ ! -f "$CERT" ] || [ ! -f "$KEY" ]; then
    echo "Generating self-signed certificate for HTTPS (needed for the Microsoft 365 login redirect)..."
    mkdir -p /etc/nginx/ssl
    openssl req -x509 -nodes -days 3650 -newkey rsa:2048 \
        -keyout "$KEY" -out "$CERT" \
        -subj "/CN=fleet-manager"
fi

exec nginx -g 'daemon off;'
