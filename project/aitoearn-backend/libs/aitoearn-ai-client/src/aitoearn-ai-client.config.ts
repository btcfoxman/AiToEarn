import { createZodDto } from '@yikart/common'
import z from 'zod'

export const DEFAULT_AI_CLIENT_TIMEOUT_MS = 3 * 60 * 1000

export const aitoearnAiClientConfigSchema = z.object({
  baseUrl: z.string(),
  token: z.string(),
  timeout: z.number().int().positive().default(DEFAULT_AI_CLIENT_TIMEOUT_MS),
})

export class AitoearnAiClientConfig extends createZodDto(aitoearnAiClientConfigSchema) {}
