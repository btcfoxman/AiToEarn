import { BadRequestException, Body, ConflictException, Controller, Get, NotFoundException, Param, Post, Query } from '@nestjs/common'
import { Internal } from '@yikart/aitoearn-auth'
import { AccountType } from '@yikart/common'
import { AccountStatus, MediaType, PublishRecordRepository, PublishType } from '@yikart/mongodb'
import { ChannelAccountService } from '../channel/platforms/channel-account.service'
import { CreatePublishSchema } from '../channel/publishing/publish.dto'
import { PublishingService } from '../channel/publishing/publishing.service'
import { MaterialService } from '../content/material.service'
import { normalizeAccountType, sha256 } from './orchestration-draft-import'
import { publicationProjection } from './orchestration-outcome'

export interface OrchestrationPublishingIntent {
  intentId: string
  approvalId: string
  userId: string
  packageId: string
  packageVersion: number
  variantId: string
  materialId: string
  sourceKey: string
  accountId: string
  channel: string
  scheduledAt: string
  contentSha256: string
  publishingOptions?: Record<string, unknown>
}

@Controller('internal/orchestration/publishing')
@Internal()
export class OrchestrationPublishingIntentController {
  constructor(
    private readonly materials: MaterialService,
    private readonly accounts: ChannelAccountService,
    private readonly records: PublishRecordRepository,
    private readonly publishing: PublishingService,
  ) {}

  @Get('intents/:intentId')
  async getIntent(@Param('intentId') intentId: string, @Query('userId') userId: string) {
    if (![intentId, userId].every(value => typeof value === 'string' && value.length > 0 && value.length <= 256))
      throw new BadRequestException('intentId and userId are required')
    const record = await this.records.getById(sha256({ userId, intentId }).slice(0, 24))
    const binding = record?.option?.orchestrationIntent
    if (!record || record.userId !== userId || binding?.intentId !== intentId)
      throw new NotFoundException('publication intent not found')
    return { ...publicationProjection(record), intentId, materialId: record.materialId,
      approvedScopeHash: binding.requestHash, idempotent: true }
  }

  @Get('accounts')
  async availableAccounts(@Query('userId') userId: string) {
    if (typeof userId !== 'string' || !userId.trim() || userId.length > 256)
      throw new BadRequestException('userId is required')
    const accounts = await this.accounts.getUserAccountList(userId)
    const channels: Record<string, string[]> = {
      [AccountType.WechatMoments]: ['wechat_moments'], [AccountType.WxGzh]: ['wechat_mp'],
      [AccountType.Toutiao]: ['toutiao', 'weitoutiao'], [AccountType.Douyin]: ['douyin'],
      [AccountType.KWAI]: ['kuaishou'], [AccountType.BILIBILI]: ['bilibili'],
      [AccountType.YOUTUBE]: ['youtube'], [AccountType.TIKTOK]: ['tiktok'],
      [AccountType.TWITTER]: ['twitter'], [AccountType.FACEBOOK]: ['facebook'],
      [AccountType.INSTAGRAM]: ['instagram'], [AccountType.THREADS]: ['threads'],
      [AccountType.PINTEREST]: ['pinterest'], [AccountType.LINKEDIN]: ['linkedin'],
      [AccountType.GOOGLE_BUSINESS]: ['google_business'],
    }
    return accounts.filter(account => account.userId === userId).map((account) => {
      const supported = channels[account.type] || []
      const connected = account.status === AccountStatus.NORMAL && !account.relayAccountRef
      const needsTarget = [AccountType.WechatMoments, AccountType.Toutiao].includes(account.type)
      const linked = !needsTarget || account.externalProvider === 'ai-orchestration'
      const interactive = account.type === AccountType.Douyin
      const canPublish = connected && supported.length > 0 && linked && !interactive
      const contentRequirements = [AccountType.BILIBILI, AccountType.YOUTUBE, AccountType.KWAI].includes(account.type)
        ? ['video', ...(account.type === AccountType.BILIBILI ? ['cover', 'platform_options'] : []),
          ...(account.type === AccountType.YOUTUBE ? ['platform_options'] : [])]
        : account.type === AccountType.WxGzh && account.externalProvider !== 'ai-orchestration' ? ['image'] : []
      return { accountId: String(account.id || account._id), accountName: account.nickname || account.account || account.type,
        type: account.type, channel: supported[0] || account.type, channels: supported,
        capabilityScope: 'account_and_provider_availability', contentRequirements,
        connected, canPublish, reason: !connected ? 'account_disconnected_or_relay_required'
          : interactive ? 'interactive_share_required' : !supported.length ? 'publisher_not_supported'
            : !linked ? 'orchestration_target_not_linked' : null }
    })
  }

  @Post('intents')
  async create(@Body() input: OrchestrationPublishingIntent) {
    const required = ['intentId', 'approvalId', 'userId', 'packageId', 'variantId', 'sourceKey', 'accountId', 'channel'] as const
    if (!input || !required.every(key => typeof input[key] === 'string' && input[key].trim() === input[key] && input[key].length > 0 && input[key].length <= 256)
      || !Number.isInteger(input.packageVersion) || input.packageVersion < 1
      || !/^[a-f0-9]{24}$/i.test(input.materialId || '') || !/^[a-f0-9]{64}$/i.test(input.contentSha256 || '')
      || typeof input.scheduledAt !== 'string' || !/(Z|[+-]\d\d:\d\d)$/.test(input.scheduledAt))
      throw new BadRequestException('an exact approved publication intent is required')
    const scheduled = new Date(input.scheduledAt)
    if (!Number.isFinite(scheduled.getTime()))
      throw new BadRequestException('scheduledAt must be a valid timezone-aware timestamp')
    const body: OrchestrationPublishingIntent = Object.fromEntries(
      [...required, 'packageVersion', 'materialId', 'contentSha256'].map(key => [key, input[key as keyof OrchestrationPublishingIntent]]),
    ) as unknown as OrchestrationPublishingIntent
    body.scheduledAt = scheduled.toISOString()
    if (input.publishingOptions !== undefined) {
      const options = CreatePublishSchema.shape.option.safeParse(input.publishingOptions)
      if (!options.success || !options.data || Object.keys(options.data).some(key => !['bilibili', 'youtube'].includes(key)))
        throw new BadRequestException('only explicitly approved video category/copyright options are accepted')
      body.publishingOptions = options.data
    }
    const requestHash = sha256(body)
    // Mongo's built-in unique _id is the concurrent idempotency fence. The
    // original publishing service passes it through into the existing record.
    const recordId = sha256({ userId: body.userId, intentId: body.intentId }).slice(0, 24)
    const response = (record: any, idempotent: boolean) => {
      if (record.userId !== body.userId || record.option?.orchestrationIntent?.requestHash !== requestHash)
        throw new ConflictException('intentId has already been used with different approved scope')
      return { intentId: body.intentId, materialId: body.materialId, idempotent,
        ...publicationProjection(record), approvedScopeHash: requestHash }
    }
    const existing = await this.records.getById(recordId)
    if (existing)
      return response(existing, true)
    // Orchestration owns this intent's clock; AiToEarn only executes when due.
    // Do not let the Douyin immediate path publish a future-approved item early.
    if (scheduled.getTime() > Date.now() || Date.now() - scheduled.getTime() > 86400000)
      throw new ConflictException('intent is not due or approval schedule is more than one day overdue')
    const material = await this.materials.getInfo(body.materialId)
    const origin = material?.option?.['orchestration']
    if (!material || material.userId !== body.userId || origin?.sourceKey !== body.sourceKey)
      throw new NotFoundException('orchestration material not found')
    const snapshot = origin.publicContent
    if (!snapshot || origin.packageId !== body.packageId || origin.sourceId !== body.variantId
      || Number(origin.raw?.version) !== body.packageVersion || origin.contentSha256 !== body.contentSha256
      || sha256(snapshot) !== body.contentSha256)
      throw new ConflictException('material is not the exact approved package version and variant')
    const accountType = normalizeAccountType(body.channel)
    const account = await this.accounts.getAccountInfo(body.accountId)
    if (!account || account.userId !== body.userId || account.type !== accountType || account.relayAccountRef
      || account.status !== AccountStatus.NORMAL
      || normalizeAccountType(snapshot.platform) !== accountType)
      throw new BadRequestException('account, user and approved channel must match')
    // Only configured publishing providers; an adapter is not permission to
    // claim support for every platform that exists in the account enum.
    if (!accountType || [AccountType.Xhs, AccountType.WxSph].includes(accountType))
      throw new BadRequestException('approved channel has no publisher in this deployment')
    if (accountType === AccountType.Douyin)
      throw new BadRequestException({ code: 'interactive_publish_required', message: 'This provider requires opening the share link manually; it is not an autonomous publisher.' })
    const media = Array.isArray(snapshot.media) ? snapshot.media : []
    const video = media.find((item: any) => item.type === MediaType.VIDEO)
    if ([AccountType.BILIBILI, AccountType.YOUTUBE, AccountType.KWAI].includes(accountType) && !video)
      throw new BadRequestException({ code: 'publication_video_required', message: 'An approved video asset is required for this account.' })
    if (accountType === AccountType.BILIBILI && !snapshot.coverUrl)
      throw new BadRequestException({ code: 'publication_cover_required', message: 'An approved cover asset is required for this account.' })
    if ((accountType === AccountType.BILIBILI && !body.publishingOptions?.['bilibili'])
      || (accountType === AccountType.YOUTUBE && !body.publishingOptions?.['youtube']))
      throw new BadRequestException({ code: 'publication_platform_options_required', message: 'Platform category/copyright options must be included in a separately approved publication scope.' })
    if (accountType === AccountType.WxGzh && account.externalProvider !== 'ai-orchestration'
      && !media.some((item: any) => item.type === MediaType.IMG))
      throw new BadRequestException({ code: 'publication_image_required', message: 'This native account publishes image posts and requires an approved image asset.' })
    const options = {
      ...body.publishingOptions,
      orchestration: { contentType: snapshot.format === 'weitoutiao' ? 'weitoutiao'
        : accountType === AccountType.WechatMoments ? 'image_text' : 'article',
      articleHtml: snapshot.html, articleBody: snapshot.body },
    }
    const parsed = CreatePublishSchema.safeParse({
      flowId: `orchestration:${recordId}`, userId: body.userId, accountId: body.accountId,
      accountType, type: video ? PublishType.VIDEO : PublishType.ARTICLE,
      materialId: body.materialId, materialGroupId: material.groupId,
      publishTime: scheduled, title: snapshot.title, desc: snapshot.body,
      topics: snapshot.topics || [], videoUrl: video?.url, coverUrl: snapshot.coverUrl || undefined,
      imgUrlList: media.filter((item: any) => item.type === MediaType.IMG).map((item: any) => item.url),
      option: options,
    })
    if (!parsed.success)
      throw new BadRequestException('approved material is missing required platform publishing options')
    try {
      await this.publishing.createPublishingTask({
        ...parsed.data, _id: recordId,
        option: { ...parsed.data.option, orchestrationIntent: { ...body, requestHash } },
      } as any, body.userId)
    }
    catch (error) {
      // A concurrent insert or lost response must not create another post.
      // If persistence succeeded, the existing publisher/scheduler owns recovery.
      const persisted = await this.records.getById(recordId)
      if (persisted)
        return response(persisted, true)
      throw error
    }
    const created = await this.records.getById(recordId)
    if (!created)
      throw new ConflictException('publisher record not yet observable; retry the same intentId')
    return response(created, false)
  }
}
