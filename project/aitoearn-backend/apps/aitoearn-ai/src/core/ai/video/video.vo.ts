import { createPaginationVo, createZodDto, zodI18nString } from '@yikart/common'
import { AiLogChannel } from '@yikart/mongodb'
import { z } from 'zod'

const videoGenerationResponseSchema = z.object({
  id: z.string().describe('Task ID'),
  status: z.string().describe('Task status'),
})

export class VideoGenerationResponseVo extends createZodDto(videoGenerationResponseSchema) {}

const videoTaskInputSchema = z.object({
  prompt: z.string().describe('Prompt'),
  image: z.string().or(z.string().array()).optional().describe('Image URL'),
  referenceImages: z.array(z.string()).optional().describe('Reference image URLs'),
  referenceVideos: z.array(z.string()).optional().describe('Reference video URLs'),
  referenceAudios: z.array(z.string()).optional().describe('Reference audio URLs'),
  duration: z.number().optional().describe('Duration in seconds'),
  aspectRatio: z.string().optional().describe('Aspect ratio'),
  resolution: z.string().optional().describe('Resolution'),
  videoUrl: z.string().optional().describe('Video URL'),
})

export type VideoTaskInput = z.infer<typeof videoTaskInputSchema>

const videoTaskStatusResponseSchema = z.object({
  id: z.string().describe('Task ID'),
  model: z.string().describe('Model name'),
  status: z.string().describe('Task status'),
  input: videoTaskInputSchema.describe('Input parameters'),
  videoUrl: z.string().optional().describe('Generated video URL'),
  error: z.object({
    message: z.string().describe('Error message'),
  }).optional().describe('Error information'),
  submittedAt: z.date().describe('Submitted time'),
  startedAt: z.date().describe('Started time'),
  finishedAt: z.date().optional().describe('Finished time'),
})

export class VideoTaskStatusResponseVo extends createZodDto(videoTaskStatusResponseSchema) {}

export class ListVideoTasksResponseVo extends createPaginationVo(videoTaskStatusResponseSchema) {}

const videoGenerationModelSchema = z.object({
  name: z.string().describe('Model name'),
  description: z.string().describe('Model description'),
  summary: z.string().optional(),
  logo: z.string().optional(),
  tags: z.array(zodI18nString()).default([]),
  mainTag: z.string().optional(),
  channel: z.enum(AiLogChannel).describe('Channel'),
  modes: z.array(z.enum([
    'text2video',
    'image2video',
    'flf2video',
    'lf2video',
    'multi-image2video',
    'video2video',
    'reference2video',
  ])).describe('Supported modes'),
  resolutions: z.array(z.string()).describe('Supported resolutions'),
  durations: z.array(z.number()).describe('Supported durations'),
  maxInputImages: z.number().describe('Max input images'),
  maxReferenceImages: z.number().optional().describe('Max reference images'),
  maxReferenceVideos: z.number().optional().describe('Max reference videos'),
  maxReferenceAudios: z.number().optional().describe('Max reference audios'),
  aspectRatios: z.array(z.string()).describe('Supported aspect ratios'),
  defaults: z.object({
    resolution: z.string().optional(),
    aspectRatio: z.string().optional(),
    duration: z.number().optional(),
  }).describe('Defaults'),
  pricing: z.object({
    resolution: z.string().optional(),
    aspectRatio: z.string().optional(),
    mode: z.string().optional(),
    duration: z.number().optional(),
    price: z.number(),
    discount: z.string().optional(),
    originPrice: z.number().optional(),
  }).array().describe('Pricing table'),
})

export class VideoGenerationModelParamsVo extends createZodDto(videoGenerationModelSchema) {}
