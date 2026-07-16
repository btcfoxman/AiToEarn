import { Body, Controller, NotFoundException, Post } from '@nestjs/common'
import { Public } from '@yikart/aitoearn-auth'
import {
  PublishRecordLinkStatus,
  PublishStatus,
} from '@yikart/mongodb'
import { PublishRecordService } from '../../publish-record/publish-record.service'

interface OrchestrationPublishCallbackPayload {
  publishTaskId: string
  requestId?: string
  externalRecordId?: string
  platform?: string
  contentType?: string
  status: 'COMPLETED' | 'FAILED' | 'CANCELLED' | 'WAITING_HUMAN' | 'PUBLISHING'
  internalTaskId?: string
  dataId?: string
  platformWorkId?: string
  workId?: string
  workLink?: string
  result?: Record<string, any>
  error?: string
}

function firstString(...values: unknown[]) {
  for (const value of values) {
    if (typeof value === 'string' && value.trim()) {
      return value.trim()
    }
  }
  return ''
}

function findNestedString(value: unknown, keys: string[]): string {
  if (!value || typeof value !== 'object') {
    return ''
  }
  if (Array.isArray(value)) {
    for (const item of value) {
      const found = findNestedString(item, keys)
      if (found)
        return found
    }
    return ''
  }
  const record = value as Record<string, unknown>
  for (const key of keys) {
    const found = firstString(record[key])
    if (found)
      return found
  }
  for (const item of Object.values(record)) {
    const found = findNestedString(item, keys)
    if (found)
      return found
  }
  return ''
}

function extractPlatformDataId(body: OrchestrationPublishCallbackPayload, fallback: string) {
  return firstString(
    body.platformWorkId,
    body.workId,
    body.dataId,
    findNestedString(body.result, ['platformWorkId', 'platform_work_id', 'workId', 'work_id', 'dataId', 'data_id', 'postId', 'post_id', 'id']),
    fallback,
  )
}

@Controller('internal/orchestration')
@Public()
export class OrchestrationPublishCallbackController {
  constructor(
    private readonly publishRecordService: PublishRecordService,
  ) {}

  @Post('publish-callback')
  async handlePublishCallback(@Body() body: OrchestrationPublishCallbackPayload) {
    const recordId = body.externalRecordId
    if (!recordId) {
      throw new NotFoundException('externalRecordId is required')
    }
    const record = await this.publishRecordService.getOneById(recordId)
    if (!record) {
      throw new NotFoundException('publish record not found')
    }

    const dataOption = {
      ...(record.dataOption || {}),
      orchestration: {
        ...(record.dataOption?.['orchestration'] || {}),
        ...body,
        requiresHuman: body.status === 'WAITING_HUMAN',
        lastCallbackAt: new Date().toISOString(),
      },
    }
    const linkMeta = {
      ...(record.linkMeta || {}),
      orchestration: body,
    }
    const dataId = extractPlatformDataId(body, body.publishTaskId || body.internalTaskId || record.dataId || '')

    if (body.status === 'COMPLETED') {
      await this.publishRecordService.completeById(record, dataId, {
        workLink: body.workLink || '',
        dataOption,
      })
      await this.publishRecordService.updateById(record.id, {
        $set: {
          dataOption,
          linkMeta,
          linkStatus: body.workLink ? PublishRecordLinkStatus.READY : PublishRecordLinkStatus.PENDING,
          ...(body.workLink && { workLink: body.workLink }),
        },
      })
      return { ok: true }
    }

    if (body.status === 'FAILED' || body.status === 'CANCELLED') {
      await this.publishRecordService.failById(record.id, body.error || body.status)
      await this.publishRecordService.updateById(record.id, {
        $set: {
          dataId,
          dataOption,
          linkMeta,
          linkStatus: PublishRecordLinkStatus.FAILED,
          inQueue: false,
          queued: false,
        },
      })
      return { ok: true }
    }

    if (body.status === 'WAITING_HUMAN') {
      await this.publishRecordService.updateById(record.id, {
        $set: {
          dataId,
          dataOption,
          linkMeta,
          status: PublishStatus.PUBLISHING,
          errorMsg: body.error || 'WAITING_HUMAN',
          inQueue: false,
          queued: false,
        },
      })
      return { ok: true }
    }

    await this.publishRecordService.updateById(record.id, {
      $set: {
        dataId,
        dataOption,
        linkMeta,
      },
    })
    return { ok: true }
  }
}
