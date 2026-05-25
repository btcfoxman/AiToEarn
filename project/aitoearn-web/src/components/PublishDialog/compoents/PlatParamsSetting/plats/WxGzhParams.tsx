/**
 * WxGzhParams - 微信公众号平台参数设置
 * - 独立参数：title（与通用 title 区分，使用 option.wxGzh.title 保存）
 */
import type { ForwardedRef } from 'react'
import type {
  IPlatsParamsProps,
  IPlatsParamsRef,
} from '@/components/PublishDialog/compoents/PlatParamsSetting/plats/plats.type'
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
  return Array.isArray(value) ? value.map(item => String(item)).join('\n') : ''
}

function textToPollOptions(value: string) {
  return value.split(/\r?\n/).map(item => item.trim()).filter(Boolean)
}

const WxGzhParams = memo(
  forwardRef(
    (
      { pubItem, onImageToImage, isMobile }: IPlatsParamsProps,
      ref: ForwardedRef<IPlatsParamsRef>,
    ) => {
      const { t } = useTransClient('publish')
      const { pubParmasTextareaCommonParams, setOnePubParams } = usePlatParamsCommon(
        pubItem,
        onImageToImage,
        isMobile,
      )
      const orchestration = pubItem.params.option.orchestration ?? {}
      const orchestrationParams = (orchestration.params ?? {}) as Record<string, unknown>
      const updateOrchestrationParams = (patch: Record<string, unknown>) => {
        setOnePubParams({
          option: {
            ...pubItem.params.option,
            orchestration: {
              ...orchestration,
              publishTargetId: pubItem.account.externalId || pubItem.account.uid,
              params: {
                ...orchestrationParams,
                ...patch,
              },
            },
          },
        }, pubItem.account.id)
      }
      const showOrchestrationParams = pubItem.account.externalProvider === 'ai-orchestration'

      return (
        <>
          <PubParmasTextarea
            {...pubParmasTextareaCommonParams}
            extend={(
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
                <OrchestrationContentTypeSelector pubItem={pubItem} setOnePubParams={setOnePubParams} />
                {showOrchestrationParams && (
                  <div className="mt-3 space-y-3 rounded-md border border-border bg-muted/20 p-3">
                    <div className="grid gap-3 sm:grid-cols-2">
                      <label className="flex items-center justify-between gap-3 rounded-md border border-border bg-background px-3 py-2">
                        <span className="text-xs font-medium text-muted-foreground">Original</span>
                        <Switch
                          checked={asBoolean(orchestrationParams.original, true)}
                          onCheckedChange={checked => updateOrchestrationParams({ original: checked })}
                        />
                      </label>
                      <label className="flex items-center justify-between gap-3 rounded-md border border-border bg-background px-3 py-2">
                        <span className="text-xs font-medium text-muted-foreground">Notify Followers</span>
                        <Switch
                          checked={asBoolean(orchestrationParams.notify_followers, false)}
                          onCheckedChange={checked => updateOrchestrationParams({ notify_followers: checked })}
                        />
                      </label>
                    </div>
                    <div className="space-y-2">
                      <label className="flex items-center justify-between gap-3 rounded-md border border-border bg-background px-3 py-2">
                        <span className="text-xs font-medium text-muted-foreground">Video Channel</span>
                        <Switch
                          checked={asBoolean(orchestrationParams.insert_video_channel, false)}
                          onCheckedChange={checked => updateOrchestrationParams({ insert_video_channel: checked })}
                        />
                      </label>
                      {asBoolean(orchestrationParams.insert_video_channel, false) && (
                        <div className="grid gap-2 sm:grid-cols-2">
                          <Input
                            value={asString(orchestrationParams.video_channel_title)}
                            placeholder="Video title"
                            onChange={event => updateOrchestrationParams({ video_channel_title: event.target.value })}
                          />
                          <Input
                            value={asString(orchestrationParams.video_channel_keyword)}
                            placeholder="Search keyword"
                            onChange={event => updateOrchestrationParams({ video_channel_keyword: event.target.value })}
                          />
                        </div>
                      )}
                    </div>
                    <div className="space-y-2">
                      <label className="flex items-center justify-between gap-3 rounded-md border border-border bg-background px-3 py-2">
                        <span className="text-xs font-medium text-muted-foreground">Poll</span>
                        <Switch
                          checked={asBoolean(orchestrationParams.insert_poll, false)}
                          onCheckedChange={checked => updateOrchestrationParams({ insert_poll: checked })}
                        />
                      </label>
                      {asBoolean(orchestrationParams.insert_poll, false) && (
                        <div className="space-y-2">
                          <Input
                            value={asString(orchestrationParams.poll_question)}
                            placeholder="Poll question"
                            onChange={event => updateOrchestrationParams({ poll_question: event.target.value })}
                          />
                          <div className="space-y-1.5">
                            <Label className="text-xs text-muted-foreground">Poll options</Label>
                            <Textarea
                              value={pollOptionsToText(orchestrationParams.poll_options)}
                              placeholder="One option per line"
                              rows={3}
                              onChange={event => updateOrchestrationParams({ poll_options: textToPollOptions(event.target.value) })}
                            />
                          </div>
                          <label className="flex items-center justify-between gap-3 rounded-md border border-border bg-background px-3 py-2">
                            <span className="text-xs font-medium text-muted-foreground">Multi Select</span>
                            <Switch
                              checked={asBoolean(orchestrationParams.poll_multi_select, false)}
                              onCheckedChange={checked => updateOrchestrationParams({ poll_multi_select: checked })}
                            />
                          </label>
                        </div>
                      )}
                    </div>
                  </div>
                )}
              </>
            )}
          />
        </>
      )
    },
  ),
)

export default WxGzhParams
