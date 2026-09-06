import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { existsSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'

// Git Bash on Windows has no flock. CI runs these against the real Linux kernel;
// portable fake-flock cancellation tests live in cold-start-cancellation.test.mjs.
const skip = process.platform === 'win32' ? 'requires Linux flock; not emulated' : false
const source = readFileSync(new URL('./lan-resource-lock.sh', import.meta.url), 'utf8')

function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'aitoearn-real-flock-'))
  writeFileSync(join(root, 'lock.sh'), source.replace(
    '/home/btcfoxman/docker/.ai-marketing-test-deploy.lock', '$PROBE_ROOT/shared.lock'))
  return root
}

const setup = `
set -eu
umask 077
export PROBE_ROOT="$1"
command -v flock >/dev/null
wait_file() {
  for attempt in $(seq 1 100); do
    if [ -s "$1" ]; then return 0; fi
    sleep 0.03
  done
  return 1
}
`

const holder = `
bash -c '
  set -eu
  source "$PROBE_ROOT/lock.sh"
  lan_resource_lock_acquire
  echo first-enter >> "$PROBE_ROOT/order"
  echo ready > "$PROBE_ROOT/held"
  while [ ! -f "$PROBE_ROOT/release" ]; do sleep 0.03; done
  echo first-exit >> "$PROBE_ROOT/order"
' > "$PROBE_ROOT/first-output" 2>&1 &
first=$!
trap 'touch "$PROBE_ROOT/release"; wait "$first" 2>/dev/null || true' EXIT
wait_file "$PROBE_ROOT/held"
`

test('two independent shells serialize through inherited FD 200', { skip }, () => {
  const root = fixture()
  try {
    const result = spawnSync('bash', ['-c', setup + holder + `
bash -c '
  set -eu
  source "$PROBE_ROOT/lock.sh"
  lan_resource_lock_acquire
  echo second-enter >> "$PROBE_ROOT/order"
  echo acquired > "$PROBE_ROOT/second-entered"
' > "$PROBE_ROOT/second-output" 2>&1 &
second=$!
wait_file "$PROBE_ROOT/second-output"
test ! -e "$PROBE_ROOT/second-entered"
touch "$PROBE_ROOT/release"
wait "$first"
wait "$second"
trap - EXIT
test -f "$PROBE_ROOT/shared.lock"
`, '--', root], { encoding: 'utf8', timeout: 10000 })
    assert.equal(result.error, undefined)
    assert.equal(result.status, 0, result.stderr)
    assert.deepEqual(readFileSync(join(root, 'order'), 'utf8').trim().split('\n'), ['first-enter', 'first-exit', 'second-enter'])
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('cancelling a real flock waiter does not release another shell lock', { skip }, () => {
  const root = fixture()
  try {
    const result = spawnSync('bash', ['-c', setup + holder + `
bash -c '
  set -eu
  source "$PROBE_ROOT/lock.sh"
  trap lan_resource_lock_cancel_wait EXIT
  trap "exit 143" TERM
  lan_resource_lock_acquire
  echo acquired > "$PROBE_ROOT/second-entered"
' > "$PROBE_ROOT/second-output" 2>&1 &
second=$!
wait_file "$PROBE_ROOT/second-output"
kill -TERM "$second"
status=0
wait "$second" || status=$?
test "$status" -eq 143
test ! -e "$PROBE_ROOT/second-entered"
if flock -n "$PROBE_ROOT/shared.lock" true; then exit 98; fi
touch "$PROBE_ROOT/release"
wait "$first"
trap - EXIT
flock -n "$PROBE_ROOT/shared.lock" true
test -f "$PROBE_ROOT/shared.lock"
`, '--', root], { encoding: 'utf8', timeout: 10000 })
    assert.equal(result.error, undefined)
    assert.equal(result.status, 0, result.stderr)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('a symbolic-link lock path is rejected without touching its target', { skip }, () => {
  const root = fixture()
  try {
    writeFileSync(join(root, 'target'), 'untouched')
    symlinkSync(join(root, 'target'), join(root, 'shared.lock'))
    const result = spawnSync('bash', ['-c', setup + '\nsource "$PROBE_ROOT/lock.sh"\nlan_resource_lock_acquire', '--', root],
      { encoding: 'utf8', timeout: 5000 })
    assert.equal(result.status, 1)
    assert.match(result.stderr, /never a symlink/)
    assert.equal(readFileSync(join(root, 'target'), 'utf8'), 'untouched')
    assert.equal(existsSync(join(root, 'shared.lock')), true)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})
