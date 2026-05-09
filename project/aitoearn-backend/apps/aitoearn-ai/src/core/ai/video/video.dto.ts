import { createZodDto, PaginationDtoSchema, UserType } from '@yikart/common'
import { z } from 'zod'

const videoGenerationRequestSchema = z.object({
  model: z.string().min(1).describe('Model name'),
  prompt: z.string().min(1).max(4000).describe('Prompt'),
  image: z.string().or(z.string().array()).optional().describe('Image URL, base64, or asset path'),
  image_tail: z.string().optional().describe('Last-frame image URL, base64, or asset path'),
  video_url: z.string().optional().describe('Video URL, base64, or asset path'),
  audio_url: z.string().optional().describe('Audio URL, base64, or asset path'),
  reference_images: z.array(z.string()).optional().describe('Reference image URLs for multimodal reference generation'),
  reference_videos: z.array(z.string()).optional().describe('Reference video URLs for multimodal reference generation'),
  reference_audios: z.array(z.string()).optional().describe('Reference audio URLs for multimodal reference generation'),
  referenceImages: z.array(z.string()).optional().describe('Reference image URLs for multimodal reference generation'),
  referenceVideos: z.array(z.string()).optional().describe('Reference video URLs for multimodal reference generation'),
  referenceAudios: z.array(z.string()).optional().describe('Reference audio URLs for multimodal reference generation'),
  mode: z.string().optional().describe('Generation mode'),
  size: z.string().optional().describe('Size or resolution'),
  duration: z.number().optional().describe('Duration in seconds'),
  metadata: z.record(z.string(), z.unknown()).optional().describe('Additional parameters'),
})

export class VideoGenerationRequestDto extends createZodDto(videoGenerationRequestSchema) {}

const videoTaskQuerySchema = z.object({
  taskId: z.string().min(1).describe('Task ID'),
})

export class VideoTaskQueryDto extends createZodDto(videoTaskQuerySchema) {}

const userVideoGenerationRequestSchema = z.object({
  userId: z.string(),
  userType: z.enum(UserType),
  ...videoGenerationRequestSchema.shape,
})

export class UserVideoGenerationRequestDto extends createZodDto(userVideoGenerationRequestSchema) {}

const userVideoTaskQuerySchema = z.object({
  userId: z.string(),
  userType: z.enum(UserType),
  ...videoTaskQuerySchema.shape,
})

export class UserVideoTaskQueryDto extends createZodDto(userVideoTaskQuerySchema) {}

const listVideoTasksQuerySchema = z.object({
  ...PaginationDtoSchema.shape,
})

export class ListVideoTasksQueryDto extends createZodDto(listVideoTasksQuerySchema) {}

const userListVideoTasksQuerySchema = z.object({
  userId: z.string(),
  userType: z.enum(UserType),
  ...listVideoTasksQuerySchema.shape,
})

export class UserListVideoTasksQueryDto extends createZodDto(userListVideoTasksQuerySchema) {}

const videoGenerationModelsQuerySchema = z.object({
  userId: z.string().optional().describe('User ID'),
  userType: z.enum(UserType).optional().describe('User type'),
})

export class VideoGenerationModelsQueryDto extends createZodDto(videoGenerationModelsQuerySchema) {}
