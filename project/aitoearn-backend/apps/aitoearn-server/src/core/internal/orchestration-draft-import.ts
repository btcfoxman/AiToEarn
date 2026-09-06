import { createHash } from 'node:crypto'
import { BadRequestException } from '@nestjs/common'
import { AccountType } from '@yikart/common'
import { MediaType } from '@yikart/mongodb'

export interface OrchestrationDraftImportBody {
  userId: string
  groupId?: string
  accountTypes?: string[]
  sourceKey?: string
  idempotencyKey?: string
  idempotency_key?: string
  draft: OrchestrationDraftLike
}

export interface OrchestrationDraftLike {
  [key: string]: any
  draft_id?: any
  draftId?: any
  package_id?: any
  packageId?: any
  title?: any
  master_title?: any
  masterTitle?: any
  body?: any
  master_content?: any
  masterContent?: any
  clean_text?: any
  description?: any
  summary?: any
  html?: any
  articleHtml?: any
  article_html?: any
  contentHtml?: any
  content_html?: any
  blocks?: any
  components?: any
  cover_url?: any
  coverUrl?: any
  media?: any
  platform_variants?: any
  platformVariants?: any
  platform?: any
  format?: any
  hashtags?: any
  topics?: any
  status?: any
  version?: any
  model?: any
  prompt_version?: any
  promptVersion?: any
}

interface PublicObjectFields {
  [key: string]: string | undefined
  type?: string
  title?: string
  text?: string
  content?: string
  body?: string
  html?: string
  content_html?: string
  url?: string
  src?: string
  alt?: string
  caption?: string
}

export interface PublicPlatformVariant {
  platform: AccountType
  title: string
  body: string
  hashtags: string[]
  media: PublicMedia[]
}

export interface PublicMedia {
  url: string
  type: MediaType
  thumbUrl?: string
  content?: string
}

export interface PublicDraftSnapshot {
  sourceId: string
  title: string
  body: string
  html: string
  description: string
  coverUrl: string
  format: string
  platform: string
  topics: string[]
  media: PublicMedia[]
  blocks: PublicObjectFields[]
  components: PublicObjectFields[]
  platformVariants: PublicPlatformVariant[]
  provenance: Record<string, string | number>
}

const FORBIDDEN_GOVERNANCE_FIELDS = new Set([
  'approved_records',
  'audit',
  'constitution',
  'constitution_version_id',
  'decision_thread_id',
  'evidence',
  'evidence_manifest',
  'evidence_manifest_id',
  'governance',
  'internal_context',
  'knowledge_records',
  'offer_id',
  'personal_card_ids',
  'review_policy',
  'review_result',
  'runtime_output',
  'source_records',
])

const PUBLIC_OBJECT_FIELDS = [
  'type',
  'title',
  'text',
  'content',
  'body',
  'html',
  'content_html',
  'url',
  'src',
  'mediaUrl',
  'media_url',
  'videoUrl',
  'video_url',
  'playUrl',
  'play_url',
  'imageUrl',
  'image_url',
  'thumbUrl',
  'thumb_url',
  'thumbnail',
  'coverUrl',
  'cover_url',
  'alt',
  'caption',
] as const

const UNSAFE_HTML_PATTERN = /<(?:script|style|iframe|object|embed|form|input|button|meta|link|base)\b|\son[a-z]+\s*=|(?:javascript|vbscript)\s*:/i
const UNSAFE_URL_PATTERN = /^(?:javascript|vbscript|data\s*:\s*text\/html)/i

const ACCOUNT_TYPE_ALIASES: Record<string, AccountType> = {
  'douyin': AccountType.Douyin,
  '抖音': AccountType.Douyin,
  'xhs': AccountType.Xhs,
  'xiaohongshu': AccountType.Xhs,
  'rednote': AccountType.Xhs,
  '小红书': AccountType.Xhs,
  'wxsph': AccountType.WxSph,
  'wx_sph': AccountType.WxSph,
  'wechat_channels': AccountType.WxSph,
  'wechat_channel': AccountType.WxSph,
  'wechat_video': AccountType.WxSph,
  'video_account': AccountType.WxSph,
  '视频号': AccountType.WxSph,
  'kwai': AccountType.KWAI,
  'kuaishou': AccountType.KWAI,
  '快手': AccountType.KWAI,
  'youtube': AccountType.YOUTUBE,
  'wxgzh': AccountType.WxGzh,
  'wx_gzh': AccountType.WxGzh,
  'wechat_mp': AccountType.WxGzh,
  'wechat_official': AccountType.WxGzh,
  'wechat_official_account': AccountType.WxGzh,
  '公众号': AccountType.WxGzh,
  'wechat_moments': AccountType.WechatMoments,
  'moments': AccountType.WechatMoments,
  '朋友圈': AccountType.WechatMoments,
  'toutiao': AccountType.Toutiao,
  'toutiao_article': AccountType.Toutiao,
  'toutiao_micro': AccountType.Toutiao,
  'weitoutiao': AccountType.Toutiao,
  'jinri_toutiao': AccountType.Toutiao,
  '今日头条': AccountType.Toutiao,
  '头条': AccountType.Toutiao,
  'bilibili': AccountType.BILIBILI,
  'b站': AccountType.BILIBILI,
  'twitter': AccountType.TWITTER,
  'x': AccountType.TWITTER,
  'tiktok': AccountType.TIKTOK,
  'facebook': AccountType.FACEBOOK,
  'instagram': AccountType.INSTAGRAM,
  'threads': AccountType.THREADS,
  'pinterest': AccountType.PINTEREST,
  'linkedin': AccountType.LINKEDIN,
  'google_business': AccountType.GOOGLE_BUSINESS,
  'google_business_profile': AccountType.GOOGLE_BUSINESS,
}

export function firstText(...values: any[]): string {
  for (const value of values) {
    const text = typeof value === 'string' || typeof value === 'number'
      ? String(value).trim()
      : ''
    if (text)
      return text
  }
  return ''
}

function assertStringLimit(value: string, field: string, maxLength: number): string {
  if (value.length > maxLength)
    throw new BadRequestException(`${field} exceeds ${maxLength} characters`)
  return value
}

function assertSafeHtml(value: string, field: string): string {
  assertStringLimit(value, field, 1_000_000)
  if (UNSAFE_HTML_PATTERN.test(value))
    throw new BadRequestException(`${field} contains unsafe HTML`)
  return value
}

function assertSafeUrl(value: string, field: string): string {
  assertStringLimit(value, field, 4_096)
  if (UNSAFE_URL_PATTERN.test(value) || /[\u0000-\u001f\u007f]/.test(value))
    throw new BadRequestException(`${field} contains an unsafe URL`)
  return value
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

export function htmlToText(value: string): string {
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

function normalizedAlias(value: string): string {
  return value.trim().toLowerCase().replace(/[\s-]+/g, '_')
}

export function normalizeAccountType(value: any): AccountType | null {
  const text = firstText(value)
  if (!text)
    return null
  return ACCOUNT_TYPE_ALIASES[normalizedAlias(text)] || null
}

export function normalizeAccountTypes(value: any): AccountType[] {
  if (value === undefined || value === null)
    return []
  if (!Array.isArray(value))
    throw new BadRequestException('accountTypes must be an array')
  if (value.length > 32)
    throw new BadRequestException('accountTypes exceeds 32 entries')

  const result: AccountType[] = []
  for (const item of value) {
    const accountType = normalizeAccountType(item)
    if (!accountType)
      throw new BadRequestException(`unsupported account type: ${firstText(item) || '<empty>'}`)
    if (!result.includes(accountType))
      result.push(accountType)
  }
  return result
}

function mediaTypeFromValue(value: any): MediaType {
  const type = firstText(value?.type, value?.mediaType, value?.media_type).toLowerCase()
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

function sanitizePublicObject(value: any, field: string): PublicObjectFields | null {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new BadRequestException(`${field} must contain objects`)

  const result: Record<string, string> = {}
  for (const key of PUBLIC_OBJECT_FIELDS) {
    const text = firstText(value[key])
    if (!text)
      continue
    if (key === 'html' || key === 'content_html')
      result[key] = assertSafeHtml(text, `${field}.${key}`)
    else if (/url|src/i.test(key))
      result[key] = assertSafeUrl(text, `${field}.${key}`)
    else
      result[key] = assertStringLimit(text, `${field}.${key}`, 100_000)
  }
  return Object.keys(result).length ? result : null
}

function sanitizePublicObjects(value: any, field: string): PublicObjectFields[] {
  if (value === undefined || value === null)
    return []
  if (!Array.isArray(value))
    throw new BadRequestException(`${field} must be an array`)
  if (value.length > 256)
    throw new BadRequestException(`${field} exceeds 256 entries`)
  return value
    .map((item, index) => sanitizePublicObject(item, `${field}[${index}]`))
    .filter((item): item is PublicObjectFields => Boolean(item))
}

function normalizeMediaList(value: any, field: string): PublicMedia[] {
  if (value === undefined || value === null)
    return []
  if (!Array.isArray(value))
    throw new BadRequestException(`${field} must be an array`)
  if (value.length > 256)
    throw new BadRequestException(`${field} exceeds 256 entries`)

  const seen = new Set<string>()
  const result: PublicMedia[] = []
  for (const [index, item] of value.entries()) {
    if (!item || typeof item !== 'object' || Array.isArray(item))
      throw new BadRequestException(`${field}[${index}] must be an object`)
    const url = mediaUrlFromValue(item)
    if (!url)
      continue
    assertSafeUrl(url, `${field}[${index}].url`)
    if (seen.has(url))
      continue
    seen.add(url)
    const thumbUrl = firstText(item?.thumbUrl, item?.thumb_url, item?.thumbnail, item?.coverUrl, item?.cover_url)
    if (thumbUrl)
      assertSafeUrl(thumbUrl, `${field}[${index}].thumbUrl`)
    const content = assertStringLimit(firstText(item?.content, item?.caption, item?.alt), `${field}[${index}].content`, 10_000)
    result.push({
      url,
      type: mediaTypeFromValue(item),
      ...(thumbUrl && { thumbUrl }),
      ...(content && { content }),
    })
  }
  return result
}

function blockToHtml(block: PublicObjectFields): string {
  const type = firstText(block.type).toLowerCase()
  const rawHtml = firstText(block.html, block.content_html)
  if (rawHtml)
    return rawHtml

  if (type === 'image') {
    const url = mediaUrlFromValue(block)
    if (!url)
      return ''
    const alt = escapeHtml(firstText(block.alt, block.caption, block.title))
    return `<p><img src="${escapeHtml(url)}"${alt ? ` alt="${alt}"` : ''} /></p>`
  }
  if (type === 'video') {
    const url = mediaUrlFromValue(block)
    return url ? `<p><video controls src="${escapeHtml(url)}"></video></p>` : ''
  }

  const text = firstText(block.text, block.content, block.body)
  if (!text)
    return ''
  if (['heading', 'h1', 'h2', 'h3'].includes(type))
    return `<h2>${escapeHtml(text)}</h2>`
  return textToHtml(text)
}

function extractMediaFromHtml(html: string): PublicMedia[] {
  const result: PublicMedia[] = []
  const patterns: Array<[RegExp, MediaType]> = [
    [/<img\b[^>]*\bsrc=["']([^"']+)["'][^>]*>/gi, MediaType.IMG],
    [/<(?:video|source)\b[^>]*\bsrc=["']([^"']+)["'][^>]*>/gi, MediaType.VIDEO],
  ]
  for (const [pattern, type] of patterns) {
    let match: RegExpExecArray | null
    while ((match = pattern.exec(html)) !== null) {
      assertSafeUrl(match[1], 'draft.html media URL')
      result.push({ url: match[1], type })
    }
  }
  return result
}

function topicsFromValue(value: any, field: string): string[] {
  if (value === undefined || value === null)
    return []
  if (!Array.isArray(value))
    throw new BadRequestException(`${field} must be an array`)
  if (value.length > 100)
    throw new BadRequestException(`${field} exceeds 100 entries`)
  return [...new Set(value
    .map(item => assertStringLimit(firstText(item).replace(/^#/, '').trim(), field, 100))
    .filter(Boolean))]
}

function normalizePlatformVariants(value: any): PublicPlatformVariant[] {
  if (value === undefined || value === null)
    return []
  if (!Array.isArray(value))
    throw new BadRequestException('draft.platform_variants must be an array')
  if (value.length > 32)
    throw new BadRequestException('draft.platform_variants exceeds 32 entries')

  return value.map((variant, index) => {
    if (!variant || typeof variant !== 'object' || Array.isArray(variant))
      throw new BadRequestException(`draft.platform_variants[${index}] must be an object`)
    const platform = normalizeAccountType(variant.platform)
    const title = assertStringLimit(firstText(variant.title), `draft.platform_variants[${index}].title`, 300)
    const body = assertStringLimit(firstText(variant.body, variant.text, variant.description), `draft.platform_variants[${index}].body`, 200_000)
    if (!platform || !title || !body)
      throw new BadRequestException(`draft.platform_variants[${index}] requires a supported platform, title and body`)
    return {
      platform,
      title,
      body,
      hashtags: topicsFromValue(variant.hashtags ?? variant.topics, `draft.platform_variants[${index}].hashtags`),
      media: normalizeMediaList(variant.media, `draft.platform_variants[${index}].media`),
    }
  })
}

function rejectGovernanceFields(draft: Record<string, any>): void {
  for (const key of Object.keys(draft)) {
    if (FORBIDDEN_GOVERNANCE_FIELDS.has(key.toLowerCase()))
      throw new BadRequestException(`draft.${key} is an internal governance field and cannot be imported`)
  }
}

function compactProvenance(draft: OrchestrationDraftLike): Record<string, string | number> {
  const entries: Record<string, string | number> = {
    source_id: firstText(draft.draft_id, draft.draftId, draft.package_id, draft.packageId),
    platform: firstText(draft.platform),
    format: firstText(draft.format),
    status: firstText(draft.status),
    version: Number.isFinite(Number(draft.version)) ? Number(draft.version) : 1,
    model: firstText(draft.model),
    prompt_version: firstText(draft.prompt_version, draft.promptVersion),
  }
  return Object.fromEntries(Object.entries(entries).filter(([, value]) => value !== ''))
}

export function normalizePublicDraft(draft: OrchestrationDraftLike | null | undefined): PublicDraftSnapshot {
  if (!draft || typeof draft !== 'object' || Array.isArray(draft))
    throw new BadRequestException('draft must be an object')
  rejectGovernanceFields(draft)

  const sourceId = assertStringLimit(firstText(draft.draft_id, draft.draftId, draft.package_id, draft.packageId), 'draft source id', 256)
  const title = assertStringLimit(firstText(draft.title, draft.master_title, draft.masterTitle), 'draft.title', 300)
  const rawHtml = firstText(draft.html, draft.articleHtml, draft.article_html, draft.contentHtml, draft.content_html)
  const safeHtml = rawHtml ? assertSafeHtml(rawHtml, 'draft.html') : ''
  const body = assertStringLimit(
    firstText(draft.body, draft.master_content, draft.masterContent, draft.clean_text, htmlToText(safeHtml), draft.description),
    'draft.body',
    500_000,
  )
  const description = assertStringLimit(firstText(draft.description, draft.summary), 'draft.description', 20_000)
  const blocks = sanitizePublicObjects(draft.blocks, 'draft.blocks')
  const components = sanitizePublicObjects(draft.components, 'draft.components')
  const html = safeHtml || blocks.map(blockToHtml).filter(Boolean).join('') || textToHtml(body)
  const coverUrl = firstText(draft.cover_url, draft.coverUrl)
  if (coverUrl)
    assertSafeUrl(coverUrl, 'draft.coverUrl')

  const media = normalizeMediaList(draft.media, 'draft.media')
  const blockMedia = normalizeMediaList(
    blocks.filter(item => ['image', 'video'].includes(firstText(item.type).toLowerCase())),
    'draft.blocks',
  )
  const htmlMedia = extractMediaFromHtml(html)
  const seenMedia = new Set<string>()
  const allMedia = [...media, ...blockMedia, ...htmlMedia].filter((item) => {
    if (seenMedia.has(item.url))
      return false
    seenMedia.add(item.url)
    return true
  })
  const platformVariants = normalizePlatformVariants(draft.platform_variants ?? draft.platformVariants)
  const status = firstText(draft.status)
  if (status && !['approved', 'ready_to_publish'].includes(status))
    throw new BadRequestException('draft.status must be approved or ready_to_publish')
  if (!sourceId)
    throw new BadRequestException('draft.draft_id or draft.package_id is required')
  if (!title)
    throw new BadRequestException('draft.title or draft.master_title is required')
  if (!body && !html && !allMedia.length)
    throw new BadRequestException('draft must contain public final content or media')

  return {
    sourceId,
    title,
    body,
    html,
    description,
    coverUrl,
    format: assertStringLimit(firstText(draft.format, 'article'), 'draft.format', 100),
    platform: assertStringLimit(firstText(draft.platform, platformVariants[0]?.platform, 'wechat_mp'), 'draft.platform', 100),
    topics: topicsFromValue(draft.hashtags ?? draft.topics, 'draft.hashtags'),
    media: allMedia,
    blocks,
    components,
    platformVariants,
    provenance: compactProvenance(draft),
  }
}

export function resolveSourceKey(
  body: OrchestrationDraftImportBody,
  idempotencyHeader: string | string[] | undefined,
  fallbackSourceId: string,
): string {
  const header = firstText(Array.isArray(idempotencyHeader) ? idempotencyHeader[0] : idempotencyHeader)
  const bodyIdempotencyKey = firstText(body.idempotencyKey, body.idempotency_key)
  const sourceKey = firstText(body.sourceKey)
  const supplied = [sourceKey, bodyIdempotencyKey, header].filter(Boolean)
  if (new Set(supplied).size > 1)
    throw new BadRequestException('sourceKey and Idempotency-Key values must match when supplied together')
  const resolved = assertStringLimit(firstText(...supplied, fallbackSourceId), 'sourceKey', 256)
  if (!resolved || /[\u0000-\u001f\u007f]/.test(resolved))
    throw new BadRequestException('sourceKey is required and cannot contain control characters')
  return resolved
}

function canonicalize(value: any): any {
  if (Array.isArray(value))
    return value.map(canonicalize)
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.keys(value)
        .sort()
        .filter(key => value[key] !== undefined)
        .map(key => [key, canonicalize(value[key])]),
    )
  }
  return value
}

export function sha256(value: any): string {
  return createHash('sha256').update(JSON.stringify(canonicalize(value))).digest('hex')
}
