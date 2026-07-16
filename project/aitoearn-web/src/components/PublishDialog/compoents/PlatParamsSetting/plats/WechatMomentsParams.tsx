import type { ForwardedRef } from 'react'
import type {
  IPlatsParamsProps,
  IPlatsParamsRef,
} from '@/components/PublishDialog/compoents/PlatParamsSetting/plats/plats.type'
import { forwardRef, memo } from 'react'
import usePlatParamsCommon from '@/components/PublishDialog/compoents/PlatParamsSetting/hooks/usePlatParamsCoomon'
import PubParmasTextarea from '@/components/PublishDialog/compoents/PubParmasTextarea'
import { Input } from '@/components/ui/input'

function asString(value: unknown) {
  return typeof value === 'string' ? value : ''
}

const WechatMomentsParams = memo(
  forwardRef(
    (
      { pubItem, onImageToImage, isMobile }: IPlatsParamsProps,
      ref: ForwardedRef<IPlatsParamsRef>,
    ) => {
      const { pubParmasTextareaCommonParams, setOnePubParams } = usePlatParamsCommon(
        pubItem,
        onImageToImage,
        isMobile,
      )
      const orchestration = pubItem.params.option.orchestration ?? {}
      const orchestrationParams = (orchestration.params ?? {}) as Record<string, unknown>
      const showOrchestrationParams = pubItem.account.externalProvider === 'ai-orchestration'

      const updateOrchestrationParams = (patch: Record<string, unknown>) => {
        const nextParams = {
          ...orchestrationParams,
          ...patch,
        }
        setOnePubParams(
          {
            option: {
              ...pubItem.params.option,
              orchestration: {
                ...orchestration,
                publishTargetId: pubItem.account.externalId || pubItem.account.uid,
                contentType: orchestration.contentType || 'image_text',
                params: nextParams,
              },
            },
          },
          pubItem.account.id,
        )
      }

      return (
        <PubParmasTextarea
          {...pubParmasTextareaCommonParams}
          enableTopicMentions={false}
          extend={showOrchestrationParams && (
            <div className="mt-2.5 flex items-center gap-2">
              <div className="shrink-0 w-[90px] text-sm text-muted-foreground">可见标签</div>
              <Input
                value={asString(orchestrationParams.moments_visible_label)}
                placeholder="部分可见标签名"
                onChange={(event) => {
                  const label = event.target.value.trim()
                  updateOrchestrationParams({
                    moments_visible_label: label || undefined,
                    moments_visibility: label ? 'partial' : undefined,
                  })
                }}
              />
            </div>
          )}
        />
      )
    },
  ),
)

export default WechatMomentsParams
