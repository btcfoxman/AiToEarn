import { BadRequestException } from '@nestjs/common'
import { UserType } from '@yikart/common'
import { AiLogChannel } from '@yikart/mongodb'
import { describe, expect, it, vi } from 'vitest'
import { AudioRole, ContentType, ImageRole, VideoRole } from '../libs/volcengine'
import { VideoService } from './video.service'

describe('VideoService Volcengine reference generation', () => {
  const createService = (modelOverrides: Record<string, unknown> = {}) => {
    const modelConfig = {
      name: 'doubao-seedance-2-0-fast-260128',
      channel: AiLogChannel.Volcengine,
      modes: ['text2video', 'image2video', 'flf2video', 'reference2video'],
      maxInputImages: 9,
      maxReferenceImages: 9,
      maxReferenceVideos: 3,
      maxReferenceAudios: 3,
      defaults: {
        duration: 6,
        resolution: '720p',
        aspectRatio: '9:16',
      },
      pricing: [{ price: 0 }],
      ...modelOverrides,
    }

    const storageProvider = {
      parsePathFromUrl: vi.fn((url: string) => url.startsWith('https://assets.example.com/') ? url.replace('https://assets.example.com/', '') : url),
      toPresignedUrl: vi.fn(async (url: string) => `signed:${url}`),
    }
    const volcengineVideoService = {
      create: vi.fn(async () => ({ id: 'task-id', points: 0 })),
    }

    const service = new VideoService(
      {} as never,
      {} as never,
      { config: { video: { generation: [modelConfig] } } } as never,
      storageProvider as never,
      volcengineVideoService as never,
      {} as never,
      {} as never,
      {} as never,
    )

    return { service, storageProvider, volcengineVideoService }
  }

  it('builds Seedance multimodal reference content', async () => {
    const { service, storageProvider, volcengineVideoService } = createService()

    await service.userVideoGeneration({
      userId: 'user-id',
      userType: UserType.User,
      model: 'doubao-seedance-2-0-fast-260128',
      mode: 'reference2video',
      prompt: 'make a short brand video',
      image: ['https://assets.example.com/ref-1.png', 'https://cdn.example.com/ref-2.png'],
      reference_videos: ['https://cdn.example.com/motion.mp4'],
      reference_audios: ['asset://audio-1'],
      duration: 8,
      size: '720p',
      metadata: { aspectRatio: '16:9' },
    })

    expect(storageProvider.toPresignedUrl).toHaveBeenCalledWith('https://assets.example.com/ref-1.png')
    expect(volcengineVideoService.create).toHaveBeenCalledWith(expect.objectContaining({
      content: [
        {
          type: ContentType.ImageUrl,
          image_url: { url: 'signed:https://assets.example.com/ref-1.png' },
          role: ImageRole.ReferenceImage,
        },
        {
          type: ContentType.ImageUrl,
          image_url: { url: 'https://cdn.example.com/ref-2.png' },
          role: ImageRole.ReferenceImage,
        },
        {
          type: ContentType.VideoUrl,
          video_url: { url: 'https://cdn.example.com/motion.mp4' },
          role: VideoRole.ReferenceVideo,
        },
        {
          type: ContentType.AudioUrl,
          audio_url: { url: 'asset://audio-1' },
          role: AudioRole.ReferenceAudio,
        },
        {
          type: ContentType.Text,
          text: 'make a short brand video --dur 8 --rs 720p --rt 16:9',
        },
      ],
    }))
  })

  it('keeps two images as first and last frame unless reference mode is requested', async () => {
    const { service, volcengineVideoService } = createService()

    await service.userVideoGeneration({
      userId: 'user-id',
      userType: UserType.User,
      model: 'doubao-seedance-2-0-fast-260128',
      prompt: 'animate between frames',
      image: ['first.png', 'last.png'],
    })

    expect(volcengineVideoService.create).toHaveBeenCalledWith(expect.objectContaining({
      content: expect.arrayContaining([
        expect.objectContaining({ role: ImageRole.FirstFrame }),
        expect.objectContaining({ role: ImageRole.LastFrame }),
      ]),
    }))
  })

  it('rejects audio-only reference generation', async () => {
    const { service } = createService()

    await expect(service.userVideoGeneration({
      userId: 'user-id',
      userType: UserType.User,
      model: 'doubao-seedance-2-0-fast-260128',
      mode: 'reference2video',
      prompt: 'make a video with this audio',
      reference_audios: ['asset://audio-1'],
    })).rejects.toBeInstanceOf(BadRequestException)
  })
})
