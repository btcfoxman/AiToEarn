import { BadRequestException, Body, Controller, NotFoundException, Post } from '@nestjs/common'
import { Internal } from '@yikart/aitoearn-auth'
import { AccountType } from '@yikart/common'
import { AccountStatus, PublishRecordRepository, PublishStatus } from '@yikart/mongodb'
import { ArchiveStatus } from '../channel/libs/bilibili/common'
import { BilibiliService } from '../channel/platforms/bilibili/bilibili.service'
import { ChannelAccountService } from '../channel/platforms/channel-account.service'
import { YoutubeService } from '../channel/platforms/youtube/youtube.service'
import { MaterialService } from '../content/material.service'
import { missingMetrics, observedMetrics, publicationProjection } from './orchestration-outcome'

@Controller('internal/orchestration/outcomes')
@Internal()
export class OrchestrationOutcomeInternalController {
  constructor(
    private readonly materials: MaterialService,
    private readonly records: PublishRecordRepository,
    private readonly accounts: ChannelAccountService,
    private readonly bilibili: BilibiliService,
    private readonly youtube: YoutubeService,
  ) {}

  @Post('query')
  async query(@Body() body: { userId: string, materialId: string, sourceKey: string, includeMetrics?: boolean }) {
    if (![body?.userId, body?.sourceKey].every(value => typeof value === 'string' && value.length > 0 && value.length <= 256)
      || !/^[a-f0-9]{24}$/i.test(body?.materialId || ''))
      throw new BadRequestException('userId, materialId and sourceKey are required')
    const material = await this.materials.getInfo(body.materialId)
    if (!material || material.userId !== body.userId
      || material.option?.['orchestration']?.sourceKey !== body.sourceKey)
      throw new NotFoundException('orchestration material not found')
    const records = await this.records.listOrchestrationMaterialRecords(body.userId, body.materialId, 101)
    const publications = []
    const now = new Date()
    for (const record of records.slice(0, 100)) {
      const projection = publicationProjection(record)
      if (record.status === PublishStatus.PUBLISHED && projection.accountId && projection.workId) {
        try {
          const account = await this.accounts.getAccountInfo(projection.accountId)
          if (!account || account.userId !== body.userId || account.type !== projection.platform
            || account.status !== AccountStatus.NORMAL || account.relayAccountRef) {
            projection.metrics = missingMetrics('account_not_authorized_or_requires_relay')
          }
          else {
            let youtubeStats: Record<string, string> | undefined
            if (projection.platform === AccountType.BILIBILI) {
              // The existing provider records upload acceptance as PUBLISHED.
              // Match only the platform's pubed list; missing from this bounded
              // lookup is unknown, never proof of failure or permission to repost.
              for (let page = 1; page <= 3; page++) {
                const archives = await this.bilibili.getArchiveListByAccountId(projection.accountId,
                  { ps: 20, pn: page, status: ArchiveStatus.pubed })
                const archive = archives.list?.find(item => String(item.resource_id) === projection.workId)
                const stamp = archive && new Date(Number(archive.ptime) * 1000)
                if (archive && stamp && Number.isFinite(stamp.getTime()) && stamp.getTime() > 0) {
                  projection.status = 'published'
                  projection.publishedAt = stamp.toISOString()
                  projection.publicationEvidence = 'bilibili_pubed_archive'
                  projection.statusReason = null
                  break
                }
                if (!archives.list?.length || page * 20 >= Number(archives.page?.total || 0))
                  break
              }
            }
            else if (projection.platform === AccountType.YOUTUBE) {
              const result = await this.youtube.getVideosListByAccountId(projection.accountId, undefined, [projection.workId])
              const video = (result as { items?: Array<{ id?: string, snippet?: { publishedAt?: string },
                status?: { privacyStatus?: string, uploadStatus?: string }, statistics?: Record<string, string> }> })
                ?.items?.find(item => item.id === projection.workId)
              const stamp = video?.snippet?.publishedAt && new Date(video.snippet.publishedAt)
              if (video?.status?.privacyStatus === 'public' && video.status.uploadStatus === 'processed'
                && stamp && Number.isFinite(stamp.getTime())) {
                projection.status = 'published'
                projection.publishedAt = stamp.toISOString()
                projection.publicationEvidence = 'youtube_public_processed_video'
                projection.statusReason = null
                youtubeStats = video.statistics
              }
            }
            if (projection.status !== 'published') {
              projection.metrics = missingMetrics('platform_public_state_not_confirmed')
            }
            else if (body.includeMetrics !== true) {
              projection.metrics = missingMetrics('metrics_not_requested')
            }
            else if (now.getTime() - new Date(projection.publishedAt!).getTime() < 86400000) {
              projection.metrics = missingMetrics('first_collection_at_T_plus_1', 'not_due')
            }
            else if (projection.platform === AccountType.BILIBILI) {
              const stats = await this.bilibili.getArcStatByAccountId(projection.accountId, projection.workId)
              projection.metrics = observedMetrics({ views: stats.view, likes: stats.like, comments: stats.reply,
                shares: stats.share, saves: stats.favorite }, 'bilibili_post_statistics')
            }
            else if (projection.platform === AccountType.YOUTUBE) {
              // Do not use dataCube's legacy missing-value => zero coercion.
              projection.metrics = youtubeStats
                ? observedMetrics({ views: youtubeStats['viewCount'], likes: youtubeStats['likeCount'], comments: youtubeStats['commentCount'] }, 'youtube_video_statistics')
                : missingMetrics('provider_did_not_return_statistics', 'error')
            }
          }
        }
        catch { projection.metrics = missingMetrics('provider_query_failed', 'error') }
      }
      publications.push(projection)
    }
    return { schemaVersion: 'operator.publisher_outcome.v1', userId: body.userId,
      materialId: body.materialId, sourceKey: body.sourceKey, observedAt: now.toISOString(),
      publications, truncated: records.length > 100, publishingActions: 0 }
  }
}
