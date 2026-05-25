import type { PlatType } from '@/app/config/platConfig'
import http from '@/utils/request'

export type OrchestrationPublishContentType = 'image_text' | 'article' | 'weitoutiao'

export interface OrchestrationPublishTarget {
  publishTargetId: string
  accountAssetId?: string
  platform: PlatType
  accountName?: string
  nickname?: string
  ready?: boolean
  status?: string
  reason?: string
  contentTypes?: OrchestrationPublishContentType[]
  capabilities?: {
    contentTypes?: OrchestrationPublishContentType[]
  }
  targetSnapshot?: Record<string, unknown>
  [key: string]: unknown
}

export function apiGetOrchestrationPublishTargets(params?: {
  platform?: PlatType
  contentType?: OrchestrationPublishContentType
}) {
  return http.get<OrchestrationPublishTarget[]>('plat/orchestration/publish-targets', params)
}

export function apiLinkOrchestrationTarget(data: {
  publishTargetId: string
  platform: PlatType
  contentType?: OrchestrationPublishContentType
  groupId?: string
}) {
  return http.post('plat/orchestration/link-target', data)
}
