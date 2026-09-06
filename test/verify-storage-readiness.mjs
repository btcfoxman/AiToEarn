import { createRequire } from 'node:module'
import { pathToFileURL } from 'node:url'

const REQUEST_DEADLINE_MS = 12_000
const PROCESS_DEADLINE_MS = 15_000

function loadS3Sdk() {
  // The deployed pnpm workspace owns this dependency; do not install another
  // SDK or fall back to unrelated credentials/endpoints for a readiness check.
  const requireS3 = createRequire('/app/libs/aws-s3/package.json')
  return requireS3('@aws-sdk/client-s3')
}

function errorCategory(error) {
  const name = error?.name || error?.Code || error?.code
  if (['InvalidAccessKeyId', 'SignatureDoesNotMatch', 'InvalidToken', 'ExpiredToken'].includes(name))
    return 'credentials_rejected'
  if (name === 'NoSuchBucket' || error?.$metadata?.httpStatusCode === 404)
    return 'bucket_missing'
  if (['AccessDenied', 'Forbidden'].includes(name) || error?.$metadata?.httpStatusCode === 403)
    return 'access_denied'
  if (['AbortError', 'TimeoutError'].includes(name))
    return 'deadline_exceeded'
  return 'request_failed'
}

export async function checkStorageReadiness({ assetsConfig, loadSdk = loadS3Sdk, timeoutMs = REQUEST_DEADLINE_MS } = {}) {
  if (typeof assetsConfig !== 'string' || !assetsConfig.trim())
    return { ok: false, category: 'config_missing' }
  let config
  try {
    if (assetsConfig.length > 65_536)
      throw new Error('bounded config')
    config = JSON.parse(assetsConfig)
  }
  catch {
    return { ok: false, category: 'config_invalid' }
  }
  if (!config || typeof config !== 'object' || Array.isArray(config))
    return { ok: false, category: 'config_invalid' }
  // Match assetsConfigSchema's legacy default, but never claim an ali-oss or
  // unknown provider passed an S3 check. Those need their own readiness probe.
  if (config.provider !== undefined && config.provider !== 's3')
    return { ok: false, category: 'unsupported_provider' }

  let endpoint
  try {
    endpoint = new URL(config.endpoint)
    if (!['http:', 'https:'].includes(endpoint.protocol) || endpoint.username || endpoint.password
      || typeof config.region !== 'string' || !config.region.trim()
      || typeof config.bucketName !== 'string' || !/^[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]$/.test(config.bucketName)
      || (config.forcePathStyle !== undefined && typeof config.forcePathStyle !== 'boolean'))
      throw new Error('invalid target')
  }
  catch {
    return { ok: false, category: 'config_invalid' }
  }
  const target = { endpointHost: endpoint.host, bucket: config.bucketName }
  if (typeof config.accessKeyId !== 'string' || !config.accessKeyId.trim()
    || typeof config.secretAccessKey !== 'string' || !config.secretAccessKey.trim())
    return { ok: false, category: 'credentials_missing', ...target }

  let client
  let timer
  const controller = new AbortController()
  const deadline = Math.max(1, Math.min(REQUEST_DEADLINE_MS, Number(timeoutMs) || REQUEST_DEADLINE_MS))
  try {
    let sdk
    try {
      sdk = await loadSdk()
    }
    catch {
      return { ok: false, category: 'sdk_unavailable', ...target }
    }
    client = new sdk.S3Client({
      region: config.region,
      endpoint: config.endpoint,
      forcePathStyle: config.forcePathStyle ?? false,
      credentials: { accessKeyId: config.accessKeyId, secretAccessKey: config.secretAccessKey },
      maxAttempts: 1,
    })
    const expired = new Promise((_, reject) => {
      timer = setTimeout(() => {
        const error = new Error('storage readiness deadline')
        error.name = 'TimeoutError'
        reject(error)
        controller.abort()
      }, deadline)
    })
    await Promise.race([
      client.send(new sdk.HeadBucketCommand({ Bucket: config.bucketName }), { abortSignal: controller.signal }),
      expired,
    ])
    return { ok: true, category: 'head_bucket_ok', ...target }
  }
  catch (error) {
    // Never emit SDK error messages/stacks: they can contain request URLs,
    // signed headers, identifiers or values from an invalid configuration.
    return { ok: false, category: errorCategory(error), ...target }
  }
  finally {
    clearTimeout(timer)
    try { client?.destroy() } catch { /* Do not disclose cleanup errors. */ }
  }
}

function report(result) {
  console.log(`[storage-readiness] ${JSON.stringify(result)}`)
}

async function main() {
  const watchdog = setTimeout(() => {
    report({ ok: false, category: 'deadline_exceeded' })
    process.exit(1)
  }, PROCESS_DEADLINE_MS)
  try {
    const result = await checkStorageReadiness({ assetsConfig: process.env.ASSETS_CONFIG })
    report(result)
    clearTimeout(watchdog)
    // A hard exit also bounds an SDK/background handle that ignored abort.
    process.exit(result.ok ? 0 : 1)
  }
  catch {
    report({ ok: false, category: 'request_failed' })
    process.exit(1)
  }
}

if (process.argv[1] === '-' || (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href))
  await main()
