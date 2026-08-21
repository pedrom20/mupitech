#!/bin/bash
# Instalação automática do MupiTech Fleet Manager num Ubuntu/Debian
# limpo, a partir de um clone deste repositório.
#
# Uso:
#   git clone https://github.com/pedrom20/mupitech.git
#   cd mupitech
#   ./install.sh
#
# Variáveis opcionais para correr sem prompts (ex.: provisioning
# automatizado): MUPITECH_HOST=fleet.exemplo.pt ./install.sh
#
# Idempotente: correr outra vez não apaga segredos já gerados nem
# configuração já personalizada no .env — só preenche o que ainda
# estiver por omissão.

set -euo pipefail

PROJECT_DIR="$(cd "$(dirname "$0")" && pwd)"
cd "$PROJECT_DIR"

echo "========================================"
echo "  MupiTech Fleet Manager — Instalação"
echo "========================================"

if [[ $EUID -eq 0 ]]; then
    SUDO=""
else
    SUDO="sudo"
fi

if ! command -v apt-get >/dev/null 2>&1; then
    echo "Este script assume um sistema baseado em apt (Ubuntu/Debian)." >&2
    echo "Noutra distribuição, segue os passos manuais no README.md." >&2
    exit 1
fi

echo ""
echo "-- A verificar dependências do sistema..."

if ! command -v git >/dev/null 2>&1 || ! command -v curl >/dev/null 2>&1 || ! command -v python3 >/dev/null 2>&1; then
    $SUDO apt-get update -qq
    $SUDO apt-get install -y -qq git curl ca-certificates python3 >/dev/null
fi

if ! command -v docker >/dev/null 2>&1; then
    echo "-- Docker não encontrado, a instalar..."
    curl -fsSL https://get.docker.com | $SUDO sh
    if [[ $EUID -ne 0 ]]; then
        $SUDO usermod -aG docker "$USER"
        echo "   Adicionado '$USER' ao grupo docker (é preciso um novo login SSH para usar docker sem sudo depois)."
    fi
else
    echo "-- Docker já instalado."
fi

if docker info >/dev/null 2>&1; then
    DOCKER="docker"
else
    DOCKER="$SUDO docker"
fi

echo ""
echo "-- A preparar configuração (.env)..."

if [[ ! -f .env ]]; then
    cp .env.example .env
    echo "   Criado .env a partir de .env.example."
fi

set_env_if_placeholder() {
    local key="$1" placeholder="$2" value="$3"
    local current
    current=$(grep -m1 "^${key}=" .env | cut -d= -f2- || true)
    if [[ -z "$current" || "$current" == "$placeholder" ]]; then
        if grep -q "^${key}=" .env; then
            sed -i "s|^${key}=.*|${key}=${value}|" .env
        else
            echo "${key}=${value}" >> .env
        fi
        echo "   ${key} gerado/definido automaticamente."
    fi
}

set_env_if_placeholder "DJANGO_SECRET_KEY" "your-secret-key-here" \
    "$(python3 -c 'import secrets; print(secrets.token_urlsafe(50))')"

set_env_if_placeholder "MFA_ENCRYPTION_KEY" "your-fernet-key-here" \
    "$(python3 -c 'from cryptography.fernet import Fernet; print(Fernet.generate_key().decode())' 2>/dev/null || python3 -c 'import base64, os; print(base64.urlsafe_b64encode(os.urandom(32)).decode())')"

set_env_if_placeholder "DB_PASSWORD" "your-strong-password-here" \
    "$(python3 -c 'import secrets; print(secrets.token_urlsafe(24))')"

HOST_IP="$(hostname -I 2>/dev/null | awk '{print $1}')"
MUPITECH_HOST="${MUPITECH_HOST:-$HOST_IP}"
WEB_PORT="$(grep -m1 '^WEB_PORT=' .env | cut -d= -f2- || true)"
WEB_PORT="${WEB_PORT:-9000}"

if [[ -n "$MUPITECH_HOST" ]]; then
    set_env_if_placeholder "ALLOWED_HOSTS" "fleet.yourdomain.com,localhost" \
        "${MUPITECH_HOST},localhost,127.0.0.1"
    set_env_if_placeholder "CSRF_TRUSTED_ORIGINS" "https://fleet.yourdomain.com,http://localhost:9000" \
        "http://${MUPITECH_HOST}:${WEB_PORT},http://localhost:${WEB_PORT}"
fi

if command -v ufw >/dev/null 2>&1 && $SUDO ufw status 2>/dev/null | grep -q "Status: active"; then
    echo ""
    echo "-- Firewall (ufw) ativo, a abrir a porta ${WEB_PORT}..."
    $SUDO ufw allow "${WEB_PORT}/tcp" >/dev/null
fi

echo ""
echo "-- A subir a stack (docker compose)..."
$DOCKER compose up -d --build

echo ""
echo "========================================"
echo "  Instalação concluída"
echo "========================================"
if [[ -n "$MUPITECH_HOST" ]]; then
    echo "  Acede em: http://${MUPITECH_HOST}:${WEB_PORT}"
else
    echo "  Acede em: http://<IP-DO-SERVIDOR>:${WEB_PORT}"
fi
echo "  Sem credenciais por omissão — a primeira página guia a criação"
echo "  da conta de administrador."
if [[ $EUID -ne 0 ]] && ! groups "$USER" | grep -qw docker; then
    echo ""
    echo "  Nota: sai e volta a entrar em SSH (ou 'newgrp docker') para"
    echo "  poderes correr 'docker compose' sem sudo neste utilizador."
fi
echo "========================================"
