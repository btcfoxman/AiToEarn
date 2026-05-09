import { describe, expect, it } from 'vitest'
import { volcengineConfigSchema } from './volcengine.config'

describe('volcengineConfigSchema', () => {
  it('defaults video generation requests to the official payload mode', () => {
    const config = volcengineConfigSchema.parse({
      apiKey: 'test-api-key',
      baseUrl: 'https://api.aiid.edu.kg',
      accessKeyId: 'test-access-key',
      secretAccessKey: 'test-secret-key',
      spaceName: 'test-space',
      playbackBaseUrl: 'https://example.com',
      urlAuthPrimaryKey: 'test-primary-key',
    })

    expect(config.videoRequestMode).toBe('official')
  })
})
