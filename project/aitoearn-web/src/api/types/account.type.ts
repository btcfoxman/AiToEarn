import type { ClientType } from '@/app/[lng]/accounts/accounts.enums'
import type { PlatType } from '@/app/config/platConfig'

export type OrchestrationPublishFeature =
  | 'rich_text'
  | 'image'
  | 'video'
  | 'wechat_channel_video'
  | 'poll'

// 三方账户类型定义
export interface SocialAccount {
  id: string
  type: PlatType
  loginCookie?: string
  access_token?: string
  refresh_token?: string
  loginTime: string
  uid: string
  account: string
  avatar: string
  nickname: string
  fansCount: number
  readCount: number
  likeCount: number
  collectCount: number
  forwardCount: number
  commentCount: number
  lastStatsTime: string
  workCount: number
  income: number
  status: number
  createTime: string
  updateTime: string
  rank: number
  groupId: string
  clientType?: ClientType
  externalProvider?: string
  externalId?: string
  externalPlatform?: string
  externalMeta?: {
    capabilities?: {
      contentTypes?: Array<'image_text' | 'article' | 'weitoutiao'>
      features?: OrchestrationPublishFeature[]
      publishFeatures?: OrchestrationPublishFeature[]
      publish_features?: OrchestrationPublishFeature[]
      supportedFeatures?: OrchestrationPublishFeature[]
      supported_features?: OrchestrationPublishFeature[]
    }
    publishTargetId?: string
    targetSnapshot?: Record<string, unknown>
    [key: string]: unknown
  }
}

// 更新账户统计数据
export interface UpdateAccountStatisticsParams {
  id: number
  fansCount: number
  readCount: number
  likeCount: number
  collectCount: number
  commentCount: number
  income: number
  workCount: number
}

// 账户组 item 数据
export interface AccountGroupItem {
  id: string
  name: string
  rank: number
  isDefault: boolean
  proxyIp?: string
  ip?: string
  location?: string
}
