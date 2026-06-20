import { BadRequestException, Body, Controller, Post } from '@nestjs/common'
import { ApiTags } from '@nestjs/swagger'
import { Internal } from '@yikart/aitoearn-auth'
import { ApiDoc, UserType } from '@yikart/common'
import { MaterialSource, MaterialStatus, MaterialType, MediaType } from '@yikart/mongodb'
import { MaterialGroupService } from '../content/material-group.service'
import { MaterialService } from '../content/material.service'

interface OrchestrationDraftImportBody {
  userId: string
  groupId?: string
  accountTypes?: string[]
  draft: Record<string, any>
}

function firstText(...values: any[]): string {
  for (const value of values) {
    const text = String(value || '').trim()
    if (text)
      return text
  }
  return ''
}

function normalizeMedia(draft: Record<string, any>) {
  const media = Array.isArray(draft['media']) ? draft['media'] : []
  const fromMedia = media
    .map((item: any) => {
      const url = firstText(item?.url, item?.src, item?.image_url)
      if (!url)
        return null
      return {
        url,
        type: String(item?.type || 'image').toLowerCase() === 'video' ? MediaType.VIDEO : MediaType.IMG,
        thumbUrl: firstText(item?.thumbUrl, item?.thumb_url, item?.thumbnail),
        content: firstText(item?.content, item?.caption),
      }
    })
    .filter(Boolean)

  const blocks = Array.isArray(draft['blocks']) ? draft['blocks'] : []
  const fromBlocks = blocks
    .filter((item: any) => String(item?.type || '').toLowerCase() === 'image' && firstText(item?.url, item?.src))
    .map((item: any) => ({
      url: firstText(item?.url, item?.src),
      type: MediaType.IMG,
      thumbUrl: firstText(item?.thumbUrl, item?.thumb_url),
      content: firstText(item?.caption, item?.alt),
    }))

  const seen = new Set<string>()
  return [...fromMedia, ...fromBlocks].filter((item: any) => {
    if (!item?.url || seen.has(item.url))
      return false
    seen.add(item.url)
    return true
  })
}

function normalizeAccountTypes(value: any): string[] {
  if (!Array.isArray(value))
    return []
  return value.map((item: any) => firstText(item)).filter(Boolean)
}

function compactOrchestrationDraft(draft: Record<string, any>) {
  return {
    draft_id: firstText(draft['draft_id'], draft['draftId']),
    brief_id: firstText(draft['brief_id'], draft['briefId']),
    topic_id: firstText(draft['topic_id'], draft['topicId']),
    persona_id: firstText(draft['persona_id'], draft['personaId']),
    platform: firstText(draft['platform']),
    format: firstText(draft['format']),
    status: firstText(draft['status']),
    version: Number(draft['version'] || 1),
    model: firstText(draft['model']),
    prompt_version: firstText(draft['prompt_version'], draft['promptVersion']),
    approved_by: firstText(draft['approved_by'], draft['approvedBy']),
    approved_at: firstText(draft['approved_at'], draft['approvedAt']),
  }
}

@ApiTags('Internal/OrchestrationDraft')
@Controller('internal/orchestration')
@Internal()
export class OrchestrationDraftInternalController {
  constructor(
    private readonly materialGroupService: MaterialGroupService,
    private readonly materialService: MaterialService,
  ) {}

  @ApiDoc({
    summary: 'Import approved ai-orchestration draft into AiToEarn material box',
  })
  @Post('drafts/import')
  async importDraft(@Body() body: OrchestrationDraftImportBody) {
    const userId = firstText(body.userId)
    if (!userId)
      throw new BadRequestException('userId is required')

    const draft = body.draft || {}
    const draftId = firstText(draft['draft_id'], draft['draftId'])
    if (!draftId)
      throw new BadRequestException('draft.draft_id is required')

    let groupId = firstText(body.groupId)
    if (groupId) {
      const group = await this.materialGroupService.getGroupInfo(groupId)
      if (!group || String((group as any).userId || '') !== userId)
        throw new BadRequestException('material group not found for user')
    }
    else {
      await this.materialGroupService.ensureDefaultGroup(userId)
      const defaultGroup = await this.materialGroupService.getDefaultGroup(userId)
      groupId = firstText((defaultGroup as any)?.id, (defaultGroup as any)?._id)
    }
    if (!groupId)
      throw new BadRequestException('material group not found')

    const html = firstText(draft['html'], draft['articleHtml'])
    const bodyText = firstText(draft['body'], draft['clean_text'], draft['description'])
    const format = firstText(draft['format'], 'article')
    const platform = firstText(draft['platform'], 'wechat_mp')
    const components = Array.isArray(draft['components']) ? draft['components'] : []
    const blocks = Array.isArray(draft['blocks']) ? draft['blocks'] : []
    const topics = Array.isArray(draft['hashtags'])
      ? draft['hashtags']
      : (Array.isArray(draft['topics']) ? draft['topics'] : [])
    const accountTypes = normalizeAccountTypes(body.accountTypes)

    const material = await this.materialService.create({
      userId,
      userType: UserType.User,
      taskId: draftId,
      groupId,
      coverUrl: firstText(draft['cover_url'], draft['coverUrl']),
      mediaList: normalizeMedia(draft),
      title: firstText(draft['title'], 'AI 内容草稿'),
      desc: firstText(draft['description'], bodyText).slice(0, 500),
      type: MaterialType.ARTICLE,
      topics: topics.map((item: any) => String(item || '').replace(/^#/, '').trim()).filter(Boolean),
      status: MaterialStatus.SUCCESS,
      source: MaterialSource.UPLOAD,
      option: {
        articleHtml: html,
        article: {
          html,
          body: bodyText,
          blocks,
          components,
          format,
          platform,
        },
        orchestration: {
          provider: 'ai-orchestration',
          draftId,
          topicId: firstText(draft['topic_id'], draft['topicId']),
          briefId: firstText(draft['brief_id'], draft['briefId']),
          status: firstText(draft['status']),
          version: Number(draft['version'] || 1),
          articleHtml: html,
          raw: compactOrchestrationDraft(draft),
        },
      },
      generationParams: {
        draftType: 'article',
        platforms: accountTypes,
        source: 'ai-orchestration',
        platform,
        format,
      },
      accountTypes: accountTypes as any,
    } as any)

    return {
      materialId: (material as any).id || (material as any)._id,
      userId,
      groupId,
      material,
    }
  }
}
