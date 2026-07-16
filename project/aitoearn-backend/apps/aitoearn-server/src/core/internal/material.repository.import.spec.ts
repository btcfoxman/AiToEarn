import { describe, expect, it, vi } from 'vitest'
import { MaterialRepository } from '../../../../../libs/mongodb/src/repositories/material.repository'

vi.mock('../../../../../libs/mongodb/src/schemas', () => ({
  Material: class Material {},
  MaterialSource: { UPLOAD: 'upload' },
  MaterialStatus: { WAIT: 0, SUCCESS: 1, FAIL: -1 },
  MaterialType: { VIDEO: 'video', ARTICLE: 'article' },
}))

function duplicateKeyError() {
  return Object.assign(new Error('E11000 duplicate key'), { code: 11000 })
}

describe('MaterialRepository orchestration import upsert', () => {
  const identity = {
    sourceKey: 'content-package:42',
    requestSha256: 'request-hash',
    contentSha256: 'content-hash',
  }
  const material = {
    id: 'material-1',
    userId: 'user-1',
    orchestrationSourceKey: identity.sourceKey,
    orchestrationRequestSha256: identity.requestSha256,
    orchestrationContentSha256: identity.contentSha256,
  }

  it('uses an atomic set-on-insert operation and identifies replays', async () => {
    const findOneAndUpdate = vi.fn()
      .mockResolvedValueOnce({ value: material, lastErrorObject: { updatedExisting: false } })
      .mockResolvedValueOnce({ value: material, lastErrorObject: { updatedExisting: true } })
    const model = { findOneAndUpdate }
    const repository = new MaterialRepository(model as any)

    const first = await repository.upsertOrchestrationImport({ userId: 'user-1' }, identity)
    const retry = await repository.upsertOrchestrationImport({ userId: 'user-1' }, identity)

    expect(first).toMatchObject({ created: true, conflict: false })
    expect(retry).toMatchObject({ created: false, conflict: false })
    expect(retry.material).toBe(first.material)
    expect(findOneAndUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ userId: 'user-1', orchestrationSourceKey: identity.sourceKey }),
      expect.objectContaining({ $setOnInsert: expect.objectContaining({ orchestrationContentSha256: identity.contentSha256 }) }),
      expect.objectContaining({ upsert: true, includeResultMetadata: true }),
    )
  })

  it('recovers a same-hash concurrent duplicate as an idempotent replay', async () => {
    const lean = vi.fn().mockResolvedValue(material)
    const model = {
      findOneAndUpdate: vi.fn().mockRejectedValue(duplicateKeyError()),
      findOne: vi.fn().mockReturnValue({ lean }),
    }
    const repository = new MaterialRepository(model as any)

    await expect(repository.upsertOrchestrationImport({ userId: 'user-1' }, identity)).resolves.toMatchObject({
      created: false,
      conflict: false,
      material,
    })
  })

  it('marks a changed request on the same identity as a conflict', async () => {
    const different = { ...material, orchestrationContentSha256: 'old-content-hash' }
    const model = {
      findOneAndUpdate: vi.fn().mockRejectedValue(duplicateKeyError()),
      findOne: vi.fn().mockReturnValue({ lean: vi.fn().mockResolvedValue(different) }),
    }
    const repository = new MaterialRepository(model as any)

    await expect(repository.upsertOrchestrationImport({ userId: 'user-1' }, identity)).resolves.toMatchObject({
      created: false,
      conflict: true,
      material: different,
    })
  })
})
