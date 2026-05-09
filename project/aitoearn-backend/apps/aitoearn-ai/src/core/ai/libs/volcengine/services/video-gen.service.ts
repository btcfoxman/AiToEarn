import type {
  CreateVideoGenerationTaskRequest,
  CreateVideoGenerationTaskResponse,
  GetVideoGenerationTaskResponse,
} from '../volcengine.interface'
import { Injectable } from '@nestjs/common'
import { AppException, getErrorDetail, ResponseCode } from '@yikart/common'
import axios, { AxiosInstance, AxiosResponse, isAxiosError } from 'axios'
import { VolcengineConfig } from '../volcengine.config'
import { BaseService } from './base.service'

/**
 * Volcengine 视频生成服务
 * 负责 Ark API 视频生成功能
 */
@Injectable()
export class VideoGenService extends BaseService {
  private readonly httpClient: AxiosInstance

  constructor(config: VolcengineConfig) {
    super(config)
    this.httpClient = this.createHttpClient()
  }

  /**
   * 创建HTTP客户端
   */
  private createHttpClient(): AxiosInstance {
    return axios.create({
      baseURL: this.config.baseUrl,
      timeout: 30000,
      headers: {
        'Content-Type': 'application/json',
      },
    })
  }

  private getApiKey(): string {
    const rawApiKey = this.config.apiKey?.trim()
    const apiKey = rawApiKey?.toLowerCase().startsWith('bearer ')
      ? rawApiKey.slice('bearer '.length).trim()
      : rawApiKey

    if (!apiKey) {
      throw new AppException(ResponseCode.AiCallFailed, {
        error: 'Volcengine API key is not configured. Set VOLCENGINE_API_KEY before using Doubao Seedance video generation.',
      })
    }

    return apiKey
  }

  private getAuthHeaders() {
    return {
      Authorization: `Bearer ${this.getApiKey()}`,
    }
  }

  private getVideoGenerationTaskUrl(taskId?: string) {
    const configuredPath = this.config.videoGenerationTasksPath || '/api/v3/contents/generations/tasks'
    const normalizedPath = configuredPath.startsWith('/') ? configuredPath : `/${configuredPath}`
    const taskPath = normalizedPath.replace(/\/+$/, '')
    return taskId ? `${taskPath}/${encodeURIComponent(taskId)}` : taskPath
  }

  private extractProviderMessage(data: unknown): string | undefined {
    if (data == null) {
      return undefined
    }

    if (typeof data === 'string') {
      return data
    }

    if (typeof data !== 'object') {
      return String(data)
    }

    const record = data as Record<string, unknown>
    const error = record['error']

    if (typeof error === 'string') {
      return error
    }

    if (error && typeof error === 'object') {
      const errorRecord = error as Record<string, unknown>
      if (typeof errorRecord['message'] === 'string') {
        return errorRecord['message']
      }
      if (typeof errorRecord['code'] === 'string') {
        return errorRecord['code']
      }
    }

    if (typeof record['message'] === 'string') {
      return record['message']
    }

    const responseMetadata = record['ResponseMetadata']
    if (responseMetadata && typeof responseMetadata === 'object') {
      const responseError = (responseMetadata as Record<string, unknown>)['Error']
      if (responseError && typeof responseError === 'object') {
        const responseErrorRecord = responseError as Record<string, unknown>
        if (typeof responseErrorRecord['Message'] === 'string') {
          return responseErrorRecord['Message']
        }
        if (typeof responseErrorRecord['Code'] === 'string') {
          return responseErrorRecord['Code']
        }
      }
    }

    return JSON.stringify(data)
  }

  private handleRequestError(error: unknown, operation: string): never {
    if (error instanceof AppException) {
      throw error
    }

    if (isAxiosError(error)) {
      const status = error.response?.status
      const responseData = error.response?.data
      const providerMessage = this.extractProviderMessage(responseData)
      const message = status === 401
        ? 'Volcengine/third-party video channel authentication failed (401). Check that VOLCENGINE_API_KEY is the key for the configured VOLCENGINE_BASE_URL, do not prefix it with "Bearer", and set VOLCENGINE_VIDEO_REQUEST_MODE=openai-compatible if the third-party channel requires OpenAI-compatible payloads.'
        : `Volcengine ${operation} failed${status ? ` (${status})` : ''}${providerMessage ? `: ${providerMessage}` : ''}`

      this.logger.error({
        status,
        response: responseData,
        request: {
          baseURL: error.config?.baseURL,
          url: error.config?.url,
          method: error.config?.method,
        },
      }, `Volcengine ${operation} request failed`)

      throw new AppException(ResponseCode.AiCallFailed, {
        error: message,
        status,
        providerMessage,
      })
    }

    this.logger.error(getErrorDetail(error), `Volcengine ${operation} request failed`)
    throw error
  }

  /**
   * 创建视频生成任务
   * POST https://ark.cn-beijing.volces.com/api/v3/contents/generations/tasks
   */
  async createVideoGenerationTask(
    request: CreateVideoGenerationTaskRequest,
  ) {
    try {
      const response: AxiosResponse<CreateVideoGenerationTaskResponse> = await this.httpClient.post(
        this.getVideoGenerationTaskUrl(),
        request,
        { headers: this.getAuthHeaders() },
      )

      return response.data
    }
    catch (error) {
      this.handleRequestError(error, 'create video generation task')
    }
  }

  /**
   * 查询视频生成任务
   * GET https://ark.cn-beijing.volces.com/api/v3/contents/generations/tasks/{id}
   */
  async getVideoGenerationTask(
    taskId: string,
  ) {
    try {
      const response: AxiosResponse<GetVideoGenerationTaskResponse> = await this.httpClient.get(
        this.getVideoGenerationTaskUrl(taskId),
        { headers: this.getAuthHeaders() },
      )

      return response.data
    }
    catch (error) {
      this.handleRequestError(error, 'get video generation task')
    }
  }

  /**
   * 取消或删除视频生成任务
   * DELETE https://ark.cn-beijing.volces.com/api/v3/contents/generations/tasks/{id}
   */
  async deleteVideoGenerationTask(
    taskId: string,
  ) {
    try {
      await this.httpClient.delete(
        this.getVideoGenerationTaskUrl(taskId),
        { headers: this.getAuthHeaders() },
      )
    }
    catch (error) {
      this.handleRequestError(error, 'delete video generation task')
    }
  }
}
