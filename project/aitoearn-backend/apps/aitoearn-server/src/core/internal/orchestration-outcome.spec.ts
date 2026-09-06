import { AccountType } from '@yikart/common'
import { PublishStatus } from '@yikart/mongodb'
import { describe, expect, it, vi } from 'vitest'
import { sha256 } from './orchestration-draft-import'
import { observedMetrics, publicationProjection } from './orchestration-outcome'
import { OrchestrationOutcomeInternalController } from './orchestration-outcome.controller'
import { OrchestrationPublishingIntentController } from './orchestration-publishing-intent.controller'

vi.mock('@yikart/aitoearn-auth', () => ({ Internal: () => () => undefined }))
vi.mock('@yikart/mongodb', () => ({
  PublishStatus: { FAILED: -1, WaitingForPublish: 0, PUBLISHED: 1, PUBLISHING: 2 },
  PublishType: { VIDEO: 'video', ARTICLE: 'article' }, PublishRecordSource: { PUBLISH: 'publish' },
  MediaType: { IMG: 'img', VIDEO: 'video' }, PublishRecordRepository: class {},
  AccountStatus: { NORMAL: 1, ABNORMAL: 0 },
}))
vi.mock('../content/material.service', () => ({ MaterialService: class {} }))
vi.mock('../channel/platforms/channel-account.service', () => ({ ChannelAccountService: class {} }))
vi.mock('../channel/platforms/bilibili/bilibili.service', () => ({ BilibiliService: class {} }))
vi.mock('../channel/platforms/youtube/youtube.service', () => ({ YoutubeService: class {} }))
vi.mock('../channel/publishing/publishing.service', () => ({ PublishingService: class {} }))

describe('orchestration outcome truth contract', () => {
  it('keeps real zero distinct from absent/invalid values', () => {
    const metrics = observedMetrics({ views: 0, likes: undefined, comments: NaN, shares: '12' }, 'platform')
    expect(metrics.find(item => item.name === 'views')).toMatchObject({ availability: 'available', value: 0 })
    expect(metrics.find(item => item.name === 'likes')).toMatchObject({ availability: 'unavailable', value: null })
    expect(metrics.find(item => item.name === 'comments')?.value).toBeNull()
    expect(metrics.find(item => item.name === 'shares')?.value).toBe(12)
  })

  it('requires durable evidence before treating publisher success as published', () => {
    const record = { id: 'r1', accountId: 'a1', accountType: AccountType.WxGzh,
      status: PublishStatus.PUBLISHED, publishTime: '2026-08-01T12:00:00Z' }
    expect(publicationProjection(record).status).toBe('unknown')
    expect(publicationProjection({ ...record, dataId: 'platform-id' }).status).toBe('published')
    expect(publicationProjection({ ...record, workLink: 'javascript:alert(1)' }).status).toBe('unknown')
  })

  it('returns no publications for imported material, and scopes material to owner/source', async () => {
    const materialId = '111111111111111111111111'
    const controller = new OrchestrationOutcomeInternalController(
      { getInfo: async () => ({ userId: 'u1', option: { orchestration: { sourceKey: 'key' } } }) } as any,
      { listOrchestrationMaterialRecords: async (user: string, id: string) => {
        expect([user, id]).toEqual(['u1', materialId])
        return []
      } } as any, {} as any, {} as any, {} as any,
    )
    const result = await controller.query({ userId: 'u1', materialId, sourceKey: 'key' })
    expect(result.publications).toEqual([])
    expect(result.publishingActions).toBe(0)
    await expect(controller.query({ userId: 'other', materialId, sourceKey: 'key' })).rejects.toThrow('not found')
  })

  it('does not confuse video upload acceptance with a public processed YouTube work', async () => {
    const materialId = '111111111111111111111111'
    const record = { id: 'r1', accountId: 'a1', accountType: AccountType.YOUTUBE,
      dataId: 'video1', status: PublishStatus.PUBLISHED, publishTime: '2020-08-01T12:00:00Z' }
    expect(publicationProjection(record).status).toBe('unknown')
    let privacyStatus = 'private'
    const controller = new OrchestrationOutcomeInternalController(
      { getInfo: async () => ({ userId: 'u1', option: { orchestration: { sourceKey: 'key' } } }) } as any,
      { listOrchestrationMaterialRecords: async () => [record] } as any,
      { getAccountInfo: async () => ({ userId: 'u1', type: AccountType.YOUTUBE, status: 1 }) } as any,
      {} as any,
      { getVideosListByAccountId: async () => ({ items: [{ id: 'video1', snippet: { publishedAt: record.publishTime },
        status: { privacyStatus, uploadStatus: 'processed' }, statistics: { viewCount: '0' } }] }) } as any,
    )
    const query = { userId: 'u1', materialId, sourceKey: 'key', includeMetrics: true }
    expect((await controller.query(query)).publications[0].status).toBe('unknown')
    privacyStatus = 'public'
    const published = (await controller.query(query)).publications[0]
    expect(published.status).toBe('published')
    expect(published.publicationEvidence).toBe('youtube_public_processed_video')
    expect(published.metrics[0]).toMatchObject({ availability: 'available', value: 0 })
    expect(published.metrics[1].value).toBeNull()
  })

  it('confirms Bilibili only by an exact work in the bounded published archive lookup', async () => {
    const materialId = '111111111111111111111111'
    const record = { id: 'r1', accountId: 'a1', accountType: AccountType.BILIBILI,
      dataId: 'video1', status: PublishStatus.PUBLISHED, publishTime: '2020-08-01T12:00:00Z' }
    expect(publicationProjection(record).status).toBe('unknown')
    let resourceId = 'another-work'
    const controller = new OrchestrationOutcomeInternalController(
      { getInfo: async () => ({ userId: 'u1', option: { orchestration: { sourceKey: 'key' } } }) } as any,
      { listOrchestrationMaterialRecords: async () => [record] } as any,
      { getAccountInfo: async () => ({ userId: 'u1', type: AccountType.BILIBILI, status: 1 }) } as any,
      { getArchiveListByAccountId: async (_id: string, params: any) => {
        expect(params.status).toBe('pubed')
        return { list: [{ resource_id: resourceId, ptime: 1596283200 }], page: { total: 1 } }
      }, getArcStatByAccountId: async () => ({ view: 10 }) } as any,
      {} as any,
    )
    const query = { userId: 'u1', materialId, sourceKey: 'key', includeMetrics: true }
    expect((await controller.query(query)).publications[0].status).toBe('unknown')
    resourceId = 'video1'
    const published = (await controller.query(query)).publications[0]
    expect(published.status).toBe('published')
    expect(published.publicationEvidence).toBe('bilibili_pubed_archive')
    expect(published.metrics[0].value).toBe(10)
  })

  it('lists only the configured user accounts and reports disconnected/unsupported channels honestly', async () => {
    const controller = new OrchestrationPublishingIntentController({} as any,
      { getUserAccountList: async () => [
        { id: 'one', userId: 'u1', type: AccountType.Toutiao, status: 1, externalProvider: 'ai-orchestration' },
        { id: 'two', userId: 'u1', type: AccountType.WxGzh, status: 0 },
        { id: 'three', userId: 'u1', type: AccountType.Xhs, status: 1 },
        { id: 'video', userId: 'u1', type: AccountType.YOUTUBE, status: 1 },
        { id: 'interactive', userId: 'u1', type: AccountType.Douyin, status: 1 },
        { id: 'private', userId: 'other', type: AccountType.WxGzh, status: 1 },
      ] } as any, {} as any, {} as any)
    const rows = await controller.availableAccounts('u1')
    expect(rows).toHaveLength(5)
    expect(rows[0]).toMatchObject({ canPublish: true, channels: ['toutiao', 'weitoutiao'] })
    expect(rows[1]).toMatchObject({ connected: false, canPublish: false })
    expect(rows[2]).toMatchObject({ connected: true, canPublish: false, reason: 'publisher_not_supported' })
    expect(rows[3]).toMatchObject({ canPublish: true, contentRequirements: ['video', 'platform_options'] })
    expect(rows[4]).toMatchObject({ canPublish: false, reason: 'interactive_share_required' })
  })
})

function intentFixture() {
  const snapshot = { title: 'Approved final title', body: 'Approved final body', html: '<p>Approved final body</p>',
    platform: 'wechat_moments', format: 'post', media: [], topics: [] }
  const intent = { intentId: 'intent1', approvalId: 'approval1', userId: 'u1', packageId: 'p1', packageVersion: 5,
    variantId: 'v1', materialId: '111111111111111111111111', sourceKey: 'source1', accountId: 'a1',
    channel: 'wechat_moments', scheduledAt: new Date(Date.now() - 1000).toISOString(), contentSha256: sha256(snapshot) }
  const store = new Map<string, any>()
  const invocations: any[] = []
  const controller = new OrchestrationPublishingIntentController(
    { getInfo: async () => ({ userId: 'u1', groupId: 'g1', title: 'mutable tampered material title',
      option: { orchestration: { publicContent: snapshot, sourceKey: 'source1', packageId: 'p1', sourceId: 'v1',
        contentSha256: sha256(snapshot), raw: { version: 5 } } } }) } as any,
    { getAccountInfo: async () => ({ userId: 'u1', type: AccountType.WechatMoments, status: 1 }) } as any,
    { getById: async (id: string) => store.get(id) } as any,
    { createPublishingTask: async (task: any) => {
      invocations.push(task)
      if (store.has(task._id))
        throw new Error('duplicate key')
      store.set(task._id, { ...task, id: task._id, userId: 'u1', status: PublishStatus.WaitingForPublish })
    } } as any,
  )
  return { controller, intent, store, invocations }
}

describe('orchestration approved intent bridge', () => {
  it('uses frozen final content and returns the same record for identical retries', async () => {
    const { controller, intent, invocations } = intentFixture()
    const first = await controller.create(intent)
    const second = await controller.create(intent)
    expect(first.publishRecordId).toBe(second.publishRecordId)
    expect(second.idempotent).toBe(true)
    expect(invocations).toHaveLength(1)
    expect(invocations[0].title).toBe('Approved final title')
    expect(first.status).toBe('scheduled')
  })

  it('rejects idempotency key reuse with altered approval scope', async () => {
    const { controller, intent } = intentFixture()
    await controller.create(intent)
    await expect(controller.create({ ...intent, accountId: 'other' })).rejects.toThrow('different approved scope')
  })

  it('rejects missing approval, content mismatch, account mismatch and premature execution', async () => {
    const { controller, intent, invocations } = intentFixture()
    for (const changed of [
      { ...intent, approvalId: '' }, { ...intent, contentSha256: 'a'.repeat(64) },
      { ...intent, channel: 'douyin' }, { ...intent, packageVersion: 6 },
      { ...intent, scheduledAt: new Date(Date.now() + 3600000).toISOString() },
    ]) {
      await expect(controller.create(changed)).rejects.toThrow()
    }
    expect(invocations).toHaveLength(0)
  })

  it('concurrent requests have a database-unique record identity', async () => {
    const { controller, intent, store } = intentFixture()
    const result = await Promise.all([controller.create(intent), controller.create(intent)])
    expect(store.size).toBe(1)
    expect(result[0].publishRecordId).toBe(result[1].publishRecordId)
  })
})
