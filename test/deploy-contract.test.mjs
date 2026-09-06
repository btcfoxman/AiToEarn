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
