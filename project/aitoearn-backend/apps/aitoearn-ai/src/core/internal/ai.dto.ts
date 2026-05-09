import { createZodDto, PaginationDtoSchema, UserType } from '@yikart/common'
import { z } from 'zod'

const AdminImageGenerationSchema = z.object({
  prompt: z.string().min(1).max(4000).describe('Image prompt'),
  model: z.string().describe('Image generation model'),
  n: z.number().int().min(1).max(10).optional().describe('Number of images'),
  quality: z.string().optional().describe('Image quality'),
  response_format: z.enum(['url', 'b64_json']).optional().describe('Response format'),
  size: z.string().optional().describe('Image size'),
  style: z.string().optional().describe('Image style'),
  user: z.string().optional().describe('User identifier'),
  userId: z.string().describe('User ID'),
  userType: z.enum(UserType).describe('User type'),
})
export class AdminImageGenerationDto extends createZodDto(AdminImageGenerationSchema) { }

const videoGenerationRequestSchema = z.object({
  model: z.string().min(1).describe('Model name'),
  userId: z.string().describe('User ID'),
  userType: z.enum(UserType).describe('User type'),
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
  metadata: z.record(z.string(), z.any()).optional().describe('Additional parameters'),
})
export class AdminVideoGenerationRequestDto extends createZodDto(videoGenerationRequestSchema) { }

const AdminVideoGenerationStatusSchema = z.object({
  userId: z.string().describe('User ID'),
  userType: z.enum(UserType).describe('User type'),
  taskId: z.string().describe('Task ID'),
})
export class AdminVideoGenerationStatusSchemaDto extends createZodDto(AdminVideoGenerationStatusSchema) { }

const adminListUserVideoTasksQuerySchema = z.object({
  ...PaginationDtoSchema.shape,
  userId: z.string().describe('User ID'),
  userType: z.enum(UserType).describe('User type'),
})

export class AdminUserListVideoTasksQueryDto extends createZodDto(adminListUserVideoTasksQuerySchema) {}

const imageEditSchema = z.object({
  userId: z.string().describe('User ID'),
  userType: z.enum(UserType).describe('User type'),
  model: z.string().describe('Image edit model'),
  image: z.string().or(z.string().array()).describe('Original image'),
  prompt: z.string().min(1).max(4000).describe('Edit prompt'),
  mask: z.string().optional().describe('Mask image'),
  n: z.int().min(1).max(100).optional().describe('Number of images'),
  size: z.string().optional().describe('Image size'),
  response_format: z.enum(['url', 'b64_json']).optional().describe('Response format'),
  user: z.string().optional().describe('User identifier'),
})

export class AdminImageEditDto extends createZodDto(imageEditSchema) {}

const adminQrCodeArtSchema = z.object({
  userId: z.string().describe('User ID'),
  userType: z.enum(UserType).describe('User type'),
  content: z.string().min(1).max(2000).describe('QR code content'),
  referenceImageUrl: z.url().optional().describe('Reference style image URL'),
  prompt: z.string().min(1).max(4000).describe('Prompt'),
  model: z.string().default('gpt-image-2').describe('Image generation model'),
  size: z.string().optional().describe('Image size'),
})

export class AdminQrCodeArtDto extends createZodDto(adminQrCodeArtSchema) {}
