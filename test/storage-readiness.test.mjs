import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import test from 'node:test'
import { checkStorageReadiness } from './verify-storage-readiness.mjs'

const fakeAccessKey = 'synthetic-business-access-key'
const fakeSecret = 'synthetic-business-secret-do-not-log'
const assets = {
  provider: 's3',
  endpoint: 'http://storage.internal:9000',
  publicEndpoint: 'https://uploads.example.invalid',
  region: 'test-region',
  bucketName: 'business-assets',
  accessKeyId: fakeAccessKey,
  secretAccessKey: fakeSecret,
  forcePathStyle: true,
}

function fakeSdk(send = async () => ({})) {
  const state = { options: [], requests: [], destroyed: 0 }
  class HeadBucketCommand {
    constructor(input) { this.input = input }
  }
  class S3Client {
    constructor(options) { state.options.push(options) }
    send(command, options) {
      state.requests.push({ command, options })
      return send(command, options)
    }
    destroy() { state.destroyed += 1 }
  }
  return { state, sdk: { S3Client, HeadBucketCommand } }
}

function setSyntheticEnv(t, values) {
  const previous = Object.fromEntries(Object.keys(values).map(key => [key, process.env[key]]))
  Object.assign(process.env, values)
  t.after(() => {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key]
      else process.env[key] = value
    }
  })
}

function captureLogs(t) {
  const logs = []
  for (const method of ['log', 'error', 'warn', 'info', 'debug']) {
    t.mock.method(console, method, (...args) => logs.push(args))
  }
  return logs
}

function assertSafeFailure(result, category, logs = []) {
  assert.equal(result.ok, false)
  assert.equal(result.category, category)
  assert.ok(Object.keys(result).every(key => ['ok', 'category', 'endpointHost', 'bucket'].includes(key)))
  const serialized = JSON.stringify({ result, logs })
  for (const forbidden of [fakeAccessKey, fakeSecret, 'synthetic-old-bootstrap', 'PRIVATE_PROVIDER_ERROR']) {
    assert.equal(serialized.includes(forbidden), false, 'diagnostics must exclude credentials and raw provider errors')
  }
}

test('readiness uses business ASSETS credentials, the internal endpoint and one exact HeadBucket request', async (t) => {
  setSyntheticEnv(t, {
    RUSTFS_ACCESS_KEY: 'synthetic-old-bootstrap',
    RUSTFS_SECRET_KEY: 'synthetic-old-bootstrap',
    RUSTFS_ROOT_USER: 'synthetic-old-bootstrap',
    RUSTFS_ROOT_PASSWORD: 'synthetic-old-bootstrap',
    AWS_ACCESS_KEY_ID: 'synthetic-old-bootstrap',
    AWS_SECRET_ACCESS_KEY: 'synthetic-old-bootstrap',
  })
  const { sdk, state } = fakeSdk()
  let loads = 0
  const result = await checkStorageReadiness({
    assetsConfig: JSON.stringify(assets),
    loadSdk: async () => { loads += 1; return sdk },
  })

  assert.equal(result.ok, true)
  assert.equal(loads, 1)
  assert.equal(state.options.length, 1)
  assert.equal(state.options[0].endpoint, assets.endpoint)
  assert.equal(state.options[0].region, assets.region)
  assert.equal(state.options[0].forcePathStyle, true)
  assert.equal(state.options[0].maxAttempts, 1)
  assert.deepEqual(state.options[0].credentials, { accessKeyId: fakeAccessKey, secretAccessKey: fakeSecret })
  assert.equal(state.requests.length, 1)
  assert.ok(state.requests[0].command instanceof sdk.HeadBucketCommand)
  assert.deepEqual(state.requests[0].command.input, { Bucket: assets.bucketName })
})

for (const [name, status, category] of [
  ['InvalidAccessKeyId', 403, 'credentials_rejected'],
  ['SignatureDoesNotMatch', 403, 'credentials_rejected'],
  ['AccessDenied', 403, 'access_denied'],
  ['UnknownForbidden', 403, 'access_denied'],
  ['NoSuchBucket', 404, 'bucket_missing'],
  ['NotFound', 404, 'bucket_missing'],
  ['UnknownStorageError', 500, 'request_failed'],
]) {
  test(`classifies ${name} without exposing provider messages or credentials`, async (t) => {
    const logs = captureLogs(t)
    const { sdk, state } = fakeSdk(async () => {
      throw Object.assign(new Error(`PRIVATE_PROVIDER_ERROR ${fakeAccessKey} ${fakeSecret}`), {
        name,
        $metadata: { httpStatusCode: status },
      })
    })
    const result = await checkStorageReadiness({ assetsConfig: JSON.stringify(assets), loadSdk: () => sdk })
    assertSafeFailure(result, category, logs)
    assert.equal(state.requests.length, 1)
    assert.equal(state.options[0].maxAttempts, 1)
  })
}

for (const [description, value, category] of [
  ['missing config', undefined, 'config_missing'],
  ['empty config', '', 'config_missing'],
  ['whitespace config', '   ', 'config_missing'],
  ['malformed JSON', '{', 'config_invalid'],
  ['null JSON', 'null', 'config_invalid'],
  ['array JSON', '[]', 'config_invalid'],
  ['invalid endpoint', JSON.stringify({ ...assets, endpoint: 'not-a-url' }), 'config_invalid'],
  ['credentials embedded in endpoint', JSON.stringify({ ...assets, endpoint: `http://${fakeAccessKey}:${fakeSecret}@storage.invalid` }), 'config_invalid'],
  ['missing bucket', JSON.stringify({ ...assets, bucketName: '' }), 'config_invalid'],
  ['unsupported provider', JSON.stringify({ ...assets, provider: 'ali-oss' }), 'unsupported_provider'],
  ['missing business access key', JSON.stringify({ ...assets, accessKeyId: '' }), 'credentials_missing'],
  ['missing business secret key', JSON.stringify({ ...assets, secretAccessKey: '' }), 'credentials_missing'],
]) {
  test(`rejects ${description} before contacting storage`, async (t) => {
    setSyntheticEnv(t, {
      RUSTFS_ACCESS_KEY: 'synthetic-old-bootstrap',
      RUSTFS_SECRET_KEY: 'synthetic-old-bootstrap',
      AWS_ACCESS_KEY_ID: 'synthetic-old-bootstrap',
      AWS_SECRET_ACCESS_KEY: 'synthetic-old-bootstrap',
    })
    const { sdk, state } = fakeSdk()
    const result = await checkStorageReadiness({ assetsConfig: value, loadSdk: () => sdk })
    assertSafeFailure(result, category)
    assert.equal(state.requests.length, 0)
  })
}

test('an omitted provider uses the backend s3 default and a synchronous SDK loader', async () => {
  const { provider, forcePathStyle, ...withoutProvider } = assets
  const { sdk, state } = fakeSdk()
  const result = await checkStorageReadiness({ assetsConfig: JSON.stringify(withoutProvider), loadSdk: () => sdk })
  assert.equal(result.ok, true)
  assert.equal(state.requests.length, 1)
  assert.equal(state.options[0].forcePathStyle, false)
})

test('an unavailable SDK fails closed without leaking its import error', async (t) => {
  const logs = captureLogs(t)
  const result = await checkStorageReadiness({
    assetsConfig: JSON.stringify(assets),
    loadSdk: async () => { throw new Error(`PRIVATE_PROVIDER_ERROR ${fakeSecret}`) },
  })
  assertSafeFailure(result, 'sdk_unavailable', logs)
})

test('a hung SDK request reaches its deadline, aborts and destroys the client without retrying', async () => {
  let aborts = 0
  const { sdk, state } = fakeSdk((_command, options) => {
    assert.ok(options.abortSignal instanceof AbortSignal)
    options.abortSignal.addEventListener('abort', () => { aborts += 1 }, { once: true })
    // Deliberately ignore cancellation to verify the independent deadline race.
    return new Promise(() => {})
  })
  const result = await checkStorageReadiness({
    assetsConfig: JSON.stringify(assets), loadSdk: () => sdk, timeoutMs: 20,
  })
  assertSafeFailure(result, 'deadline_exceeded')
  assert.equal(aborts, 1)
  assert.equal(state.destroyed, 1)
  assert.equal(state.requests.length, 1)
  assert.equal(state.options[0].maxAttempts, 1)
})

test('a caller cannot increase the request deadline above twelve seconds', async (t) => {
  const realSetTimeout = globalThis.setTimeout
  const deadlines = []
  t.mock.method(globalThis, 'setTimeout', (callback, delay, ...args) => {
    deadlines.push(delay)
    return realSetTimeout(callback, Math.min(delay, 5), ...args)
  })
  const { sdk, state } = fakeSdk(() => new Promise(() => {}))
  const result = await checkStorageReadiness({
    assetsConfig: JSON.stringify(assets), loadSdk: () => sdk, timeoutMs: 60000,
  })
  assertSafeFailure(result, 'deadline_exceeded')
  assert.ok(deadlines.length > 0)
  assert.ok(deadlines.every(delay => delay > 0 && delay <= 12000))
  assert.equal(state.destroyed, 1)
  assert.equal(state.requests.length, 1)
})

test('deployment requires business storage readiness after startup and before reporting success', () => {
  const deploy = readFileSync(new URL('./deploy.sh', import.meta.url), 'utf8')
  const probe = readFileSync(new URL('./verify-storage-readiness.mjs', import.meta.url), 'utf8')
  const startup = deploy.indexOf('up -d --remove-orphans aitoearn-ai aitoearn-server aitoearn-web nginx')
  const success = deploy.indexOf('log "Deployment complete"', startup)
  assert.ok(startup >= 0 && success > startup)
  const acceptance = deploy.slice(startup, success)
  assert.match(acceptance, /\r?\nverify_business_storage\r?\n/)
  const storageCheck = deploy.match(/verify_business_storage\(\)\s*\{([\s\S]*?)\r?\n\}/)?.[1]
  assert.ok(storageCheck, 'storage check must exist and fail deployment on failure')
  assert.match(storageCheck, /if ! timeout[^\r\n]*20s docker compose[^\r\n]*exec -T aitoearn-server node --input-type=module -/)
  assert.match(storageCheck, /verify-storage-readiness\.mjs/)
  assert.match(storageCheck, /(?:return|exit) 1/)
  assert.doesNotMatch(storageCheck, /\|\|\s*(?:true|:)/)
  assert.match(deploy, /set -e/)
  assert.match(deploy, /timeout[^\r\n]*20(?:s|\s)/)
  assert.match(probe, /process\.env\.ASSETS_CONFIG/)
  assert.doesNotMatch(probe, /process\.env\.RUSTFS_/)
  assert.match(deploy, /cp -f "\$\{SCRIPT_DIR\}\/verify-storage-readiness\.mjs" "\$\{APP_DIR\}\/scripts\/verify-storage-readiness\.mjs"/)
})

for (const probeStatus of [0, 1]) {
  test(`a business probe exit ${probeStatus} controls the real deployment function outcome`, (t) => {
    const bash = process.platform === 'win32' ? 'C:/Program Files/Git/bin/bash.exe' : '/bin/bash'
    if (!existsSync(bash)) {
      t.skip('requires Bash; no Docker or storage access is used')
      return
    }
    const deploy = readFileSync(new URL('./deploy.sh', import.meta.url), 'utf8')
    const check = deploy.match(/^verify_business_storage\(\) \{[\s\S]*?^\}/m)?.[0]
    assert.ok(check)
    const script = [
      'set -euo pipefail',
      'COMPOSE_FILE=unused-compose.yml',
      'log() { printf "%s\\n" "$*"; }',
      `timeout() { return ${probeStatus}; }`,
      // Substitute only the input fixture; run the production shell function
      // unchanged otherwise, with the external process stubbed before Docker.
      check.replace('${APP_DIR}/scripts/verify-storage-readiness.mjs', '/dev/null'),
      'verify_business_storage',
      'printf "DEPLOYMENT_COMPLETE_REACHED\\n"',
    ].join('\n')
    const result = spawnSync(bash, ['-s'], { input: script, encoding: 'utf8', timeout: 5000 })
    assert.ifError(result.error)
    assert.equal(result.status, probeStatus)
    assert.equal(result.stdout.includes('DEPLOYMENT_COMPLETE_REACHED'), probeStatus === 0)
    if (probeStatus !== 0)
      assert.match(result.stdout, /business_storage_readiness_failed/)
  })
}

test('the production stdin entry point fails closed without disclosing malformed configuration', () => {
  const probe = readFileSync(new URL('./verify-storage-readiness.mjs', import.meta.url), 'utf8')
  const result = spawnSync(process.execPath, ['--input-type=module', '-'], {
    input: probe,
    encoding: 'utf8',
    timeout: 5000,
    env: { ...process.env, ASSETS_CONFIG: `{PRIVATE_PROVIDER_ERROR ${fakeSecret}` },
  })
  assert.ifError(result.error)
  assert.equal(result.status, 1)
  assert.match(result.stdout, /"category":"config_invalid"/)
  assert.doesNotMatch(result.stdout + result.stderr, /PRIVATE_PROVIDER_ERROR|synthetic-business-secret/)
})
