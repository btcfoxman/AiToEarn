import { PublishStatus } from '@yikart/mongodb'
import { AccountType } from '@yikart/common'

export const OUTCOME_METRICS = ['views', 'likes', 'comments', 'shares', 'saves'] as const
export interface OutcomeMetric {
  name: string
  availability: 'available' | 'unavailable' | 'not_due' | 'error'
  value: number | null
  source: string
  reason: string
}

export function missingMetrics(reason: string, availability: OutcomeMetric['availability'] = 'unavailable'): OutcomeMetric[] {
  return OUTCOME_METRICS.map(name => ({ name, availability, value: null, source: '', reason }))
}

export function observedMetrics(values: Record<string, unknown>, source: string): OutcomeMetric[] {
  return OUTCOME_METRICS.map((name) => {
    const raw = values[name]
    const value = typeof raw === 'number' ? raw : typeof raw === 'string' && /^\d+$/.test(raw) ? Number(raw) : null
    return value !== null && Number.isFinite(value) && value >= 0
      ? { name, availability: 'available', value, source, reason: '' }
      : { name, availability: 'unavailable', value: null, source, reason: 'not_reported' }
  })
}

function publicUrl(value: unknown): string | null {
  if (typeof value !== 'string' || value.length > 4096 || /[\u0000-\u001f]/.test(value))
    return null
  try {
    const parsed = new URL(value)
    return ['http:', 'https:'].includes(parsed.protocol) && !parsed.username && !parsed.password ? value : null
  }
  catch { return null }
}

export interface PublicationRecordLike {
  id?: unknown
  _id?: unknown
  platformWorkId?: string
  dataId?: string
  workLink?: string
  publishTime?: string | Date
  accountId?: string
  accountType?: string
  status?: number
}

export function publicationProjection(record: PublicationRecordLike) {
  const workId = String(record.platformWorkId || record.dataId || '') || null
  const workUrl = publicUrl(record.workLink)
  const publishedAt = record.publishTime && Number.isFinite(new Date(record.publishTime).getTime())
    ? new Date(record.publishTime).toISOString() : null
  let status = record.status === PublishStatus.PUBLISHED
    ? ((workId || workUrl) && record.accountId && publishedAt ? 'published' : 'unknown')
    : record.status === PublishStatus.FAILED ? 'failed'
      : record.status === PublishStatus.WaitingForPublish ? 'scheduled'
        : record.status === PublishStatus.PUBLISHING ? 'publishing' : 'unknown'
  const needsPublicState = record.accountType === AccountType.BILIBILI || record.accountType === AccountType.YOUTUBE
  // These providers mark upload acceptance as PUBLISHED before moderation or
  // public visibility is known. A record/guessed URL alone cannot prove that.
  if (status === 'published' && needsPublicState)
    status = 'unknown'
  return {
    publishRecordId: String(record.id || record._id), accountId: record.accountId || null,
    platform: record.accountType, status, workId, workUrl,
    publishedAt: status === 'published' ? publishedAt : null,
    publicationEvidence: status === 'published' ? 'publisher_receipt' : 'not_confirmed',
    statusReason: needsPublicState && record.status === PublishStatus.PUBLISHED ? 'platform_public_state_not_confirmed' : null as string | null,
    metrics: missingMetrics('channel_metric_adapter_unavailable'),
  }
}
