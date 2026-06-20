import { Injectable, Logger } from '@nestjs/common'
import { AssetsService } from '@yikart/assets'
import { AccountType } from '@yikart/common'
import { PublishRecord, PublishStatus, PublishType } from '@yikart/mongodb'
import { OrchestrationPublishClient } from '../../orchestration-publish/orchestration-publish.client'
import { ChannelAccountService } from '../../platforms/channel-account.service'
import { CreatePublishDto } from '../publish.dto'
import { PublishingException } from '../publishing.exception'
import { PublishingTaskResult, VerifyPublishResult } from '../publishing.interface'
import { PublishService } from './base.service'

const ORCHESTRATION_PROVIDER = 'ai-orchestration'
const CONTENT_TYPES = ['image_text', 'article', 'weitoutiao'] as const
type OrchestrationContentType = typeof CONTENT_TYPES[number]
type OptionalArticleFeature = 'poll' | 'wechat_channel_video'

const OPTIONAL_ARTICLE_FEATURE_ALIASES: Record<string, OptionalArticleFeature> = {
  poll: 'poll',
  vote: 'poll',
  voting: 'poll',
  wechat_channel_video: 'wechat_channel_video',
  wechat_channels_video: 'wechat_channel_video',
  video_channel: 'wechat_channel_video',
  wx_channels_video: 'wechat_channel_video',
  wx_sph_video: 'wechat_channel_video',
}

function normalizeOptionalArticleFeature(value: unknown): OptionalArticleFeature | null {
  const key = String(value ?? '').trim().replace(/[\s-]+/g, '_').toLowerCase()
  return OPTIONAL_ARTICLE_FEATURE_ALIASES[key] ?? null
}

function normalizeOptionalArticleFeatures(value: unknown): OptionalArticleFeature[] {
  const rawValues = Array.isArray(value)
    ? value
    : typeof value === 'string'
      ? value.split(/[,\s]+/)
      : []
  const result: OptionalArticleFeature[] = []
  for (const item of rawValues) {
    const feature = normalizeOptionalArticleFeature(item)
    if (feature && !result.includes(feature)) {
      result.push(feature)
    }
  }
  return result
}

function withBestEffortArticleFeatures(params: Record<string, unknown>) {
  const nextParams = { ...params }
  const features = new Set<OptionalArticleFeature>([
    ...normalizeOptionalArticleFeatures(nextParams['requested_features']),
    ...normalizeOptionalArticleFeatures(nextParams['requestedFeatures']),
  ])

  features.delete('poll')
  features.delete('wechat_channel_video')
  if (nextParams['insert_poll'] === true) {
    features.add('poll')
  }
  if (nextParams['insert_video_channel'] === true) {
    features.add('wechat_channel_video')
  }

  const requestedFeatures = Array.from(features)
  delete nextParams['requestedFeatures']
  delete nextParams['featurePolicy']
  if (requestedFeatures.length > 0) {
    nextParams['requested_features'] = requestedFeatures
    nextParams['feature_policy'] = nextParams['feature_policy'] || 'best_effort'
  }
  else {
    delete nextParams['requested_features']
    delete nextParams['feature_policy']
  }
  return nextParams
}

function resolveArticleHtml(option?: {
  orchestration?: { articleHtml?: string }
  article?: { html?: string, body?: string }
  [key: string]: unknown
}) {
  const topLevelArticleHtml = option?.['articleHtml']
  if (typeof topLevelArticleHtml === 'string' && topLevelArticleHtml) {
    return topLevelArticleHtml
  }
  if (typeof option?.article?.html === 'string' && option.article.html) {
    return option.article.html
  }
  return option?.orchestration?.articleHtml
}

@Injectable()
export class OrchestrationPublishService extends PublishService {
  private readonly logger = new Logger(OrchestrationPublishService.name)

  constructor(
    private readonly orchestrationClient: OrchestrationPublishClient,
    private readonly channelAccountService: ChannelAccountService,
    private readonly assetsService: AssetsService,
  ) {
    super()
  }

  override async validatePublishParams(publishTask: CreatePublishDto): Promise<{ success: boolean, message?: string }> {
    if (publishTask.type !== PublishType.ARTICLE) {
      return { success: false, message: 'Orchestration mobile publish only supports article records' }
    }
    const account = await this.channelAccountService.getAccountInfo(publishTask.accountId)
    if (!account) {
      return { success: false, message: 'Account not found' }
    }
    if (account.externalProvider !== ORCHESTRATION_PROVIDER) {
      return { success: false, message: 'Account is not linked to ai-orchestration' }
    }
    const contentType = this.resolveContentType(publishTask.accountType, publishTask.option?.orchestration?.contentType, publishTask.imgUrlList)
    if (!contentType) {
      return { success: false, message: 'Unsupported orchestration content type' }
    }
    const articleHtml = resolveArticleHtml(publishTask.option)
    if (!publishTask.desc && !articleHtml) {
      return { success: false, message: 'Content body is required' }
    }
    if (contentType !== 'weitoutiao' && !publishTask.title) {
      return { success: false, message: 'Title is required' }
    }
    const externalMeta = account.externalMeta || {}
    const capabilities = externalMeta['capabilities'] as { contentTypes?: string[] } | undefined
    const targetSnapshot = externalMeta['targetSnapshot'] as { contentTypes?: string[] } | undefined
    const allowed = capabilities?.contentTypes
      || targetSnapshot?.contentTypes
      || []
    if (allowed.length > 0 && !allowed.includes(contentType)) {
      return { success: false, message: `Content type ${contentType} is not enabled on this orchestration target` }
    }
    return { success: true }
  }

  async immediatePublish(publishTask: PublishRecord): Promise<PublishingTaskResult> {
    if (!publishTask.accountId) {
      throw PublishingException.nonRetryable('Account ID is required')
    }
    const account = await this.channelAccountService.getAccountInfo(publishTask.accountId)
    if (!account || account.externalProvider !== ORCHESTRATION_PROVIDER) {
      throw PublishingException.nonRetryable('Account is not linked to ai-orchestration')
    }
    const contentType = this.resolveContentType(
      publishTask.accountType,
      publishTask.option?.orchestration?.contentType,
      publishTask.imgUrlList,
    )
    if (!contentType) {
      throw PublishingException.nonRetryable('Unsupported orchestration content type')
    }
    const callbackUrl = this.orchestrationClient.callbackUrl()
    if (!callbackUrl) {
      throw PublishingException.nonRetryable('Orchestration callback URL is not configured')
    }

    const imageUrls = (publishTask.imgUrlList || []).map(url => this.buildAssetUrl(url)).filter(Boolean)
    const coverUrl = publishTask.coverUrl ? this.buildAssetUrl(publishTask.coverUrl) : undefined
    const requestId = `aitoearn:${publishTask.id}`
    const platform = publishTask.accountType === AccountType.WxGzh ? AccountType.WxGzh : AccountType.Toutiao
    const publishTargetId = publishTask.option?.orchestration?.publishTargetId || account.externalId || account.uid
    const orchestrationParams = withBestEffortArticleFeatures(publishTask.option?.orchestration?.params || {})
    const articleHtml = resolveArticleHtml(publishTask.option)
    const response = await this.orchestrationClient.createPublishTask({
      business_system: 'aitoearn',
      request_id: requestId,
      external_record_id: publishTask.id,
      publish_target_id: publishTargetId,
      platform,
      content_type: contentType,
      callback_url: callbackUrl,
      priority: 5,
      user_id: publishTask.userId,
      content: {
        title: publishTask.title || '',
        body: publishTask.desc || '',
        html: articleHtml,
        image_urls: imageUrls,
        media_urls: imageUrls,
        cover_url: coverUrl,
        topics: publishTask.topics || [],
        extra: {
          ...(publishTask.option?.wxGzh || {}),
          ...orchestrationParams,
          materialId: publishTask.materialId,
          materialGroupId: publishTask.materialGroupId,
        },
      },
      metadata: {
        accountId: publishTask.accountId,
        accountType: publishTask.accountType,
        flowId: publishTask.flowId,
      },
    })

    const dataOption = {
      ...(publishTask.dataOption || {}),
      orchestration: {
        ...(publishTask.dataOption?.['orchestration'] || {}),
        publishTaskId: response.publishTaskId,
        internalTaskId: response.internalTaskId,
        publishTargetId,
        requestId,
        contentType,
        status: response.status,
        submittedAt: new Date().toISOString(),
      },
    }
    await this.publishRecordService.updateById(publishTask.id, {
      $set: { dataOption },
    })

    this.logger.log(`Submitted orchestration publish task ${response.publishTaskId} for publishRecord ${publishTask.id}`)
    return {
      status: PublishStatus.PUBLISHING,
      postId: response.publishTaskId,
      permalink: '',
      extra: {
        orchestration: dataOption.orchestration,
      },
    }
  }

  async verifyAndCompletePublish(publishRecord: PublishRecord): Promise<VerifyPublishResult> {
    const orchestrationOption = publishRecord.dataOption?.['orchestration'] as { publishTaskId?: string } | undefined
    const publishTaskId = orchestrationOption?.publishTaskId || publishRecord.dataId
    if (!publishTaskId) {
      return { success: false, errorMsg: 'Missing orchestration publishTaskId' }
    }
    const task = await this.orchestrationClient.getPublishTask(publishTaskId)
    const taskStatus = task['status']
    const resultPayload = (task['result_payload'] || {}) as Record<string, any>
    const nestedResult = (resultPayload['result'] || {}) as Record<string, any>
    if (taskStatus === 'COMPLETED') {
      const workLink = resultPayload['workLink'] || nestedResult['workLink'] || publishRecord.workLink
      return { success: true, workLink }
    }
    return {
      success: false,
      errorMsg: task['error_message'] || `Orchestration publish task is ${taskStatus}`,
    }
  }

  private resolveContentType(
    accountType: AccountType,
    contentType?: string,
    imgUrlList?: string[],
  ): OrchestrationContentType | null {
    if (contentType && CONTENT_TYPES.includes(contentType as OrchestrationContentType)) {
      return contentType as OrchestrationContentType
    }
    if (accountType === AccountType.WxGzh) {
      return imgUrlList && imgUrlList.length > 0 ? 'image_text' : 'article'
    }
    if (accountType === AccountType.Toutiao) {
      return 'article'
    }
    return null
  }

  private buildAssetUrl(value: string) {
    if (!value) {
      return ''
    }
    if (/^(?:https?:|data:|file:)/i.test(value)) {
      return value
    }
    return this.assetsService.buildUrl(value)
  }
}
