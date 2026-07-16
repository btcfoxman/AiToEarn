import type {
  IPubParams,
  OrchestrationPublishContentType,
  PubItem,
} from '@/components/PublishDialog/publishDialog.type'
import {
  getPublishItemOrchestrationContentType,
  getPublishItemSupportedContentTypes,
} from '@/components/PublishDialog/PublishDialog.util'
import { cn } from '@/lib/utils'

const CONTENT_TYPE_LABELS: Record<OrchestrationPublishContentType, string> = {
  image_text: '图文',
  article: '文章',
  weitoutiao: '微头条',
}

interface OrchestrationContentTypeSelectorProps {
  pubItem: PubItem
  setOnePubParams: (params: Partial<IPubParams>, accountId: string) => void
}

export function OrchestrationContentTypeSelector({
  pubItem,
  setOnePubParams,
}: OrchestrationContentTypeSelectorProps) {
  if (pubItem.account.externalProvider !== 'ai-orchestration') {
    return null
  }

  const contentTypes = getPublishItemSupportedContentTypes(pubItem)
  if (contentTypes.length <= 1) {
    return null
  }

  const selectedContentType = getPublishItemOrchestrationContentType(pubItem)
  if (!selectedContentType) {
    return null
  }

  return (
    <div className="mt-2.5 flex flex-wrap items-center gap-2">
      <span className="text-xs font-medium text-muted-foreground">发布类型</span>
      <div className="flex flex-wrap gap-1.5">
        {contentTypes.map(contentType => (
          <button
            key={contentType}
            type="button"
            className={cn(
              'rounded-md border px-2.5 py-1 text-xs transition-colors',
              selectedContentType === contentType
                ? 'border-primary/40 bg-primary/10 text-foreground'
                : 'border-border bg-background text-muted-foreground hover:bg-muted',
            )}
            onClick={() => {
              setOnePubParams(
                {
                  option: {
                    ...pubItem.params.option,
                    orchestration: {
                      ...pubItem.params.option.orchestration,
                      publishTargetId: pubItem.account.externalId || pubItem.account.uid,
                      contentType,
                    },
                  },
                },
                pubItem.account.id,
              )
            }}
          >
            {CONTENT_TYPE_LABELS[contentType] ?? contentType}
          </button>
        ))}
      </div>
    </div>
  )
}
