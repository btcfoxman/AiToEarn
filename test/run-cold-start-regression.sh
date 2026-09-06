#!/usr/bin/env bash
set -euo pipefail
umask 077
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "${SCRIPT_DIR}/lan-resource-lock.sh"

: "${E2E_WORK_DIR:?E2E_WORK_DIR is required}"
: "${GITHUB_RUN_ID:?GITHUB_RUN_ID is required}"
: "${AITOEARN_E2E_BASE_URL:?AITOEARN_E2E_BASE_URL is required}"
PLAYWRIGHT_IMAGE="${PLAYWRIGHT_IMAGE:-mcr.microsoft.com/playwright:v1.57.0-noble}"
AITOEARN_E2E_ATTEMPTS="${AITOEARN_E2E_ATTEMPTS:-10}"
case "${AITOEARN_E2E_ATTEMPTS}" in
  [1-9]|10) ;;
  *) echo "::error::AITOEARN_E2E_ATTEMPTS must be between 1 and 10"; exit 1 ;;
esac
export AITOEARN_E2E_ATTEMPTS

# This name is exclusive to this run/attempt, so cancellation cannot stop an app.
container_name="aitoearn-cold-start-${GITHUB_RUN_ID}-${GITHUB_RUN_ATTEMPT:-1}"
results_dir="${RUNNER_TEMP:-/tmp}/aitoearn-e2e-results-${GITHUB_RUN_ID}-${GITHUB_RUN_ATTEMPT:-1}"
active_pid=""
container_started=false
cleanup() {
  # Run cancellation must not wait behind a foreground Docker client.
  trap '' INT TERM
  lan_resource_lock_cancel_wait
  if [ "${container_started}" = true ]; then
    timeout --kill-after=1s 6s docker rm -f "${container_name}" >/dev/null 2>&1 || true
  fi
  if [ -n "${active_pid:-}" ]; then
    for child in $(jobs -pr); do
      if [ "${child}" = "${active_pid}" ]; then
        kill -TERM "${child}" >/dev/null 2>&1 || true
      fi
    done
  fi
}
trap cleanup EXIT
trap 'exit 130' INT
trap 'exit 143' TERM

run_cancellable() {
  "$@" &
  active_pid=$!
  local status=0
  # Bash runs signal traps immediately while waiting with its wait builtin.
  wait "${active_pid}" || status=$?
  active_pid=""
  return "${status}"
}

lan_resource_lock_acquire
mkdir -p "${results_dir}"

for attempt in 1 2 3; do
  if run_cancellable timeout --kill-after=20s 180s docker pull "${PLAYWRIGHT_IMAGE}"; then
    break
  fi
  if [ "${attempt}" -eq 3 ]; then
    echo "::error::Playwright image pull exceeded its bounded retry budget"
    exit 1
  fi
  sleep 10
done

# Single browser worker; capped CPU/RAM, no additional swap or host shared memory.
# Only the tiny, locked Playwright package is installed, never the Next workspace.
container_started=true
run_cancellable timeout --signal=TERM --kill-after=30s 2100s docker run --rm --init \
  --name "${container_name}" --network host \
  --cpus=1 --memory=1g --memory-swap=1g --pids-limit=256 --shm-size=256m \
  --env AITOEARN_E2E_BASE_URL --env AITOEARN_E2E_ATTEMPTS \
  --env PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1 \
  --volume "${E2E_WORK_DIR}:/work:ro" \
  --volume "${results_dir}:/results" \
  "${PLAYWRIGHT_IMAGE}" \
  bash -lc '
    set -euo pipefail
    cp -R /work /tmp/aitoearn-e2e
    cd /tmp/aitoearn-e2e
    timeout --kill-after=10s 60s corepack enable
    timeout --kill-after=10s 120s corepack prepare pnpm@10.33.0 --activate
    timeout --kill-after=20s 240s pnpm install --frozen-lockfile --ignore-scripts --network-concurrency=2 --child-concurrency=1
    set +e
    timeout --signal=TERM --kill-after=20s 1800s pnpm exec playwright test \
      tests/e2e/cold-start-stability.spec.ts \
      --output=/results --workers=1 --trace=retain-on-failure --reporter=line
    status=$?
    set -e
    chmod -R a+rX /results || true
    exit "${status}"
  '
