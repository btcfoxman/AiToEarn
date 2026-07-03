import { Injectable, Logger } from '@nestjs/common'
import axios, { AxiosError } from 'axios'
import { config } from '../../../config'

export interface OrchestrationPublishTarget {
  publishTargetId: string
  platform: 'wxGzh' | 'wechat_moments' | 'toutiao'
  internalPlatform?: string
  accountAssetId?: string
  accountName?: string
  ready: boolean
  status: string
  reason?: string
  contentTypes: string[]
  features?: string[]
  capabilities?: {
    contentTypes?: string[]
    features?: string[]
    publishFeatures?: string[]
    publish_features?: string[]
    supportedFeatures?: string[]
    supported_features?: string[]
  }
  account?: Record<string, any>
  mobile?: Record<string, any> | null
  proxy?: Record<string, any> | null
}

export interface OrchestrationPublishTaskResponse {
  publishTaskId: string
  requestId: string
  externalRecordId?: string
  status: string
  internalTaskId?: string
  publishTargetId?: string
  idempotent?: boolean
}

@Injectable()
export class OrchestrationPublishClient {
  private readonly logger = new Logger(OrchestrationPublishClient.name)

  private baseUrl() {
    const value = process.env['AI_ORCHESTRATION_API_URL'] || ''
    return value.replace(/\/+$/, '')
  }

  private headers() {
    const token = process.env['AI_ORCHESTRATION_API_KEY'] || ''
    if (!token) {
      throw new Error('AI_ORCHESTRATION_API_KEY is not configured')
    }
    return { Authorization: `Bearer ${token}` }
  }

  private requireBaseUrl() {
    const baseUrl = this.baseUrl()
    if (!baseUrl) {
      throw new Error('AI orchestration service URL is not configured')
    }
    return baseUrl
  }

  callbackUrl() {
    const configured = process.env['AITOEARN_ORCHESTRATION_CALLBACK_URL']
      || process.env['ORCHESTRATION_PUBLISH_CALLBACK_URL']
      || ''
    if (configured) {
      return configured
    }
    const appDomain = (config.appDomain || '').replace(/\/+$/, '')
    if (!appDomain) {
      return ''
    }
    const prefix = config.globalPrefix ? `/${config.globalPrefix.replace(/^\/+|\/+$/g, '')}` : ''
    return `${appDomain}${prefix}/internal/orchestration/publish-callback`
  }

  async getPublishTargets(query: {
    platform?: string
    contentType?: string
  }): Promise<OrchestrationPublishTarget[]> {
    const url = `${this.requireBaseUrl()}/api/v1/publish/targets`
    try {
      const response = await axios.get<{ targets: OrchestrationPublishTarget[] }>(url, {
        params: query,
        headers: this.headers(),
        timeout: 15000,
      })
      return response.data.targets || []
    }
    catch (error) {
      this.handleError(error, 'list publish targets')
    }
  }

  async findPublishTarget(query: {
    publishTargetId: string
    platform: string
    contentType?: string
  }): Promise<OrchestrationPublishTarget | null> {
    const targets = await this.getPublishTargets({
      platform: query.platform,
      contentType: query.contentType,
    })
    return targets.find(item => item.publishTargetId === query.publishTargetId) || null
  }

  async createPublishTask(payload: Record<string, any>): Promise<OrchestrationPublishTaskResponse> {
    const url = `${this.requireBaseUrl()}/api/v1/publish/tasks`
    try {
      const response = await axios.post<OrchestrationPublishTaskResponse>(url, payload, {
        headers: this.headers(),
        timeout: 20000,
      })
      return response.data
    }
    catch (error) {
      this.handleError(error, 'create publish task')
    }
  }

  async getPublishTask(publishTaskId: string): Promise<Record<string, any>> {
    const url = `${this.requireBaseUrl()}/api/v1/publish/tasks/${publishTaskId}`
    try {
      const response = await axios.get<Record<string, any>>(url, {
        headers: this.headers(),
        timeout: 15000,
      })
      return response.data
    }
    catch (error) {
      this.handleError(error, 'get publish task')
    }
  }

  private handleError(error: unknown, action: string): never {
    if (error instanceof AxiosError) {
      const detail = error.response?.data ? JSON.stringify(error.response.data) : error.message
      this.logger.error(`Orchestration ${action} failed: ${detail}`)
      throw new Error(`Orchestration ${action} failed: ${detail}`)
    }
    throw error instanceof Error ? error : new Error(String(error))
  }
}
