#!/usr/bin/env bash
set -euo pipefail

APP_USER="${APP_USER:-btcfoxman}"
APP_DIR="${APP_DIR:-/home/btcfoxman/docker/aitoearn}"
RUNNER_DIR="${RUNNER_DIR:-/home/btcfoxman/actions-runners/repo-aitoearn}"
RUNNER_LABEL="${RUNNER_LABEL:-repo-aitoearn}"
RUNNER_LIB_DIR="${RUNNER_LIB_DIR:-/opt/aitoearn-runner-libs}"
RUNNER_VERSION="${RUNNER_VERSION:-2.334.0}"
LIBSTDCXX_NG_URL="${LIBSTDCXX_NG_URL:-https://conda.anaconda.org/conda-forge/linux-64/libstdcxx-ng-12.2.0-h46fd767_19.tar.bz2}"

if [ "$(id -u)" -ne 0 ]; then
  echo "ERROR: please run this script as root."
  exit 1
fi

prepare_centos7_runner_runtime() {
  if [ ! -f /etc/centos-release ] || ! grep -q ' 7\.' /etc/centos-release; then
    return 0
  fi

  echo "Preparing CentOS 7 runtime dependencies for GitHub Actions runner..."
  yum install -y libicu krb5-libs openssl-libs zlib bzip2 >/dev/null

  if [ ! -f "${RUNNER_LIB_DIR}/libstdc++.so.6" ]; then
    local work_dir
    work_dir="$(mktemp -d /tmp/aitoearn-libstdcxx.XXXXXX)"
    mkdir -p "${RUNNER_LIB_DIR}"
    curl -fL --retry 3 --connect-timeout 20 -o "${work_dir}/libstdcxx-ng.tar.bz2" "${LIBSTDCXX_NG_URL}"
    tar -xjf "${work_dir}/libstdcxx-ng.tar.bz2" -C "${work_dir}"
    cp -f "${work_dir}/lib/libstdc++.so.6.0.30" "${RUNNER_LIB_DIR}/libstdc++.so.6.0.30"
    ln -sfn libstdc++.so.6.0.30 "${RUNNER_LIB_DIR}/libstdc++.so.6"
    chmod 755 "${RUNNER_LIB_DIR}"
    chmod 644 "${RUNNER_LIB_DIR}/libstdc++.so.6.0.30"
    rm -rf "${work_dir}"
  fi
}

read_env_value() {
  local key="$1"
  local file="$2"
  awk -F= -v key="${key}" '$1 == key { print substr($0, length(key) + 2) }' "${file}" | tail -n1 | tr -d '"\r'
}

echo "[1/8] Checking required commands..."
command -v docker >/dev/null
command -v curl >/dev/null
command -v tar >/dev/null
docker version >/dev/null
docker compose version >/dev/null

echo "[2/8] Ensuring application user exists..."
if ! id "${APP_USER}" >/dev/null 2>&1; then
  useradd -m -s /bin/bash "${APP_USER}"
fi

echo "[3/8] Ensuring docker group permission..."
if ! getent group docker >/dev/null; then
  groupadd docker
fi
if ! id -nG "${APP_USER}" | tr ' ' '\n' | grep -qx docker; then
  usermod -aG docker "${APP_USER}"
fi

echo "[4/8] Creating deployment directories..."
mkdir -p "${APP_DIR}/config" "${APP_DIR}/scripts" "${APP_DIR}/logs" "${APP_DIR}/backups"
chown -R "${APP_USER}:${APP_USER}" "${APP_DIR}"

echo "[5/8] Creating runner directory..."
mkdir -p "${RUNNER_DIR}"
if [ ! -f "${RUNNER_DIR}/config.sh" ]; then
  archive="actions-runner-linux-x64-${RUNNER_VERSION}.tar.gz"
  if [ -f "/home/btcfoxman/actions-runners/repo-localminidrama/${archive}" ]; then
    cp -f "/home/btcfoxman/actions-runners/repo-localminidrama/${archive}" "${RUNNER_DIR}/${archive}"
  else
    curl -fL --retry 3 -o "${RUNNER_DIR}/${archive}" "https://github.com/actions/runner/releases/download/v${RUNNER_VERSION}/${archive}"
  fi
  tar -xzf "${RUNNER_DIR}/${archive}" -C "${RUNNER_DIR}"
fi
chown -R "${APP_USER}:${APP_USER}" "${RUNNER_DIR}"

echo "[6/8] Preparing CentOS 7 runner runtime..."
prepare_centos7_runner_runtime

echo "[7/8] Checking port 8081..."
if ss -ltn | awk 'NR > 1 { print $4 }' | grep -Eq '(^|:)8081$'; then
  if docker ps --format '{{.Names}} {{.Ports}}' | grep -E '^aitoearn-test-nginx ' | grep -q '8081'; then
    echo "Port 8081 is already used by aitoearn-test-nginx; keeping it."
  else
    echo "ERROR: port 8081 is already in use by another process."
    ss -ltnp | grep ':8081' || true
    exit 1
  fi
fi

echo "[8/9] Checking middleware endpoints..."
for endpoint in "192.168.3.6/27017" "192.168.3.6/6379" "192.168.3.6/9000"; do
  host="${endpoint%/*}"
  port="${endpoint#*/}"
  if timeout 3 bash -c "</dev/tcp/${host}/${port}" 2>/dev/null; then
    echo "${host}:${port} is reachable."
  else
    echo "WARN: ${host}:${port} is not reachable."
  fi
done

echo "[9/9] Ensuring RustFS bucket..."
rustfs_bucket="${RUSTFS_BUCKET:-}"
if [ -z "${rustfs_bucket}" ] && [ -f "${APP_DIR}/.env" ]; then
  rustfs_bucket="$(read_env_value RUSTFS_BUCKET "${APP_DIR}/.env")"
fi
rustfs_bucket="${rustfs_bucket:-aitoearn-test}"
if [ -f /home/btcfoxman/docker/rustfs/.env ]; then
  rustfs_access_key="$(read_env_value RUSTFS_ACCESS_KEY /home/btcfoxman/docker/rustfs/.env)"
  rustfs_secret_key="$(read_env_value RUSTFS_SECRET_KEY /home/btcfoxman/docker/rustfs/.env)"
  if [ -n "${rustfs_access_key}" ] && [ -n "${rustfs_secret_key}" ]; then
    if docker run --rm --network host --entrypoint /bin/sh minio/mc:latest -c "mc alias set rustfs http://192.168.3.6:9000 \"${rustfs_access_key}\" \"${rustfs_secret_key}\" >/dev/null && mc mb rustfs/${rustfs_bucket} --ignore-existing >/dev/null && mc anonymous set download rustfs/${rustfs_bucket} >/dev/null"; then
      echo "RustFS bucket ${rustfs_bucket} is ready."
    else
      echo "WARN: failed to create or configure RustFS bucket ${rustfs_bucket}."
    fi
  else
    echo "WARN: RustFS credentials were not found in /home/btcfoxman/docker/rustfs/.env."
  fi
else
  echo "WARN: /home/btcfoxman/docker/rustfs/.env was not found."
fi

echo
echo "Done."
echo "Next steps:"
echo "  1. Copy deploy/test files to ${APP_DIR} or run deploy/test/deploy.sh from a repository checkout."
echo "  2. Create ${APP_DIR}/.env from deploy/test/.env.example and fill secrets."
echo "  3. Register runner:"
echo "     sudo bash deploy/test/configure-aitoearn-runner.sh <github-runner-token>"
