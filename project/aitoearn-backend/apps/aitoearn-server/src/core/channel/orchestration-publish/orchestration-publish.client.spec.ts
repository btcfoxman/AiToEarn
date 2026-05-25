import axios from 'axios'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { OrchestrationPublishClient } from './orchestration-publish.client'

vi.mock('axios', () => ({
  default: {
    get: vi.fn(),
    post: vi.fn(),
  },
  AxiosError: class AxiosError extends Error {},
}))

vi.mock('../../../config', () => ({
  config: {
    appDomain: 'https://aitoearn.example.com',
    globalPrefix: 'api',
  },
}))

const mockedAxios = vi.mocked(axios)

describe('OrchestrationPublishClient', () => {
  const originalEnv = { ...process.env }

  beforeEach(() => {
    vi.clearAllMocks()
    process.env = { ...originalEnv }
    process.env.AI_ORCHESTRATION_API_URL = 'https://orchestration.example.com/'
    process.env.AI_ORCHESTRATION_API_KEY = 'new-key'
  })

  afterEach(() => {
    process.env = { ...originalEnv }
  })

  it('uses AI_ORCHESTRATION_API_KEY as the only auth header source', async () => {
    mockedAxios.get.mockResolvedValueOnce({ data: { targets: [] } })

    const client = new OrchestrationPublishClient()
    await client.getPublishTargets({ platform: 'wxGzh' })

    expect(mockedAxios.get).toHaveBeenCalledWith(
      'https://orchestration.example.com/api/v1/publish/targets',
      expect.objectContaining({
        headers: { Authorization: 'Bearer new-key' },
      }),
    )
  })

  it('does not fall back to deprecated publish key env vars', async () => {
    delete process.env.AI_ORCHESTRATION_API_KEY
    process.env.AI_ORCHESTRATION_PUBLISH_API_KEY = 'old-key'

    const client = new OrchestrationPublishClient()
    await expect(client.getPublishTargets({ platform: 'wxGzh' })).rejects.toThrow('AI_ORCHESTRATION_API_KEY is not configured')
    expect(mockedAxios.get).not.toHaveBeenCalled()
  })
})
