import { createZodDto } from '@yikart/common'
import { z } from 'zod'

export const volcengineConfigSchema = z.object({
  apiKey: z.string().describe('Volcengine API Key'),
  baseUrl: z.string().default('https://ark.cn-beijing.volces.com').describe('Volcengine Base URL'),
  videoRequestMode: z.enum(['auto', 'official', 'openai-compatible']).default('auto').describe('Volcengine video request payload mode'),
  videoGenerationTasksPath: z.string().default('/api/v3/contents/generations/tasks').describe('Volcengine video generation tasks API path'),
  accessKeyId: z.string().describe('Volcengine VOD AccessKey ID'),
  secretAccessKey: z.string().describe('Volcengine VOD Secret Access Key'),
  spaceName: z.string().describe('Volcengine VOD Space Name'),
  playbackBaseUrl: z.string().describe('播放基础 URL（完整 URL，如 http://play.vod.com）'),
  urlAuthPrimaryKey: z.string().describe('URL 鉴权主密钥'),
})

export class VolcengineConfig extends createZodDto(volcengineConfigSchema) {}
