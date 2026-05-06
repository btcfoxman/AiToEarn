#!/usr/bin/env bash
set -euo pipefail

APP_USER="${APP_USER:-btcfoxman}"
APP_DIR="${APP_DIR:-/home/btcfoxman/docker/aitoearn}"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/../.." && pwd)"
COMPOSE_FILE="${APP_DIR}/docker-compose.yml"

log() {
  printf '[aitoearn-deploy] %s\n' "$*"
}

if [ ! -d "${APP_DIR}" ]; then
  mkdir -p "${APP_DIR}"
fi

log "Syncing deployment files to ${APP_DIR}"
mkdir -p "${APP_DIR}/config" "${APP_DIR}/scripts" "${APP_DIR}/logs" "${APP_DIR}/backups"
cp -f "${SCRIPT_DIR}/docker-compose.yml" "${COMPOSE_FILE}"
cp -f "${SCRIPT_DIR}/nginx.conf" "${APP_DIR}/nginx.conf"
cp -f "${REPO_ROOT}/scripts/init.mjs" "${APP_DIR}/scripts/init.mjs"
cp -f "${REPO_ROOT}/scripts/init-package.json" "${APP_DIR}/scripts/init-package.json"
cp -f "${REPO_ROOT}/project/aitoearn-backend/apps/aitoearn-ai/config/config.js" "${APP_DIR}/config/aitoearn-ai.config.js"
cp -f "${REPO_ROOT}/project/aitoearn-backend/apps/aitoearn-server/config/config.js" "${APP_DIR}/config/aitoearn-server.config.js"

if [ ! -f "${APP_DIR}/.env" ]; then
  cp -f "${SCRIPT_DIR}/.env.example" "${APP_DIR}/.env"
  chmod 600 "${APP_DIR}/.env"
  log "Created ${APP_DIR}/.env from example. Fill secrets before deploying."
  exit 1
fi

chmod 600 "${APP_DIR}/.env"

if id "${APP_USER}" >/dev/null 2>&1; then
  chown -R "${APP_USER}:${APP_USER}" "${APP_DIR}" || true
fi

if [ -n "${GHCR_TOKEN:-}" ]; then
  log "Logging in to GHCR"
  printf '%s' "${GHCR_TOKEN}" | docker login ghcr.io -u "${GHCR_USERNAME:-${GITHUB_ACTOR:-btcfoxman}}" --password-stdin >/dev/null
fi

log "Validating compose config"
cd "${APP_DIR}"
docker compose config >/dev/null

log "Pulling images"
docker compose pull

log "Starting services"
docker compose up -d --remove-orphans

log "Waiting for nginx health"
for i in $(seq 1 30); do
  if curl -fsS "http://127.0.0.1:${APP_PORT:-8081}/_nhealth" >/dev/null; then
    docker compose ps
    log "Deployment complete"
    exit 0
  fi
  sleep 5
done

log "Health check failed"
docker compose ps || true
docker compose logs --tail=200 nginx aitoearn-web aitoearn-server aitoearn-ai || true
exit 1
