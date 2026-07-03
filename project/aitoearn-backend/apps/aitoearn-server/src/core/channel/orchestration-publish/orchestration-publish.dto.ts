import { AccountType, createZodDto } from '@yikart/common'
import { z } from 'zod'

export const OrchestrationPublishTargetsQuerySchema = z.object({
  platform: z.enum([AccountType.WxGzh, AccountType.WechatMoments, AccountType.Toutiao]).optional(),
  contentType: z.enum(['image_text', 'article', 'weitoutiao']).optional(),
})

export class OrchestrationPublishTargetsQueryDto extends createZodDto(
  OrchestrationPublishTargetsQuerySchema,
) {}

export const LinkOrchestrationTargetSchema = z.object({
  publishTargetId: z.string().min(1),
  platform: z.enum([AccountType.WxGzh, AccountType.WechatMoments, AccountType.Toutiao]),
  contentType: z.enum(['image_text', 'article', 'weitoutiao']).optional(),
  groupId: z.string().optional(),
})

export class LinkOrchestrationTargetDto extends createZodDto(
  LinkOrchestrationTargetSchema,
) {}
