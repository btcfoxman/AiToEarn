#!/usr/bin/env bash
set -euo pipefail

APP_USER="${APP_USER:-btcfoxman}"
APP_DIR="${APP_DIR:-/home/btcfoxman/docker/aitoearn}"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"
COMPOSE_FILE="${APP_DIR}/docker-compose.yml"

log() {
  printf '[aitoearn-deploy] %s\n' "$*"
}

retry() {
  local attempts="$1"
  local delay="$2"
  shift 2
  local i
  for i in $(seq 1 "${attempts}"); do
    if "$@"; then
      return 0
    fi
    if [ "${i}" -eq "${attempts}" ]; then
      return 1
    fi
    log "Command failed, retrying in ${delay}s (${i}/${attempts}): $*"
    sleep "${delay}"
  done
}

read_env_value() {
  local key="$1"
  local file="$2"
  [ -r "${file}" ] || return 0
  awk -F= -v key="${key}" '$1 == key { print substr($0, length(key) + 2) }' "${file}" | tail -n1 | tr -d '"\r'
}

ensure_rustfs_bucket() {
  local env_file="$1"
  local bucket="$2"
  local rustfs_env="/home/btcfoxman/docker/rustfs/.env"
  local access_key=""
  local secret_key=""

  if [ -z "${bucket}" ]; then
    log "WARN: RUSTFS_BUCKET is empty; skip RustFS bucket policy check"
    return 0
  fi

  if [ -r "${rustfs_env}" ]; then
    access_key="$(read_env_value RUSTFS_ACCESS_KEY "${rustfs_env}")"
    secret_key="$(read_env_value RUSTFS_SECRET_KEY "${rustfs_env}")"
  fi

  if [ -z "${access_key}" ]; then
    access_key="$(read_env_value RUSTFS_ACCESS_KEY "${env_file}")"
  fi
  if [ -z "${secret_key}" ]; then
    secret_key="$(read_env_value RUSTFS_SECRET_KEY "${env_file}")"
  fi

  if [ -z "${access_key}" ] || [ -z "${secret_key}" ]; then
    log "WARN: RustFS credentials are missing; skip bucket policy check for ${bucket}"
    return 0
  fi

  if docker run --rm --network host --entrypoint /bin/sh minio/mc:latest -c "mc alias set rustfs http://192.168.3.6:9000 \"${access_key}\" \"${secret_key}\" >/dev/null && mc mb rustfs/${bucket} --ignore-existing >/dev/null && mc anonymous set download rustfs/${bucket} >/dev/null"; then
    log "RustFS bucket ${bucket} is ready for anonymous downloads"
  else
    log "WARN: failed to create or configure RustFS bucket ${bucket}"
  fi
}

ensure_auto_login_token() {
  if docker run --rm -v aitoearn-test-init-data:/data/init node:lts-alpine sh -c 'test -s /data/init/token.txt' >/dev/null 2>&1; then
    log "Auto-login token already exists"
    return 0
  fi

  log "Auto-login token missing; running init once"
  if command -v timeout >/dev/null 2>&1; then
    timeout 180 docker compose -f "${COMPOSE_FILE}" run --rm aitoearn-init
  else
    docker compose -f "${COMPOSE_FILE}" run --rm aitoearn-init
  fi
}

if [ ! -d "${APP_DIR}" ]; then
  mkdir -p "${APP_DIR}"
fi

log "Syncing deployment files to ${APP_DIR}"
mkdir -p "${APP_DIR}/config" "${APP_DIR}/scripts" "${APP_DIR}/logs" "${APP_DIR}/backups"
cp -f "${SCRIPT_DIR}/docker-compose.yml" "${COMPOSE_FILE}"
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

rustfs_bucket="$(read_env_value RUSTFS_BUCKET "${APP_DIR}/.env")"
rustfs_bucket="${rustfs_bucket:-aitoearn-test}"
sed "s#http://192.168.3.6:9000/aitoearn-test/#http://192.168.3.6:9000/${rustfs_bucket}/#g" "${SCRIPT_DIR}/nginx.conf" > "${APP_DIR}/nginx.conf"
ensure_rustfs_bucket "${APP_DIR}/.env" "${rustfs_bucket}"

if id "${APP_USER}" >/dev/null 2>&1; then
  chown -R "${APP_USER}:${APP_USER}" "${APP_DIR}" || true
fi

if [ -n "${GHCR_TOKEN:-}" ]; then
  log "Logging in to GHCR"
  docker_login_ghcr() {
    printf '%s' "${GHCR_TOKEN}" | docker login ghcr.io -u "${GHCR_USERNAME:-${GITHUB_ACTOR:-btcfoxman}}" --password-stdin >/dev/null
  }
  retry 5 10 docker_login_ghcr
fi

log "Validating compose config"
cd "${APP_DIR}"
export IMAGE_PREFIX="${IMAGE_PREFIX:-ghcr.io/btcfoxman/aitoearn}"
export IMAGE_TAG="${IMAGE_TAG:-test-latest}"
docker compose -f "${COMPOSE_FILE}" config >/dev/null

log "Pulling images"
pull_attempts="${PULL_ATTEMPTS:-12}"
pull_delay="${PULL_DELAY:-20}"
for service in aitoearn-ai aitoearn-server aitoearn-web; do
  retry "${pull_attempts}" "${pull_delay}" docker compose -f "${COMPOSE_FILE}" pull "${service}"
done

for service in aitoearn-init nginx; do
  if ! retry 5 "${pull_delay}" docker compose -f "${COMPOSE_FILE}" pull "${service}"; then
    log "WARN: failed to refresh ${service}; continuing with the local image if present"
  fi
done

log "Starting services"
ensure_auto_login_token
docker compose -f "${COMPOSE_FILE}" stop aitoearn-init >/dev/null 2>&1 || true
docker compose -f "${COMPOSE_FILE}" rm -f aitoearn-init >/dev/null 2>&1 || true
docker compose -f "${COMPOSE_FILE}" up -d --remove-orphans aitoearn-ai aitoearn-server aitoearn-web nginx

log "Waiting for nginx health"
for i in $(seq 1 30); do
  if curl -fsS "http://127.0.0.1:${APP_PORT:-8081}/_nhealth" >/dev/null; then
    docker compose -f "${COMPOSE_FILE}" ps
    log "Deployment complete"
    exit 0
  fi
  sleep 5
done

log "Health check failed"
docker compose -f "${COMPOSE_FILE}" ps || true
docker compose -f "${COMPOSE_FILE}" logs --tail=200 nginx aitoearn-web aitoearn-server aitoearn-ai || true
exit 1
