#!/bin/bash
# Atualiza uma instalação existente do MupiTech Fleet Manager
# (feita via git clone + install.sh ou manualmente, não uma stack
# gerida pelo Portainer via upload/colar — ver a nota sobre Portainer
# no README.md).
#
# Uso: ./update.sh

set -euo pipefail

PROJECT_DIR="$(cd "$(dirname "$0")" && pwd)"
cd "$PROJECT_DIR"

if docker info >/dev/null 2>&1; then
    DOCKER="docker"
else
    DOCKER="sudo docker"
fi

echo "-- A atualizar o repositório..."
git pull

echo "-- A puxar as imagens mais recentes..."
$DOCKER compose pull

echo "-- A recriar os containers..."
$DOCKER compose up -d --build

echo "-- A limpar imagens antigas (substituídas por este pull)..."
# Só imagens "dangling" (sem tag, não referenciadas por nenhum container,
# de ninguém) — nunca a de outra stack/serviço deste servidor partilhado,
# nem nada ainda em uso. Sem isto, cada deploy (docker compose pull +
# up --build) deixa a imagem anterior do :latest para trás, a ocupar
# disco para sempre — foi assim que o disco deste servidor partilhado
# chegou a 89% cheio.
$DOCKER image prune -f

echo "-- Pronto. Versão em execução:"
$DOCKER compose exec -T web sh -c "grep -oP \"APP_VERSION = '\K[^']+\" /app/static/src/changelog.ts" 2>/dev/null \
    || echo "   (não foi possível ler a versão — confirma em Definições > Changelog na aplicação)"
