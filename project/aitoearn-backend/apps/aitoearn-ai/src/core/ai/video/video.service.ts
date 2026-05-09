import { BadRequestException, Injectable, Logger } from '@nestjs/common'
import { StorageProvider } from '@yikart/assets'
import { AppException, ResponseCode, UserType } from '@yikart/common'
import { AiLog, AiLogChannel, AiLogRepository, AiLogStatus, AiLogType, UserRepository } from '@yikart/mongodb'
import { TaskStatus } from '../../../common'
import {
  Content,
  ContentType,
  GetVideoGenerationTaskResponse,
  AudioRole,
  ImageRole,
  parseModelTextCommand,
  serializeModelTextCommand,
  VideoRole,
} from '../libs/volcengine'
import { ModelsConfigService } from '../models-config'
import { GeminiVeoVideoCallbackDto, GeminiVideoService, UserGeminiVeoVideoCreateRequestDto } from './gemini'
import { GrokVideoCallbackDto, GrokVideoService } from './grok'
import { OpenAIVideoCallbackDto, OpenAIVideoService } from './openai'
import {
  UserListVideoTasksQueryDto,
  UserVideoGenerationRequestDto,
  UserVideoTaskQueryDto,
  VideoGenerationModelsQueryDto,
} from './video.dto'
import { VideoTaskInput } from './video.vo'
import { VolcengineVideoService } from './volcengine'

type VideoModelConfig = {
  maxInputImages: number
  maxReferenceImages?: number
  maxReferenceVideos?: number
  maxReferenceAudios?: number
  modes?: string[]
  defaults?: {
    resolution?: string
    aspectRatio?: string
    duration?: number
  }
}

type OpenAIVideoSize = '720x1280' | '1280x720' | '1024x1792' | '1792x1024'

@Injectable()
export class VideoService {
  private readonly logger = new Logger(VideoService.name)

  constructor(
    private readonly userRepo: UserRepository,
    private readonly aiLogRepo: AiLogRepository,
    private readonly modelsConfigService: ModelsConfigService,
    private readonly storageProvider: StorageProvider,
    private readonly volcengineVideoService: VolcengineVideoService,
    private readonly openaiVideoService: OpenAIVideoService,
    private readonly grokVideoService: GrokVideoService,
    private readonly geminiVideoService: GeminiVideoService,
  ) {}

  /**
   * 将图片 URL 转为 R2 预签名 URL，绕过 CDN robots.txt 限制
   */
  private async toPresignedUrl(url: string | undefined): Promise<string | undefined> {
    if (!url) {
      return undefined
    }

    if (/^(data:|asset:\/\/|gs:\/\/)/i.test(url)) {
      return url
    }

    const objectPath = this.storageProvider.parsePathFromUrl(url)
    if (objectPath.startsWith('http://') || objectPath.startsWith('https://')) {
      return url
    }

    return this.storageProvider.toPresignedUrl(url)
  }

  private async toPresignedUrls(urls: string[]): Promise<string[]> {
    const signedUrls = await Promise.all(urls.map(url => this.toPresignedUrl(url)))
    return signedUrls.filter((url): url is string => Boolean(url))
  }

  async calculateVideoGenerationPrice(params: {
    model: string
    userId?: string
    userType?: UserType
    resolution?: string
    aspectRatio?: string
    mode?: string
    duration?: number
  }): Promise<number> {
    const { model, userId, userType } = params

    const modelConfig = (await this.getVideoGenerationModelParams({ userId, userType })).find(m => m.name === model)
    if (!modelConfig) {
      throw new AppException(ResponseCode.InvalidModel)
    }

    const { resolution, aspectRatio, mode, duration } = {
      ...modelConfig.defaults,
      ...params,
    }

    const pricingConfig = modelConfig.pricing.find((pricing) => {
      const resolutionMatch = !pricing.resolution || !resolution || pricing.resolution === resolution
      const aspectRatioMatch = !pricing.aspectRatio || !aspectRatio || pricing.aspectRatio === aspectRatio
      const modeMatch = !pricing.mode || !mode || pricing.mode === mode
      const durationMatch = !pricing.duration || !duration || pricing.duration === duration

      return resolutionMatch && aspectRatioMatch && modeMatch && durationMatch
    })

    if (!pricingConfig) {
      throw new AppException(ResponseCode.InvalidModel)
    }

    this.logger.debug({
      params,
      modelConfig,
      pricingConfig,
    }, '模型价格计算')

    return pricingConfig.price
  }

  /**
   * 用户视频生成（通用接口）
   */
  async userVideoGeneration(request: UserVideoGenerationRequestDto) {
    const { model } = request

    const modelConfig = this.modelsConfigService.config.video.generation.find(m => m.name === model)
    if (!modelConfig) {
      throw new AppException(ResponseCode.InvalidModel)
    }

    const channel = modelConfig.channel

    const createTaskResponse = (taskId: string, points: number) => ({
      id: taskId,
      status: TaskStatus.Submitted,
      points,
    })

    switch (channel) {
      case AiLogChannel.Volcengine:
        return this.handleVolcengineGeneration(request, modelConfig, createTaskResponse)
      case AiLogChannel.OpenAI:
        return this.handleOpenAIGeneration(request, modelConfig, createTaskResponse)
      case AiLogChannel.Grok:
        return this.handleGrokGeneration(request, createTaskResponse)
      case AiLogChannel.Gemini:
        return this.handleGeminiGeneration(request, modelConfig, createTaskResponse)
      default:
        throw new AppException(ResponseCode.InvalidModel)
    }
  }

  private getMetadataString(request: UserVideoGenerationRequestDto, key: string): string | undefined {
    const value = request.metadata?.[key]
    return typeof value === 'string' ? value : undefined
  }

  private getMetadataNumber(request: UserVideoGenerationRequestDto, key: string): number | undefined {
    const value = request.metadata?.[key]
    return typeof value === 'number' ? value : undefined
  }

  private getStringArray(value: unknown): string[] {
    if (typeof value === 'string' && value.trim()) {
      return [value.trim()]
    }
    if (!Array.isArray(value)) {
      return []
    }
    return value.filter((item): item is string => typeof item === 'string' && item.trim().length > 0)
      .map(item => item.trim())
  }

  private uniqueStrings(values: string[]): string[] {
    return [...new Set(values)]
  }

  private getRequestStringList(request: UserVideoGenerationRequestDto, snakeKey: string, camelKey: string): string[] {
    const record = request as unknown as Record<string, unknown>
    return this.uniqueStrings([
      ...this.getStringArray(record[snakeKey]),
      ...this.getStringArray(record[camelKey]),
      ...this.getStringArray(request.metadata?.[snakeKey]),
      ...this.getStringArray(request.metadata?.[camelKey]),
    ])
  }

  private isReferenceMode(request: UserVideoGenerationRequestDto, imageList: string[], referenceCounts: number): boolean {
    const mode = request.mode || this.getMetadataString(request, 'mode')
    if (['reference2video', 'multimodal-reference', 'omni-reference', 'reference'].includes(mode || '')) {
      return true
    }
    return referenceCounts > 0 || (!request.image_tail && imageList.length > 2)
  }

  private getRequestImages(image: UserVideoGenerationRequestDto['image']): string[] {
    if (!image) {
      return []
    }
    return Array.isArray(image) ? image : [image]
  }

  private assertMaxInputImages(images: string[], modelConfig: VideoModelConfig) {
    if (images.length > modelConfig.maxInputImages) {
      throw new BadRequestException(`Too many input images, max is ${modelConfig.maxInputImages}`)
    }
  }

  private resolveOpenAISize(request: UserVideoGenerationRequestDto, modelConfig: VideoModelConfig): OpenAIVideoSize {
    const supportedSizes: OpenAIVideoSize[] = ['720x1280', '1280x720', '1024x1792', '1792x1024']
    if (request.size && supportedSizes.includes(request.size as OpenAIVideoSize)) {
      return request.size as OpenAIVideoSize
    }

    const resolution = this.getMetadataString(request, 'resolution') || modelConfig.defaults?.resolution
    const aspectRatio = this.getMetadataString(request, 'aspectRatio') || modelConfig.defaults?.aspectRatio || '9:16'
    const highResolution = resolution === '1024p' || resolution === '1080p'

    if (aspectRatio === '16:9') {
      return highResolution ? '1792x1024' : '1280x720'
    }

    return highResolution ? '1024x1792' : '720x1280'
  }

  /**
   * 处理Volcengine渠道的视频生成
   */
  private async handleVolcengineGeneration<T>(
    request: UserVideoGenerationRequestDto,
    modelConfig: VideoModelConfig,
    createTaskResponse: (taskId: string, points: number) => T,
  ) {
    const { userId, userType, model, prompt, duration, size, image, image_tail, video_url, audio_url } = request

    const imageList = this.getRequestImages(image)
    const configuredReferenceImages = this.getRequestStringList(request, 'reference_images', 'referenceImages')
    const configuredReferenceVideos = this.getRequestStringList(request, 'reference_videos', 'referenceVideos')
    const configuredReferenceAudios = this.getRequestStringList(request, 'reference_audios', 'referenceAudios')
    const referenceCounts = configuredReferenceImages.length + configuredReferenceVideos.length + configuredReferenceAudios.length
      + this.getStringArray(video_url).length + this.getStringArray(audio_url).length
    const useReferenceMode = this.isReferenceMode(request, imageList, referenceCounts)
    const resolution = this.getMetadataString(request, 'resolution') || size || modelConfig.defaults?.resolution
    const aspectRatio = this.getMetadataString(request, 'aspectRatio') || modelConfig.defaults?.aspectRatio
    const finalDuration = duration ?? modelConfig.defaults?.duration

    const textCommand = parseModelTextCommand(prompt)
    const content: Content[] = []

    if (useReferenceMode) {
      if (!modelConfig.modes?.includes('reference2video')) {
        throw new BadRequestException('Selected model does not support reference2video mode')
      }
      if (image_tail) {
        throw new BadRequestException('reference2video cannot be mixed with image_tail first/last-frame mode')
      }

      const referenceImages = this.uniqueStrings([...configuredReferenceImages, ...imageList])
      const referenceVideos = this.uniqueStrings([
        ...configuredReferenceVideos,
        ...this.getStringArray(video_url),
      ])
      const referenceAudios = this.uniqueStrings([
        ...configuredReferenceAudios,
        ...this.getStringArray(audio_url),
      ])

      const maxReferenceImages = modelConfig.maxReferenceImages ?? modelConfig.maxInputImages
      const maxReferenceVideos = modelConfig.maxReferenceVideos ?? 0
      const maxReferenceAudios = modelConfig.maxReferenceAudios ?? 0

      if (referenceImages.length > maxReferenceImages) {
        throw new BadRequestException(`Too many reference images, max is ${maxReferenceImages}`)
      }
      if (referenceVideos.length > maxReferenceVideos) {
        throw new BadRequestException(`Too many reference videos, max is ${maxReferenceVideos}`)
      }
      if (referenceAudios.length > maxReferenceAudios) {
        throw new BadRequestException(`Too many reference audios, max is ${maxReferenceAudios}`)
      }
      if (referenceAudios.length > 0 && referenceImages.length + referenceVideos.length === 0) {
        throw new BadRequestException('reference audio requires at least one reference image or reference video')
      }
      if (referenceImages.length + referenceVideos.length + referenceAudios.length === 0) {
        throw new BadRequestException('reference2video requires at least one reference image, video, or audio')
      }

      for (const referenceImage of await this.toPresignedUrls(referenceImages)) {
        content.push({
          type: ContentType.ImageUrl,
          image_url: { url: referenceImage },
          role: ImageRole.ReferenceImage,
        })
      }
      for (const referenceVideo of await this.toPresignedUrls(referenceVideos)) {
        content.push({
          type: ContentType.VideoUrl,
          video_url: { url: referenceVideo },
          role: VideoRole.ReferenceVideo,
        })
      }
      for (const referenceAudio of await this.toPresignedUrls(referenceAudios)) {
        content.push({
          type: ContentType.AudioUrl,
          audio_url: { url: referenceAudio },
          role: AudioRole.ReferenceAudio,
        })
      }
    }
    else {
      if (imageList.length > 2) {
        throw new BadRequestException('First/last-frame mode supports at most 2 input images. Use mode=reference2video for Seedance multimodal references.')
      }
      this.assertMaxInputImages(imageList, { ...modelConfig, maxInputImages: Math.min(modelConfig.maxInputImages, 2) })
      const firstFrame = imageList[0]
      const lastFrame = image_tail || imageList[1]

      if (firstFrame) {
        content.push({
          type: ContentType.ImageUrl,
          image_url: { url: await this.toPresignedUrl(firstFrame) || firstFrame },
          role: ImageRole.FirstFrame,
        })
      }

      if (lastFrame) {
        content.push({
          type: ContentType.ImageUrl,
          image_url: { url: await this.toPresignedUrl(lastFrame) || lastFrame },
          role: ImageRole.LastFrame,
        })
      }
    }

    content.push({
      type: ContentType.Text,
      text: `${textCommand.prompt} ${serializeModelTextCommand({
        ...textCommand.params,
        duration: finalDuration,
        resolution,
        ratio: aspectRatio,
      })}`,
    })

    const result = await this.volcengineVideoService.create({
      userId,
      userType,
      model,
      content,
    })
    return createTaskResponse(result.id, result.points)
  }

  /**
   * 处理OpenAI渠道的视频生成
   */
  private async handleOpenAIGeneration<T>(
    request: UserVideoGenerationRequestDto,
    modelConfig: VideoModelConfig,
    createTaskResponse: (taskId: string, points: number) => T,
  ) {
    const { userId, userType, model, prompt, image } = request

    const imageList = this.getRequestImages(image)
    this.assertMaxInputImages(imageList, modelConfig)
    if (imageList.length > 1) {
      throw new BadRequestException('OpenAI does not support multiple images')
    }
    const imageUrl = imageList[0]
    const duration = request.duration ?? modelConfig.defaults?.duration

    const result = await this.openaiVideoService.createVideo({
      userId,
      userType,
      prompt,
      input_reference: await this.toPresignedUrl(imageUrl),
      model: model as any,
      seconds: duration ? duration.toString() as '10' | '15' | '25' : undefined,
      size: this.resolveOpenAISize(request, modelConfig),
    })
    return createTaskResponse(result.id, result.points)
  }

  /**
   * å¤„ç†Gemini/Veoæ¸ é“çš„è§†é¢‘ç”Ÿæˆ
   */
  private async handleGeminiGeneration<T>(
    request: UserVideoGenerationRequestDto,
    modelConfig: VideoModelConfig,
    createTaskResponse: (taskId: string, points: number) => T,
  ) {
    const { userId, userType, model, prompt, image, image_tail, video_url } = request
    const imageList = this.getRequestImages(image)
    this.assertMaxInputImages(imageList, modelConfig)

    const resolution = (this.getMetadataString(request, 'resolution') || request.size || modelConfig.defaults?.resolution || '720p') as '720p' | '1080p' | '4000'
    const aspectRatio = (this.getMetadataString(request, 'aspectRatio') || modelConfig.defaults?.aspectRatio || '9:16') as '16:9' | '9:16'
    const seed = this.getMetadataNumber(request, 'seed')
    const negativePrompt = this.getMetadataString(request, 'negativePrompt')
    const baseRequest = {
      userId,
      userType,
      model,
      prompt,
      seed,
      negativePrompt,
      resolution: resolution as '720p' | '1080p' | '4000' | undefined,
      aspectRatio,
    }

    if (video_url) {
      const videoUrl = video_url.startsWith('http') || video_url.startsWith('gs://')
        ? video_url
        : await this.storageProvider.toPresignedUrl(video_url)

      const result = await this.geminiVideoService.createVideo({
        ...baseRequest,
        video: videoUrl,
        duration: 7,
      } as UserGeminiVeoVideoCreateRequestDto)
      return createTaskResponse(result.id, result.points)
    }

    if (imageList.length > 1 && model === 'veo3.1-components' && !image_tail) {
      const result = await this.geminiVideoService.createVideo({
        ...baseRequest,
        referenceImages: await this.toPresignedUrls(imageList),
        duration: 8,
      } as UserGeminiVeoVideoCreateRequestDto)
      return createTaskResponse(result.id, result.points)
    }

    const firstFrame = imageList[0]
    const lastFrame = image_tail || imageList[1]
    const result = await this.geminiVideoService.createVideo({
      ...baseRequest,
      image: firstFrame ? await this.toPresignedUrl(firstFrame) : undefined,
      lastFrame: lastFrame ? await this.toPresignedUrl(lastFrame) : undefined,
      duration: request.duration ?? modelConfig.defaults?.duration ?? 8,
    } as UserGeminiVeoVideoCreateRequestDto)
    return createTaskResponse(result.id, result.points)
  }

  /**
   * 处理Grok渠道的视频生成
   */
  private async handleGrokGeneration<T>(
    request: UserVideoGenerationRequestDto,
    createTaskResponse: (taskId: string, points: number) => T,
  ) {
    const { userId, userType, model, prompt, video_url } = request

    if (video_url) {
      const parsed = this.storageProvider.parsePathFromUrl(video_url)
      const videoUrl = parsed.startsWith('http') ? video_url : await this.storageProvider.toPresignedUrl(video_url)
      const result = await this.grokVideoService.createVideo({
        userId,
        userType,
        model,
        prompt,
        videoUrl,
      })
      return createTaskResponse(result.id, result.points)
    }

    const imageUrl = Array.isArray(request.image) ? request.image[0] : request.image
    const result = await this.grokVideoService.createVideo({
      userId,
      userType,
      model,
      prompt,
      duration: request.duration,
      aspectRatio: request.metadata?.['aspectRatio'] as string,
      resolution: request.metadata?.['resolution'] as string,
      imageUrl: imageUrl ? await this.toPresignedUrl(imageUrl) : undefined,
    })
    return createTaskResponse(result.id, result.points)
  }

  private extractInput(aiLog: AiLog): VideoTaskInput {
    const request = (aiLog.request || {}) as Record<string, unknown>

    switch (aiLog.channel) {
      case AiLogChannel.Volcengine:
        return this.volcengineVideoService.extractInput(request)
      case AiLogChannel.OpenAI:
        return this.openaiVideoService.extractInput(request)
      case AiLogChannel.Grok:
        return this.grokVideoService.extractInput(request)
      case AiLogChannel.Gemini:
        return this.geminiVideoService.extractInput(request)
      default:
        return { prompt: '' }
    }
  }

  async transformToCommonResponse(aiLog: AiLog) {
    const input = this.extractInput(aiLog)

    const base = {
      id: aiLog.id,
      model: aiLog.model,
      input,
      submittedAt: aiLog.startedAt,
      startedAt: aiLog.startedAt,
    }

    if (aiLog.status === AiLogStatus.Generating) {
      return {
        ...base,
        status: TaskStatus.InProgress,
        videoUrl: undefined as string | undefined,
        error: undefined as { message: string } | undefined,
        finishedAt: undefined as Date | undefined,
      }
    }

    if (!aiLog.response) {
      throw new AppException(ResponseCode.InvalidAiTaskId)
    }

    const finishedAt = aiLog.duration
      ? new Date(aiLog.startedAt.getTime() + aiLog.duration)
      : undefined

    const channelResult = this.getChannelTaskResult(aiLog)

    return {
      ...base,
      ...channelResult,
      finishedAt,
    }
  }

  private getChannelTaskResult(aiLog: AiLog) {
    switch (aiLog.channel) {
      case AiLogChannel.Volcengine:
        return this.volcengineVideoService.getTaskResult(aiLog.response as unknown as GetVideoGenerationTaskResponse)
      case AiLogChannel.OpenAI:
        return this.openaiVideoService.getTaskResult(aiLog.response as unknown as OpenAIVideoCallbackDto)
      case AiLogChannel.Grok:
        return this.grokVideoService.getTaskResult(aiLog.response as unknown as GrokVideoCallbackDto)
      case AiLogChannel.Gemini:
        return this.geminiVideoService.getTaskResult(aiLog.response as unknown as GeminiVeoVideoCallbackDto)
      default:
        throw new AppException(ResponseCode.InvalidAiTaskId)
    }
  }

  /**
   * 查询视频任务状态
   */
  async getVideoTaskStatus(request: UserVideoTaskQueryDto) {
    const { taskId } = request

    const aiLog = await this.aiLogRepo.getById(taskId)

    if (aiLog == null || aiLog.type !== AiLogType.Video) {
      throw new AppException(ResponseCode.InvalidAiTaskId)
    }
    return this.transformToCommonResponse(aiLog)
  }

  async listVideoTasks(request: UserListVideoTasksQueryDto) {
    const [aiLogs, count] = await this.aiLogRepo.listWithPagination({
      ...request,
      type: AiLogType.Video,
    })

    return [await Promise.all(aiLogs.map(log => this.transformToCommonResponse(log))), count] as const
  }

  /**
   * 获取视频生成模型参数
   */
  async getVideoGenerationModelParams(_data: VideoGenerationModelsQueryDto) {
    return this.modelsConfigService.config.video.generation
  }
}
