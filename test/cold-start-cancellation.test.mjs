import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import test from 'node:test'

const bash = process.platform === 'win32' ? 'C:/Program Files/Git/bin/bash.exe' : 'bash'
const skip = process.platform === 'win32' && !existsSync(bash)
const runner = fileURLToPath(new URL('./run-cold-start-regression.sh', import.meta.url)).replaceAll('\\', '/')

function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'aitoearn-cancel-test-'))
  mkdirSync(join(root, 'bin'))
  // This executable replaces Docker entirely: tests cannot contact the daemon.
  writeFileSync(join(root, 'bin', 'docker'), `#!/usr/bin/env bash
set -eu
case "$1" in
  pull) exit 0 ;;
  run)
    if [ -n "\${FAKE_EXIT_CODE:-}" ]; then exit "$FAKE_EXIT_CODE"; fi
    touch "$PROBE_ROOT/ready"
    sleep 6
    ;;
  rm) printf '%s\\n' "$*" > "$PROBE_ROOT/cleanup" ;;
  *) exit 98 ;;
esac
`, { mode: 0o755 })
  return root
}

const setup = `
set -eu
cd "$1"
export PROBE_ROOT="$(pwd)"
chmod +x "$PROBE_ROOT/bin/docker"
export PATH="$PROBE_ROOT/bin:$PATH"
export E2E_WORK_DIR="$PROBE_ROOT" RUNNER_TEMP="$PROBE_ROOT"
export GITHUB_RUN_ID=contract-cancel GITHUB_RUN_ATTEMPT=1
export AITOEARN_E2E_BASE_URL=http://never-contacted.invalid
`

test('TERM reaches cleanup immediately without waiting for the Docker client', { skip }, () => {
  const root = fixture()
  try {
    const result = spawnSync(bash, ['-c', setup + `
bash "$2" > "$PROBE_ROOT/output" 2>&1 &
pid=$!
trap 'kill -TERM "$pid" 2>/dev/null || true; wait "$pid" 2>/dev/null || true' EXIT
for attempt in $(seq 1 50); do
  if [ -f "$PROBE_ROOT/ready" ]; then break; fi
  sleep 0.1
done
test -f "$PROBE_ROOT/ready"
kill -TERM "$pid"
for attempt in $(seq 1 25); do
  if [ -f "$PROBE_ROOT/cleanup" ]; then break; fi
  sleep 0.1
done
test -f "$PROBE_ROOT/cleanup"
status=0
wait "$pid" || status=$?
test "$status" -eq 143
trap - EXIT
`, '--', root.replaceAll('\\', '/'), runner], { encoding: 'utf8', timeout: 15000 })
    assert.equal(result.error, undefined)
    assert.equal(result.status, 0, result.stderr + (existsSync(join(root, 'output')) ? readFileSync(join(root, 'output'), 'utf8') : ''))
    assert.equal(readFileSync(join(root, 'cleanup'), 'utf8').trim(), 'rm -f aitoearn-cold-start-contract-cancel-1')
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('a failed Docker command remains a failed regression and still cleans up', { skip }, () => {
  const root = fixture()
  try {
    const result = spawnSync(bash, ['-c', setup + '\nexport FAKE_EXIT_CODE=17\nexec bash "$2"', '--',
      root.replaceAll('\\', '/'), runner], { encoding: 'utf8', timeout: 15000 })
    assert.equal(result.error, undefined)
    assert.equal(result.status, 17, result.stderr)
    assert.equal(readFileSync(join(root, 'cleanup'), 'utf8').trim(), 'rm -f aitoearn-cold-start-contract-cancel-1')
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})
