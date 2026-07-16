import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose'
import { AccountType, UserType } from '@yikart/common'
import { DEFAULT_SCHEMA_OPTIONS } from '../mongodb.constants'
import { FileMetadata, MediaType } from './media.schema'
import { WithTimestampSchema } from './timestamp.schema'

export enum MaterialType {
  VIDEO = 'video', // 视频
  ARTICLE = 'article', // 文章
}

export enum MaterialStatus {
  WAIT = 0,
  SUCCESS = 1,
  FAIL = -1,
}

/** 素材来源 */
export enum MaterialSource {
  UPLOAD = 'upload',
  GOOGLE_MAPS = 'google_maps',
  PlaceDraft = 'place_draft',
}

/** 品牌关联信息 */
@Schema({ _id: false })
export class MaterialBrandInfo {
  @Prop({ required: true, index: true })
  libraryId: string

  @Prop({ required: true })
  placeId: string

  @Prop({ required: false })
  photoReference?: string
}

@Schema({
  versionKey: false,
  toJSON: { virtuals: true },
  toObject: { virtuals: true },
})
export class MaterialMedia {
  @Prop({
    required: true,
  })
  url: string

  @Prop({
    required: false,
  })
  thumbUrl?: string // 缩略图

  @Prop({
    type: Object,
  })
  metadata?: FileMetadata

  @Prop({
    required: true,
  })
  type: MediaType

  @Prop({
    required: false,
    default: '',
  })
  content?: string

  @Prop({
    required: false,
  })
  mediaId?: string
}
@Schema({ ...DEFAULT_SCHEMA_OPTIONS, collection: 'material' })
export class Material extends WithTimestampSchema {
  id: string

  @Prop({
    required: true,
    index: true,
  })
  userId: string

  @Prop({
    required: true,
    index: true,
    default: UserType.User,
  })
  userType: UserType

  @Prop({
    required: true,
    index: true,
  })
  groupId: string // 所属组ID

  @Prop({
    required: false,
    index: true,
  })
  taskId?: string // 使用生成的任务ID

  /** Stable upstream identity for an ai-orchestration import. */
  @Prop({ required: false })
  orchestrationSourceKey?: string

  /** SHA-256 of the canonical import request after public-field normalization. */
  @Prop({ required: false })
  orchestrationRequestSha256?: string

  /** SHA-256 of the canonical public final content. */
  @Prop({ required: false })
  orchestrationContentSha256?: string

  /** 素材来源 */
  @Prop({
    required: true,
    enum: MaterialSource,
    default: MaterialSource.UPLOAD,
    index: true,
  })
  source: MaterialSource

  /** 品牌关联信息 */
  @Prop({ type: MaterialBrandInfo, required: false })
  brandInfo?: MaterialBrandInfo

  @Prop({
    required: true,
    enum: MaterialType,
    index: true,
  })
  type: MaterialType

  @Prop({
    required: false,
  })
  coverUrl?: string

  @Prop({
    required: true,
    type: [MaterialMedia],
    default: [],
  })
  mediaList: MaterialMedia[]

  @Prop({
    required: false,
  })
  title?: string

  @Prop({
    required: false,
  })
  desc?: string

  // 话题
  @Prop({
    required: true,
    type: [String],
    default: [],
  })
  topics: string[]

  @Prop({
    required: false,
    default: {},
    type: Object, // 明确指定类型为 Object
  })
  option?: Record<string, any>

  @Prop({
    required: true,
    enum: MaterialStatus,
    default: MaterialStatus.SUCCESS,
  })
  status: MaterialStatus

  @Prop({
    required: false,
    default: '',
  })
  message?: string

  @Prop({
    required: true,
    default: 0,
    index: true,
  })
  useCount: number

  @Prop({
    required: false,
    index: true,
  })
  maxUseCount?: number

  // 是否自动删除素材
  @Prop({
    required: true,
    default: false,
  })
  autoDeleteMedia: boolean

  // 模型
  @Prop({
    required: false,
  })
  model?: string

  // AI 生成参数（如 prompt、aspectRatio、duration、imageUrls 等，仅 AI 生成草稿有值）
  @Prop({
    required: false,
    default: undefined,
    type: Object,
  })
  generationParams?: Record<string, any>

  // 适用的频道类型
  @Prop({
    required: true,
    type: [String],
    enum: AccountType,
    default: [],
    index: true,
  })
  accountTypes: AccountType[]
}

export const MaterialSchema = SchemaFactory.createForClass(Material)

MaterialSchema.index({ 'userId': 1, 'brandInfo.placeId': 1 })
MaterialSchema.index(
  { userId: 1, orchestrationSourceKey: 1 },
  {
    unique: true,
    name: 'uniq_material_orchestration_source',
    partialFilterExpression: {
      orchestrationSourceKey: { $type: 'string' },
    },
  },
)
