import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

const compose = readFileSync(new URL('./docker-compose.yml', import.meta.url), 'utf8')
const deploy = readFileSync(new URL('./deploy.sh', import.meta.url), 'utf8')

function service(name) {
  const match = compose.match(new RegExp(`^  ${name}:\\r?\\n([\\s\\S]*?)(?=^  [a-z][\\w-]*:|^[a-z]|$(?![\\s\\S]))`, 'm'))
  assert.ok(match, `missing service ${name}`)
  return match[1]
}

for (const name of ['aitoearn-ai', 'aitoearn-server']) {
  test(`${name} tolerates observed LAN cold starts within a finite health window`, () => {
    const block = service(name)
    const health = block.slice(block.indexOf('    healthcheck:'))
    assert.match(health, /test: .*127\.0\.0\.1:\d+\/health/)
    assert.match(health, /statusCode === 200/)
    assert.match(health, /interval: 30s/)
    assert.match(health, /timeout: 10s/)
    assert.match(health, /retries: 12/)
    assert.match(health, /start_period: 180s/)
    assert.doesNotMatch(health, /disable:\s*true|test:\s*\[?['"]?NONE/)
    // Approximately nine minutes before marking persistent failure, not forever.
    assert.ok(180 + 12 * 30 <= 600)
  })
}

test('dependent applications still wait for healthy backends', () => {
  assert.match(service('aitoearn-server'), /aitoearn-ai:\s*\r?\n\s+condition: service_healthy/)
  assert.match(service('aitoearn-web'), /aitoearn-server:\s*\r?\n\s+condition: service_healthy/)
  for (const name of ['aitoearn-ai', 'aitoearn-server']) {
    assert.match(service('nginx'), new RegExp(`${name}:\\s*\\r?\\n\\s+condition: service_healthy`))
  }
  assert.match(deploy, /docker compose .* up -d --remove-orphans aitoearn-ai aitoearn-server aitoearn-web nginx/)
  assert.match(deploy, /seq 1 30/)
  assert.match(deploy, /Health check failed/)
})

test('LAN regression installs only the image-matched Playwright dependency', () => {
  const manifest = JSON.parse(readFileSync(new URL('./cold-start/package.json', import.meta.url), 'utf8'))
  assert.deepEqual(manifest.devDependencies, { '@playwright/test': '1.57.0' })
  assert.equal(manifest.dependencies, undefined)
  const workflow = readFileSync(new URL('../.github/workflows/deploy-test.yml', import.meta.url), 'utf8')
  const e2e = workflow.slice(workflow.indexOf('  verify-web-e2e:'))
  assert.match(e2e, /playwright:v1\.57\.0-noble/)
  assert.match(e2e, /test\/cold-start\/pnpm-lock\.yaml/)
  assert.doesNotMatch(e2e, /\$\{WEB_DIR\}\/package\.json|\$\{WEB_DIR\}\/pnpm-lock\.yaml/)
  assert.match(e2e, /timeout-minutes: 40/)
  assert.match(e2e, /exec bash "\$\{E2E_WORK_DIR\}\/run-cold-start-regression\.sh"/)
})

test('LAN browser regression is serial, resource capped and cleans only its own container', () => {
  const runner = readFileSync(new URL('./run-cold-start-regression.sh', import.meta.url), 'utf8')
  assert.match(runner, /--cpus=1 --memory=1g --memory-swap=1g/)
  assert.match(runner, /--pids-limit=256 --shm-size=256m/)
  assert.doesNotMatch(runner, /--ipc=host/)
  assert.match(runner, /--workers=1/)
  assert.match(runner, /AITOEARN_E2E_ATTEMPTS:-10/)
  assert.match(runner, /trap cleanup EXIT/)
  assert.match(runner, /trap 'exit 143' TERM/)
  assert.match(runner, /aitoearn-cold-start-\$\{GITHUB_RUN_ID\}-\$\{GITHUB_RUN_ATTEMPT:-1\}/)
  assert.match(runner, /docker rm -f "\$\{container_name\}"/)
  assert.match(runner, /180s docker pull/)
  assert.match(runner, /2100s docker run/)
  assert.match(runner, /240s pnpm install --frozen-lockfile/)
  assert.match(runner, /1800s pnpm exec playwright test/)
})

test('deployment and browser regression share a bounded host lock before mutations', () => {
  const lock = readFileSync(new URL('./lan-resource-lock.sh', import.meta.url), 'utf8')
  const regression = readFileSync(new URL('./run-cold-start-regression.sh', import.meta.url), 'utf8')
  const workflow = readFileSync(new URL('../.github/workflows/deploy-test.yml', import.meta.url), 'utf8')
  assert.match(lock, /LAN_RESOURCE_LOCK_FILE="\/home\/btcfoxman\/docker\/\.ai-marketing-test-deploy\.lock"/)
  assert.match(lock, /exec 200>>"\$\{LAN_RESOURCE_LOCK_FILE\}"/)
  assert.match(lock, /flock -w 1200 200 &/)
  assert.match(lock, /wait "\$\{LAN_RESOURCE_LOCK_WAIT_PID\}"/)
  assert.match(lock, /-L "\$\{LAN_RESOURCE_LOCK_FILE\}"/)
  assert.doesNotMatch(lock, /^\s*(?:rm|unlink)\s/m)
  for (const script of [deploy, regression]) {
    assert.match(script, /umask 077/)
    assert.match(script, /source "\$\{SCRIPT_DIR\}\/lan-resource-lock\.sh"/)
    assert.ok(script.indexOf('\nlan_resource_lock_acquire\n') < script.indexOf('\nmkdir -p'))
  }
  assert.match(workflow, /test\/lan-resource-lock\.sh/)
  assert.match(workflow, /exec bash test\/deploy\.sh/)
})
