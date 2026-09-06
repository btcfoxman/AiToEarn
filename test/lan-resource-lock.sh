#!/usr/bin/env bash
# Shared by all three repositories on the canonical LAN test host.
LAN_RESOURCE_LOCK_FILE="/home/btcfoxman/docker/.ai-marketing-test-deploy.lock"
LAN_RESOURCE_LOCK_WAIT_PID=""

lan_resource_lock_cancel_wait() {
  if [ -n "${LAN_RESOURCE_LOCK_WAIT_PID:-}" ]; then
    local child
    for child in $(jobs -pr); do
      if [ "${child}" = "${LAN_RESOURCE_LOCK_WAIT_PID}" ]; then
        kill -TERM "${child}" >/dev/null 2>&1 || true
      fi
    done
  fi
}

lan_resource_lock_acquire() {
  if ! command -v flock >/dev/null 2>&1; then
    echo "[ai-marketing-lan-lock] ERROR: flock is required; refusing an unlocked deployment" >&2
    return 1
  fi
  if [ -L "${LAN_RESOURCE_LOCK_FILE}" ] || { [ -e "${LAN_RESOURCE_LOCK_FILE}" ] && [ ! -f "${LAN_RESOURCE_LOCK_FILE}" ]; }; then
    echo "[ai-marketing-lan-lock] ERROR: lock path must be a regular file, never a symlink" >&2
    return 1
  fi
  exec 200>>"${LAN_RESOURCE_LOCK_FILE}"
  if [ -L "${LAN_RESOURCE_LOCK_FILE}" ] || [ ! -f "${LAN_RESOURCE_LOCK_FILE}" ]; then
    echo "[ai-marketing-lan-lock] ERROR: lock path changed while opening" >&2
    return 1
  fi
  echo "[ai-marketing-lan-lock] Waiting up to 1200s for ${LAN_RESOURCE_LOCK_FILE}"
  flock -w 1200 200 &
  LAN_RESOURCE_LOCK_WAIT_PID=$!
  local status=0
  wait "${LAN_RESOURCE_LOCK_WAIT_PID}" || status=$?
  LAN_RESOURCE_LOCK_WAIT_PID=""
  if [ "${status}" -ne 0 ]; then
    echo "[ai-marketing-lan-lock] ERROR: resource lock was not acquired (status ${status})" >&2
    return "${status}"
  fi
  echo "[ai-marketing-lan-lock] Acquired ${LAN_RESOURCE_LOCK_FILE}"
  # Keep FD 200 open throughout host work. Never unlink the shared lock file.
}
