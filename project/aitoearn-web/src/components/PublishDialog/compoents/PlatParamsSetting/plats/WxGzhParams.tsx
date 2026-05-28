/**
 * WxGzhParams - 微信公众号平台参数设置
 * - 独立参数：title（与通用 title 区分，使用 option.wxGzh.title 保存）
 */
import type { ForwardedRef } from 'react'
import type {
  IPlatsParamsProps,
  IPlatsParamsRef,
} from '@/components/PublishDialog/compoents/PlatParamsSetting/plats/plats.type'
import type {
  OrchestrationPublishFeature,
  PubItem,
} from '@/components/PublishDialog/publishDialog.type'
import { forwardRef, memo } from 'react'
import { useTransClient } from '@/app/i18n/client'
import usePlatParamsCommon from '@/components/PublishDialog/compoents/PlatParamsSetting/hooks/usePlatParamsCoomon'
import PubParmasTextarea from '@/components/PublishDialog/compoents/PubParmasTextarea'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import { Textarea } from '@/components/ui/textarea'
import { OrchestrationContentTypeSelector } from './OrchestrationContentTypeSelector'

function asString(value: unknown) {
  return typeof value === 'string' ? value : ''
}

function asBoolean(value: unknown, fallback = false) {
  return typeof value === 'boolean' ? value : fallback
}

function pollOptionsToText(value: unknown) {
  return Array.isArray(value) ? value.map((item) => String(item)).join('\n') : ''
}

function textToPollOptions(value: string) {
  return value
    .split(/\r?\n/)
    .map((item) => item.trim())
    .filter(Boolean)
}

type OptionalArticleFeature = Extract<OrchestrationPublishFeature, 'poll' | 'wechat_channel_video'>

const OPTIONAL_ARTICLE_FEATURE_ALIASES: Record<string, OptionalArticleFeature> = {
  poll: 'poll',
  vote: 'poll',
  voting: 'poll',
  wechat_channel_video: 'wechat_channel_video',
  wechat_channels_video: 'wechat_channel_video',
  video_channel: 'wechat_channel_video',
  wx_channels_video: 'wechat_channel_video',
  wx_sph_video: 'wechat_channel_video',
}

function normalizeOptionalFeature(value: unknown): OptionalArticleFeature | null {
  const key = String(value ?? '')
    .trim()
    .replace(/[\s-]+/g, '_')
    .toLowerCase()
  return OPTIONAL_ARTICLE_FEATURE_ALIASES[key] ?? null
}

function normalizeOptionalFeatures(value: unknown): OptionalArticleFeature[] {
  const rawValues = Array.isArray(value)
    ? value
    : typeof value === 'string'
      ? value.split(/[,\s]+/)
      : []
  const result: OptionalArticleFeature[] = []
  for (const item of rawValues) {
    const feature = normalizeOptionalFeature(item)
    if (feature && !result.includes(feature)) {
      result.push(feature)
    }
  }
  return result
}

function featureSourcesFromObject(value: unknown) {
  const source = value && typeof value === 'object' ? (value as Record<string, unknown>) : {}
  return [
    source.features,
    source.publishFeatures,
    source.publish_features,
    source.supportedFeatures,
    source.supported_features,
  ]
}

function getTargetFeatureState(pubItem: PubItem) {
  const externalMeta = pubItem.account.externalMeta as Record<string, unknown> | undefined
  const capabilities = externalMeta?.capabilities as Record<string, unknown> | undefined
  const targetSnapshot = externalMeta?.targetSnapshot as Record<string, unknown> | undefined
  const snapshotCapabilities = targetSnapshot?.capabilities as Record<string, unknown> | undefined
  const sources = [
    ...featureSourcesFromObject(externalMeta),
    ...featureSourcesFromObject(capabilities),
    ...featureSourcesFromObject(targetSnapshot),
    ...featureSourcesFromObject(snapshotCapabilities),
  ].filter((value) => value !== undefined)

  const features = new Set<OptionalArticleFeature>()
  for (const source of sources) {
    normalizeOptionalFeatures(source).forEach((feature) => features.add(feature))
  }
  return {
    declared: sources.length > 0,
    features,
  }
}

function withBestEffortRequestedFeatures(params: Record<string, unknown>) {
  const nextParams = { ...params }
  const features = new Set<OptionalArticleFeature>([
    ...normalizeOptionalFeatures(nextParams.requested_features),
    ...normalizeOptionalFeatures(nextParams.requestedFeatures),
  ])

  features.delete('poll')
  features.delete('wechat_channel_video')
  if (asBoolean(nextParams.insert_poll, false)) {
    features.add('poll')
  }
  if (asBoolean(nextParams.insert_video_channel, false)) {
    features.add('wechat_channel_video')
  }

  const requestedFeatures = Array.from(features)
  delete nextParams.requestedFeatures
  delete nextParams.featurePolicy
  if (requestedFeatures.length > 0) {
    nextParams.requested_features = requestedFeatures
    nextParams.feature_policy = nextParams.feature_policy || 'best_effort'
  } else {
    delete nextParams.requested_features
    delete nextParams.feature_policy
  }
  return nextParams
}

function FeatureBestEffortHint({ visible }: { visible: boolean }) {
  if (!visible) {
    return null
  }
  return (
    <p className="text-xs leading-relaxed text-amber-600">
      当前发布目标未声明支持该组件，仍会继续发布文章，组件会按编排服务执行能力尽力插入。
    </p>
  )
}

const WxGzhParams = memo(
  forwardRef(
    (
      { pubItem, onImageToImage, isMobile }: IPlatsParamsProps,
      ref: ForwardedRef<IPlatsParamsRef>
    ) => {
      const { t } = useTransClient('publish')
      const { pubParmasTextareaCommonParams, setOnePubParams } = usePlatParamsCommon(
        pubItem,
        onImageToImage,
        isMobile
      )
      const orchestration = pubItem.params.option.orchestration ?? {}
      const orchestrationParams = (orchestration.params ?? {}) as Record<string, unknown>
      const targetFeatureState = getTargetFeatureState(pubItem)
      const isUnsupportedFeature = (feature: OptionalArticleFeature) => {
        return !targetFeatureState.declared || !targetFeatureState.features.has(feature)
      }
      const updateOrchestrationParams = (patch: Record<string, unknown>) => {
        const nextParams = withBestEffortRequestedFeatures({
          ...orchestrationParams,
          ...patch,
        })
        setOnePubParams(
          {
            option: {
              ...pubItem.params.option,
              orchestration: {
                ...orchestration,
                publishTargetId: pubItem.account.externalId || pubItem.account.uid,
                params: nextParams,
              },
            },
          },
          pubItem.account.id
        )
      }
      const showOrchestrationParams = pubItem.account.externalProvider === 'ai-orchestration'

      return (
        <>
          <PubParmasTextarea
            {...pubParmasTextareaCommonParams}
            extend={
              <>
                <div className="flex items-center h-8 mt-2.5">
                  <div className="shrink-0 w-[90px] mr-2.5">{t('form.title')}</div>
                  <Input
                    value={pubItem.params.title}
                    placeholder={t('form.titlePlaceholder')}
                    data-testid="publish-title-input"
                    onChange={(e) => {
                      setOnePubParams({ title: e.target.value }, pubItem.account.id)
                    }}
                  />
                </div>
                <OrchestrationContentTypeSelector
                  pubItem={pubItem}
                  setOnePubParams={setOnePubParams}
                />
                {showOrchestrationParams && (
                  <div className="mt-3 space-y-3 rounded-md border border-border bg-muted/20 p-3">
                    <div className="grid gap-3 sm:grid-cols-2">
                      <label className="flex items-center justify-between gap-3 rounded-md border border-border bg-background px-3 py-2">
                        <span className="text-xs font-medium text-muted-foreground">原创</span>
                        <Switch
                          checked={asBoolean(orchestrationParams.original, true)}
                          onCheckedChange={(checked) =>
                            updateOrchestrationParams({ original: checked })
                          }
                        />
                      </label>
                      <label className="flex items-center justify-between gap-3 rounded-md border border-border bg-background px-3 py-2">
                        <span className="text-xs font-medium text-muted-foreground">通知粉丝</span>
                        <Switch
                          checked={asBoolean(orchestrationParams.notify_followers, false)}
                          onCheckedChange={(checked) =>
                            updateOrchestrationParams({ notify_followers: checked })
                          }
                        />
                      </label>
                    </div>
                    <div className="space-y-2">
                      <label className="flex items-center justify-between gap-3 rounded-md border border-border bg-background px-3 py-2">
                        <span className="text-xs font-medium text-muted-foreground">
                          插入视频号视频
                        </span>
                        <Switch
                          checked={asBoolean(orchestrationParams.insert_video_channel, false)}
                          onCheckedChange={(checked) =>
                            updateOrchestrationParams({ insert_video_channel: checked })
                          }
                        />
                      </label>
                      {asBoolean(orchestrationParams.insert_video_channel, false) && (
                        <div className="grid gap-2 sm:grid-cols-2">
                          <Input
                            value={asString(orchestrationParams.video_channel_title)}
                            placeholder="视频标题"
                            onChange={(event) =>
                              updateOrchestrationParams({ video_channel_title: event.target.value })
                            }
                          />
                          <Input
                            value={asString(orchestrationParams.video_channel_keyword)}
                            placeholder="搜索关键词 / 视频ID"
                            onChange={(event) =>
                              updateOrchestrationParams({
                                video_channel_keyword: event.target.value,
                              })
                            }
                          />
                        </div>
                      )}
                      <FeatureBestEffortHint
                        visible={
                          asBoolean(orchestrationParams.insert_video_channel, false) &&
                          isUnsupportedFeature('wechat_channel_video')
                        }
                      />
                    </div>
                    <div className="space-y-2">
                      <label className="flex items-center justify-between gap-3 rounded-md border border-border bg-background px-3 py-2">
                        <span className="text-xs font-medium text-muted-foreground">插入投票</span>
                        <Switch
                          checked={asBoolean(orchestrationParams.insert_poll, false)}
                          onCheckedChange={(checked) =>
                            updateOrchestrationParams({ insert_poll: checked })
                          }
                        />
                      </label>
                      {asBoolean(orchestrationParams.insert_poll, false) && (
                        <div className="space-y-2">
                          <Input
                            value={asString(orchestrationParams.poll_question)}
                            placeholder="投票问题"
                            onChange={(event) =>
                              updateOrchestrationParams({ poll_question: event.target.value })
                            }
                          />
                          <div className="space-y-1.5">
                            <Label className="text-xs text-muted-foreground">投票选项</Label>
                            <Textarea
                              value={pollOptionsToText(orchestrationParams.poll_options)}
                              placeholder="每行一个选项"
                              rows={3}
                              onChange={(event) =>
                                updateOrchestrationParams({
                                  poll_options: textToPollOptions(event.target.value),
                                })
                              }
                            />
                          </div>
                          <label className="flex items-center justify-between gap-3 rounded-md border border-border bg-background px-3 py-2">
                            <span className="text-xs font-medium text-muted-foreground">
                              允许多选
                            </span>
                            <Switch
                              checked={asBoolean(orchestrationParams.poll_multi_select, false)}
                              onCheckedChange={(checked) =>
                                updateOrchestrationParams({ poll_multi_select: checked })
                              }
                            />
                          </label>
                        </div>
                      )}
                      <FeatureBestEffortHint
                        visible={
                          asBoolean(orchestrationParams.insert_poll, false) &&
                          isUnsupportedFeature('poll')
                        }
                      />
                    </div>
                  </div>
                )}
              </>
            }
          />
        </>
      )
    }
  )
)

export default WxGzhParams
