import { BadRequestException, Body, ConflictException, Controller, Headers, Post } from '@nestjs/common'
import { ApiTags } from '@nestjs/swagger'
import { Internal } from '@yikart/aitoearn-auth'
import { ApiDoc, UserType } from '@yikart/common'
import { MaterialSource, MaterialStatus, MaterialType } from '@yikart/mongodb'
import { MaterialGroupService } from '../content/material-group.service'
import { MaterialService } from '../content/material.service'
import {
  firstText,
  normalizeAccountType,
  normalizeAccountTypes,
  normalizePublicDraft,
  OrchestrationDraftImportBody,
  resolveSourceKey,
  sha256,
} from './orchestration-draft-import'

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
    description: [
      'sourceKey is the canonical idempotency identity scoped by userId.',
      'Idempotency-Key header and body.idempotencyKey are aliases and must equal sourceKey when combined.',
      'Legacy callers may omit all three; draft_id/package_id is then used as sourceKey.',
    ].join(' '),
  })
  @Post('drafts/import')
  async importDraft(
    @Body() body: OrchestrationDraftImportBody,
    @Headers('idempotency-key') idempotencyHeader?: string | string[],
  ) {
    const userId = firstText(body?.userId)
    if (!userId)
      throw new BadRequestException('userId is required')

    const draft = normalizePublicDraft(body?.draft)
    const sourceKey = resolveSourceKey(body, idempotencyHeader, draft.sourceId)

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

    const explicitAccountTypes = normalizeAccountTypes(body.accountTypes)
    const draftPlatform = normalizeAccountType(draft.platform)
    const accountTypes = [...new Set([
      ...explicitAccountTypes,
      ...draft.platformVariants.map(variant => variant.platform),
      ...(draftPlatform ? [draftPlatform] : []),
    ])]

    const publicContent = {
      title: draft.title,
      body: draft.body,
      html: draft.html,
      description: draft.description,
      coverUrl: draft.coverUrl,
      format: draft.format,
      platform: draft.platform,
      topics: draft.topics,
      media: draft.media,
      blocks: draft.blocks,
      components: draft.components,
      platformVariants: draft.platformVariants,
    }
    const contentSha256 = sha256(publicContent)
    const requestSha256 = sha256({
      userId,
      groupId,
      sourceKey,
      accountTypes,
      provenance: draft.provenance,
      content: publicContent,
    })

    const result = await this.materialService.upsertOrchestrationImport({
      userId,
      userType: UserType.User,
      taskId: draft.sourceId,
      groupId,
      coverUrl: draft.coverUrl,
      mediaList: draft.media,
      title: draft.title,
      desc: firstText(draft.body, draft.description),
      type: MaterialType.ARTICLE,
      topics: draft.topics,
      status: MaterialStatus.SUCCESS,
      source: MaterialSource.UPLOAD,
      option: {
        articleHtml: draft.html,
        article: {
          html: draft.html,
          body: draft.body,
          description: draft.description,
          summary: draft.description,
          blocks: draft.blocks,
          components: draft.components,
          media: draft.media,
          format: draft.format,
          platform: draft.platform,
          platformVariants: draft.platformVariants,
        },
        orchestration: {
          provider: 'ai-orchestration',
          // Immutable final public snapshot used by the approved-intent bridge.
          // Mutable material-box edits cannot silently change an approved post.
          publicContent,
          packageId: firstText(body.draft.package_id, body.draft.packageId),
          sourceKey,
          sourceId: draft.sourceId,
          requestSha256,
          contentSha256,
          raw: draft.provenance,
        },
      },
      generationParams: {
        draftType: 'article',
        platforms: accountTypes,
        source: 'ai-orchestration',
        platform: draft.platform,
        format: draft.format,
      },
      accountTypes,
    } as any, {
      sourceKey,
      requestSha256,
      contentSha256,
    })

    if (result.conflict) {
      throw new ConflictException(
        'sourceKey has already been used with different content or routing parameters',
      )
    }

    const material = result.material as any
    return {
      materialId: material.id || material._id,
      userId,
      groupId,
      sourceKey,
      requestSha256,
      contentSha256,
      idempotent: !result.created,
      material,
    }
  }
}
