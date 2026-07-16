import { BadRequestException, ConflictException } from '@nestjs/common'
import { AccountType } from '@yikart/common'
import { describe, expect, it, vi } from 'vitest'
import { OrchestrationDraftInternalController } from './orchestration-draft.controller'
import {
  normalizeAccountTypes,
  normalizePublicDraft,
  resolveSourceKey,
  sha256,
} from './orchestration-draft-import'

vi.mock('@yikart/mongodb', () => ({
  MaterialSource: { UPLOAD: 'upload' },
  MaterialStatus: { SUCCESS: 1 },
  MaterialType: { ARTICLE: 'article', VIDEO: 'video' },
  MediaType: { IMG: 'img', VIDEO: 'video' },
}))

vi.mock('@yikart/aitoearn-auth', () => ({
  Internal: () => () => undefined,
}))

vi.mock('../content/material-group.service', () => ({
  MaterialGroupService: class MaterialGroupService {},
}))

vi.mock('../content/material.service', () => ({
  MaterialService: class MaterialService {},
}))

function importBody(overrides: Record<string, any> = {}) {
  return {
    userId: 'user-1',
    sourceKey: 'content-package:42',
    accountTypes: ['wechat_mp', 'wechat_channels', 'kuaishou', 'xhs'],
    draft: {
      package_id: 'package-42',
      status: 'ready_to_publish',
      master_title: '公开终稿',
      master_content: '这是可以发布的正文。',
      platform_variants: [
        { platform: '公众号', title: '公众号标题', body: '公众号正文' },
      ],
    },
    ...overrides,
  }
}

function buildController() {
  const materialGroupService = {
    ensureDefaultGroup: vi.fn().mockResolvedValue(undefined),
    getDefaultGroup: vi.fn().mockResolvedValue({ id: 'group-1', userId: 'user-1' }),
    getGroupInfo: vi.fn().mockResolvedValue({ id: 'group-1', userId: 'user-1' }),
  }
  const imports = new Map<string, { requestSha256: string, contentSha256: string, material: any }>()
  let sequence = 0
  const materialService = {
    upsertOrchestrationImport: vi.fn(async (material: any, identity: any) => {
      const mapKey = `${material.userId}:${identity.sourceKey}`
      const existing = imports.get(mapKey)
      if (existing) {
        const conflict = existing.requestSha256 !== identity.requestSha256
          || existing.contentSha256 !== identity.contentSha256
        return { material: existing.material, created: false, conflict }
      }
      sequence += 1
      const created = { ...material, id: `material-${sequence}` }
      imports.set(mapKey, { ...identity, material: created })
      return { material: created, created: true, conflict: false }
    }),
  }
  const controller = new OrchestrationDraftInternalController(
    materialGroupService as any,
    materialService as any,
  )
  return { controller, materialGroupService, materialService, imports }
}

describe('orchestration draft public import normalization', () => {
  it('maps legacy and localized platform aliases to AccountType values', () => {
    expect(normalizeAccountTypes(['wechat_mp', 'wechat_channels', 'kuaishou', '小红书', 'toutiao_micro'])).toEqual([
      AccountType.WxGzh,
      AccountType.WxSph,
      AccountType.KWAI,
      AccountType.Xhs,
      AccountType.Toutiao,
    ])
  })

  it('keeps hashes stable across object key order', () => {
    expect(sha256({ b: 2, a: { d: 4, c: 3 } })).toBe(sha256({ a: { c: 3, d: 4 }, b: 2 }))
    expect(sha256({ body: 'one' })).not.toBe(sha256({ body: 'two' }))
  })

  it('uses the legacy source id when no explicit key is supplied', () => {
    expect(resolveSourceKey(importBody({ sourceKey: undefined }) as any, undefined, 'package-42')).toBe('package-42')
  })

  it('rejects ambiguous header/body idempotency identities', () => {
    expect(() => resolveSourceKey(importBody() as any, 'different-key', 'package-42'))
      .toThrow(BadRequestException)
  })

  it('rejects governance evidence and unsafe executable HTML', () => {
    expect(() => normalizePublicDraft({
      package_id: 'package-42',
      title: 'title',
      body: 'body',
      evidence_manifest_id: 'manifest-secret',
    })).toThrow(/internal governance field/)
    expect(() => normalizePublicDraft({
      package_id: 'package-42',
      title: 'title',
      html: '<p onclick="steal()">body</p>',
    })).toThrow(/unsafe HTML/)
  })

})

describe('orchestration draft import controller integration', () => {
  it('returns the same material after a lost response is retried', async () => {
    const { controller, imports } = buildController()

    const first = await controller.importDraft(importBody(), 'content-package:42')
    const retry = await controller.importDraft(importBody(), 'content-package:42')

    expect(first.materialId).toBe('material-1')
    expect(first.idempotent).toBe(false)
    expect(retry.materialId).toBe('material-1')
    expect(retry.idempotent).toBe(true)
    expect(retry.contentSha256).toBe(first.contentSha256)
    expect(imports.size).toBe(1)
  })

  it('coalesces concurrent retries into one material identity', async () => {
    const { controller, imports } = buildController()

    const [first, second] = await Promise.all([
      controller.importDraft(importBody(), 'content-package:42'),
      controller.importDraft(importBody(), 'content-package:42'),
    ])

    expect(first.materialId).toBe(second.materialId)
    expect([first.idempotent, second.idempotent].sort()).toEqual([false, true])
    expect(imports.size).toBe(1)
  })

  it('keeps the legacy draft_id-only request contract idempotent', async () => {
    const { controller, imports } = buildController()
    const legacy = {
      userId: 'user-1',
      accountTypes: ['wechat_mp'],
      draft: {
        draft_id: 'legacy-draft-1',
        status: 'approved',
        title: '旧接口终稿',
        body: '旧调用方无需增加新字段。',
        platform: 'wechat_mp',
      },
    }

    const first = await controller.importDraft(legacy, undefined)
    const retry = await controller.importDraft(legacy, undefined)

    expect(first.sourceKey).toBe('legacy-draft-1')
    expect(retry.materialId).toBe(first.materialId)
    expect(retry.idempotent).toBe(true)
    expect(imports.size).toBe(1)
  })

  it('returns 409 when a source key is reused for changed content', async () => {
    const { controller } = buildController()
    await controller.importDraft(importBody(), 'content-package:42')

    await expect(controller.importDraft(importBody({
      draft: {
        ...importBody().draft,
        master_content: '被篡改的不同内容',
      },
    }), 'content-package:42')).rejects.toBeInstanceOf(ConflictException)
  })

  it('only persists whitelisted public fields and canonical platforms', async () => {
    const { controller, materialService } = buildController()
    const body = importBody({
      draft: {
        ...importBody().draft,
        arbitrary_internal_payload: { token: 'must-not-persist' },
      },
    })

    const response = await controller.importDraft(body, 'content-package:42')
    const [material] = materialService.upsertOrchestrationImport.mock.calls[0]

    expect(response.material.accountTypes).toEqual([
      AccountType.WxGzh,
      AccountType.WxSph,
      AccountType.KWAI,
      AccountType.Xhs,
    ])
    expect(JSON.stringify(material.option)).not.toContain('arbitrary_internal_payload')
    expect(JSON.stringify(material.option)).not.toContain('must-not-persist')
    expect(material.option.article.platformVariants[0]).toMatchObject({
      platform: AccountType.WxGzh,
      title: '公众号标题',
      body: '公众号正文',
    })
  })
})
