import { Body, Controller, Get, Post, Query } from '@nestjs/common'
import { GetToken, TokenInfo } from '@yikart/aitoearn-auth'
import { AccountType, AppException, ResponseCode } from '@yikart/common'
import { AccountService } from '../../account/account.service'
import { OrchestrationPublishClient } from './orchestration-publish.client'
import { LinkOrchestrationTargetDto, OrchestrationPublishTargetsQueryDto } from './orchestration-publish.dto'

function normalizePublishFeatures(value: unknown) {
  const rawValues = Array.isArray(value)
    ? value
    : typeof value === 'string'
      ? value.split(/[,\s]+/)
      : []
  const result: string[] = []
  for (const item of rawValues) {
    const feature = String(item ?? '').trim()
    if (feature && !result.includes(feature)) {
      result.push(feature)
    }
  }
  return result
}

function getTargetPublishFeatures(target: {
  features?: unknown
  capabilities?: {
    features?: unknown
    publishFeatures?: unknown
    publish_features?: unknown
    supportedFeatures?: unknown
    supported_features?: unknown
  }
}) {
  const capabilities = target.capabilities || {}
  return [...new Set([
    ...normalizePublishFeatures(target.features),
    ...normalizePublishFeatures(capabilities.features),
    ...normalizePublishFeatures(capabilities.publishFeatures),
    ...normalizePublishFeatures(capabilities.publish_features),
    ...normalizePublishFeatures(capabilities.supportedFeatures),
    ...normalizePublishFeatures(capabilities.supported_features),
  ])]
}

@Controller('plat/orchestration')
export class OrchestrationPublishController {
  constructor(
    private readonly orchestrationClient: OrchestrationPublishClient,
    private readonly accountService: AccountService,
  ) {}

  @Get('publish-targets')
  async getPublishTargets(@Query() query: OrchestrationPublishTargetsQueryDto) {
    return this.orchestrationClient.getPublishTargets(query)
  }

  @Post('link-target')
  async linkTarget(@GetToken() token: TokenInfo, @Body() body: LinkOrchestrationTargetDto) {
    const target = await this.orchestrationClient.findPublishTarget({
      publishTargetId: body.publishTargetId,
      platform: body.platform,
      contentType: body.contentType,
    })
    if (!target) {
      throw new AppException(ResponseCode.AccountNotFound, 'Orchestration publish target not found')
    }
    if (!target.ready) {
      throw new AppException(ResponseCode.AccountNotFound, `Orchestration publish target not ready: ${target.reason || target.status}`)
    }

    const features = getTargetPublishFeatures(target)
    const accountType = target.platform === AccountType.WxGzh ? AccountType.WxGzh : AccountType.Toutiao
    const accountName = target.accountName || target.publishTargetId
    const account = await this.accountService.addAccount(token.id, {
      type: accountType,
      uid: target.publishTargetId,
      account: accountName,
      nickname: accountName,
      avatar: '',
      groupId: body.groupId,
      externalProvider: 'ai-orchestration',
      externalId: target.publishTargetId,
      externalPlatform: target.platform,
      externalMeta: {
        provider: 'ai-orchestration',
        publishTargetId: target.publishTargetId,
        accountAssetId: target.accountAssetId,
        capabilities: {
          contentTypes: target.contentTypes || target.capabilities?.contentTypes || [],
          features,
        },
        targetSnapshot: target,
      },
    })
    return account
  }
}
