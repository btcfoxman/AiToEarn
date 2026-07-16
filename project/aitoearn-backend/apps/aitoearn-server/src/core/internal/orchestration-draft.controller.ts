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

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

function htmlToText(value: string): string {
  return firstText(value)
    .replace(/<\s*br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|section|article|blockquote|h[1-6]|li)>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/g, '\'')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

function textToHtml(value: string): string {
  return firstText(value)
    .split(/\n{2,}/)
    .map(part => firstText(part))
    .filter(Boolean)
    .map(part => `<p>${escapeHtml(part).replace(/\n/g, '<br />')}</p>`)
    .join('')
}

function mediaTypeFromValue(value: any): MediaType {
  const type = String(value?.type || value?.mediaType || value?.media_type || '').toLowerCase()
  return type === 'video' ? MediaType.VIDEO : MediaType.IMG
}

function mediaUrlFromValue(value: any): string {
  return firstText(
    value?.url,
    value?.src,
    value?.mediaUrl,
    value?.media_url,
    value?.videoUrl,
    value?.video_url,
    value?.playUrl,
    value?.play_url,
    value?.imageUrl,
    value?.image_url,
  )
}

function blockToHtml(block: any): string {
  const type = String(block?.type || '').toLowerCase()
  const rawHtml = firstText(block?.html, block?.content_html)
  if (rawHtml)
    return rawHtml

  if (type === 'image') {
    const url = mediaUrlFromValue(block)
    if (!url)
      return ''
    const alt = escapeHtml(firstText(block?.alt, block?.caption, block?.title))
    return `<p><img src="${escapeHtml(url)}"${alt ? ` alt="${alt}"` : ''} /></p>`
  }

  if (type === 'video') {
    const url = mediaUrlFromValue(block)
    if (!url)
      return ''
    return `<p><video controls src="${escapeHtml(url)}"></video></p>`
  }

  const text = firstText(block?.text, block?.content, block?.body)
  if (!text)
    return ''
  if (['heading', 'h1', 'h2', 'h3'].includes(type))
    return `<h2>${escapeHtml(text)}</h2>`
  return textToHtml(text)
}

function buildArticleHtml(draft: Record<string, any>, bodyText: string): string {
  const html = firstText(draft['html'], draft['articleHtml'], draft['article_html'], draft['contentHtml'], draft['content_html'])
  if (html)
    return html

  const blocks = Array.isArray(draft['blocks']) ? draft['blocks'] : []
  const blockHtml = blocks.map(blockToHtml).filter(Boolean).join('')
  if (blockHtml)
    return blockHtml

  return textToHtml(bodyText)
}

function extractMediaFromHtml(html: string) {
  const result: Array<{ url: string, type: MediaType, thumbUrl?: string, content?: string }> = []
  const imagePattern = /<img\b[^>]*\bsrc=["']([^"']+)["'][^>]*>/gi
  const videoPattern = /<(?:video|source)\b[^>]*\bsrc=["']([^"']+)["'][^>]*>/gi
  let match: RegExpExecArray | null
  while ((match = imagePattern.exec(html)) !== null) {
    result.push({ url: match[1], type: MediaType.IMG })
  }
  while ((match = videoPattern.exec(html)) !== null) {
    result.push({ url: match[1], type: MediaType.VIDEO })
  }
  return result
}

function normalizeMedia(draft: Record<string, any>) {
  const media = Array.isArray(draft['media']) ? draft['media'] : []
  const fromMedia = media
    .map((item: any) => {
      const url = mediaUrlFromValue(item)
      if (!url)
        return null
      return {
        url,
        type: mediaTypeFromValue(item),
        thumbUrl: firstText(item?.thumbUrl, item?.thumb_url, item?.thumbnail, item?.coverUrl, item?.cover_url),
        content: firstText(item?.content, item?.caption),
      }
    })
    .filter(Boolean)

  const blocks = Array.isArray(draft['blocks']) ? draft['blocks'] : []
  const fromBlocks = blocks
    .filter((item: any) => ['image', 'video'].includes(String(item?.type || '').toLowerCase()) && mediaUrlFromValue(item))
    .map((item: any) => ({
      url: mediaUrlFromValue(item),
      type: mediaTypeFromValue(item),
      thumbUrl: firstText(item?.thumbUrl, item?.thumb_url),
      content: firstText(item?.caption, item?.alt),
    }))
  const fromHtml = extractMediaFromHtml(firstText(draft['html'], draft['articleHtml'], draft['article_html'], draft['contentHtml'], draft['content_html']))

  const seen = new Set<string>()
  return [...fromMedia, ...fromBlocks, ...fromHtml].filter((item: any) => {
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

    const existingHtml = firstText(draft['html'], draft['articleHtml'], draft['article_html'], draft['contentHtml'], draft['content_html'])
    const bodyText = firstText(draft['body'], draft['clean_text'], htmlToText(existingHtml), draft['description'])
    const html = buildArticleHtml(draft, bodyText)
    const description = firstText(draft['description'], draft['summary'])
    const format = firstText(draft['format'], 'article')
    const platform = firstText(draft['platform'], 'wechat_mp')
    const components = Array.isArray(draft['components']) ? draft['components'] : []
    const blocks = Array.isArray(draft['blocks']) ? draft['blocks'] : []
    const mediaList = normalizeMedia({ ...draft, html })
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
      mediaList,
      title: firstText(draft['title'], 'AI 内容草稿'),
      desc: firstText(bodyText, description),
      type: MaterialType.ARTICLE,
      topics: topics.map((item: any) => String(item || '').replace(/^#/, '').trim()).filter(Boolean),
      status: MaterialStatus.SUCCESS,
      source: MaterialSource.UPLOAD,
      option: {
        articleHtml: html,
        article: {
          html,
          body: bodyText,
          description,
          summary: description,
          blocks,
          components,
          media: mediaList,
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
          articleBody: bodyText,
          description,
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
