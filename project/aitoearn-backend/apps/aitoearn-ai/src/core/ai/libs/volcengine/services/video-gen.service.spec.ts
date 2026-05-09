import type { VolcengineConfig } from '../volcengine.config'
import { ResponseCode } from '@yikart/common'
import axios from 'axios'
import { vi } from 'vitest'
import { ContentType } from '../volcengine.interface'
import { VideoGenService } from './video-gen.service'

vi.mock('axios', () => ({
  default: {
    create: vi.fn(),
  },
  isAxiosError: vi.fn(error => Boolean(error?.isAxiosError)),
}))

describe('videoGenService', () => {
  const httpClient = {
    post: vi.fn(),
    get: vi.fn(),
    delete: vi.fn(),
  }

  const createService = (overrides: Partial<VolcengineConfig> = {}) => {
    vi.mocked(axios.create).mockReturnValue(httpClient as never)

    const service = new VideoGenService({
      apiKey: 'test-api-key',
      baseUrl: 'https://ark.cn-beijing.volces.com/',
      videoRequestMode: 'official',
      videoGenerationTasksPath: '/api/v3/contents/generations/tasks',
      accessKeyId: 'test-access-key',
      secretAccessKey: 'test-secret-key',
      spaceName: 'test-space',
      playbackBaseUrl: 'https://example.com',
      urlAuthPrimaryKey: 'test-primary-key',
      ...overrides,
    })

    Object.defineProperty(service, 'logger', { value: { error: vi.fn() } })

    return service
  }

  const request = {
    model: 'doubao-seedance-2-0-fast-260128',
    content: [
      {
        type: ContentType.Text,
        text: 'create a short video',
      },
    ],
  }

  beforeEach(() => {
    vi.clearAllMocks()
    httpClient.post.mockReset()
    httpClient.get.mockReset()
    httpClient.delete.mockReset()
  })

  it('fails fast when Volcengine API key is missing', async () => {
    const service = createService({ apiKey: '' })

    const result = expect(service.createVideoGenerationTask(request)).rejects
    await result.toMatchObject({
      code: ResponseCode.AiCallFailed,
    })
    await result.toThrow('VOLCENGINE_API_KEY')
    expect(httpClient.post).not.toHaveBeenCalled()
  })

  it('normalizes an accidental Bearer prefix in the API key', async () => {
    const service = createService({ apiKey: 'Bearer test-api-key' })
    httpClient.post.mockResolvedValue({ data: { id: 'task-id' } })

    await service.createVideoGenerationTask(request)

    expect(httpClient.post).toHaveBeenCalledWith(
      '/api/v3/contents/generations/tasks',
      request,
      { headers: { Authorization: 'Bearer test-api-key' } },
    )
  })

  it('uses a custom video generation tasks path for third-party channels', async () => {
    const service = createService({ videoGenerationTasksPath: 'v1/video/generations/' })
    httpClient.get.mockResolvedValue({ data: { id: 'task-id', status: 'running' } })

    await service.getVideoGenerationTask('task/id')

    expect(httpClient.get).toHaveBeenCalledWith(
      '/v1/video/generations/task%2Fid',
      { headers: { Authorization: 'Bearer test-api-key' } },
    )
  })

  it('turns provider 401 responses into actionable configuration errors', async () => {
    const service = createService()
    httpClient.post.mockRejectedValue({
      isAxiosError: true,
      response: {
        status: 401,
        data: { error: { message: 'Unauthorized' } },
      },
      config: {
        baseURL: 'https://ark.cn-beijing.volces.com/',
        url: '/api/v3/contents/generations/tasks',
        method: 'post',
      },
    })

    const result = expect(service.createVideoGenerationTask(request)).rejects
    await result.toMatchObject({
      code: ResponseCode.AiCallFailed,
    })
    await result.toThrow('Volcengine/third-party video channel authentication failed (401)')
  })
})
