/**
 * ConnectChannelList - 连接频道列表页
 * 显示所有可连接的平台，点击进入授权流程
 */

'use client'

import type { OrchestrationPublishTarget } from '@/api/plat/orchestration'
import { ArrowLeft, Info, Loader2, RefreshCw, Sparkles } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { toast } from 'sonner'
import { useShallow } from 'zustand/react/shallow'
import {
  apiGetOrchestrationPublishTargets,
  apiLinkOrchestrationTarget,
} from '@/api/plat/orchestration'
import { AccountPlatInfoArr, PlatType } from '@/app/config/platConfig'
import { useTransClient } from '@/app/i18n/client'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip'
import { useIsMobile } from '@/hooks/useIsMobile'
import { confirm } from '@/lib/confirm'
import { useAccountStore } from '@/store/account'
import { useUserStore } from '@/store/user'
import { navigateToLogin } from '@/utils/auth'
import { useChannelManagerStore } from '../channelManagerStore'

const PUBLISH_FEATURE_LABELS: Record<string, string> = {
  poll: '投票',
  wechat_channel_video: '视频号视频',
  video_channel: '视频号视频',
}

function normalizePublishFeatures(value: unknown) {
  const rawValues = Array.isArray(value)
    ? value
    : typeof value === 'string'
      ? value.split(/[,\s]+/)
      : []
  const result: string[] = []
  for (const item of rawValues) {
    const key = String(item ?? '').trim()
    if (key && !result.includes(key)) {
      result.push(key)
    }
  }
  return result
}

function getTargetPublishFeatures(target: OrchestrationPublishTarget) {
  const targetSnapshot = target.targetSnapshot as Record<string, unknown> | undefined
  const snapshotCapabilities = targetSnapshot?.capabilities as Record<string, unknown> | undefined
  const sources = [
    target.features,
    target.capabilities?.features,
    target.capabilities?.publishFeatures,
    target.capabilities?.publish_features,
    target.capabilities?.supportedFeatures,
    target.capabilities?.supported_features,
    targetSnapshot?.features,
    snapshotCapabilities?.features,
    snapshotCapabilities?.publishFeatures,
    snapshotCapabilities?.publish_features,
    snapshotCapabilities?.supportedFeatures,
    snapshotCapabilities?.supported_features,
  ]
  return [...new Set(sources.flatMap(normalizePublishFeatures))]
}

export function ConnectChannelList() {
  const { t } = useTransClient('account')
  const isMobile = useIsMobile()
  const [orchestrationPlatform, setOrchestrationPlatform] = useState<
    PlatType.WxGzh | PlatType.Toutiao | null
  >(null)
  const [publishTargets, setPublishTargets] = useState<OrchestrationPublishTarget[]>([])
  const [targetsLoading, setTargetsLoading] = useState(false)
  const [linkingTargetId, setLinkingTargetId] = useState<string | null>(null)

  const { isNewUser, setCurrentView, startAuth, targetSpaceId, setTargetSpaceId, closeModal } =
    useChannelManagerStore(
      useShallow((state) => ({
        isNewUser: state.isNewUser,
        setCurrentView: state.setCurrentView,
        startAuth: state.startAuth,
        targetSpaceId: state.targetSpaceId,
        setTargetSpaceId: state.setTargetSpaceId,
        closeModal: state.closeModal,
      }))
    )

  const { accountGroupList } = useAccountStore(
    useShallow((state) => ({
      accountGroupList: state.accountGroupList,
    }))
  )
  const refreshAccountList = useAccountStore((state) => state.getAccountList)

  const { token } = useUserStore(
    useShallow((state) => ({
      token: state.token,
    }))
  )

  // 返回主页
  const handleBack = () => {
    setCurrentView('main')
  }

  const orchestrationPlatformInfo = useMemo(() => {
    return orchestrationPlatform
      ? AccountPlatInfoArr.find(([key]) => key === orchestrationPlatform)?.[1]
      : null
  }, [orchestrationPlatform])

  const ensureTargetSpaceId = (): string | null => {
    let resolvedSpaceId = targetSpaceId
    if (!resolvedSpaceId) {
      const defaultSpace = accountGroupList.find((g) => g.isDefault)
      resolvedSpaceId = defaultSpace?.id || null
      if (resolvedSpaceId) {
        setTargetSpaceId(resolvedSpaceId)
      }
    }
    return resolvedSpaceId
  }

  const loadOrchestrationTargets = async (platform: PlatType.WxGzh | PlatType.Toutiao) => {
    setTargetsLoading(true)
    try {
      const res = await apiGetOrchestrationPublishTargets({ platform })
      if (res?.code === 0) {
        setPublishTargets(res.data ?? [])
      }
    } finally {
      setTargetsLoading(false)
    }
  }

  useEffect(() => {
    if (orchestrationPlatform) {
      loadOrchestrationTargets(orchestrationPlatform)
    } else {
      setPublishTargets([])
    }
  }, [orchestrationPlatform])

  const handleLinkOrchestrationTarget = async (target: OrchestrationPublishTarget) => {
    if (!orchestrationPlatform) {
      return
    }
    const spaceId = ensureTargetSpaceId()
    setLinkingTargetId(target.publishTargetId)
    try {
      const res = await apiLinkOrchestrationTarget({
        publishTargetId: target.publishTargetId,
        platform: orchestrationPlatform,
        groupId: spaceId || undefined,
      })
      if (res?.code === 0) {
        await refreshAccountList()
        toast.success('Linked orchestration publish target')
        setOrchestrationPlatform(null)
        setCurrentView('main')
      }
    } finally {
      setLinkingTargetId(null)
    }
  }

  const handleLegacyWxGzhAuth = async () => {
    const spaceId = ensureTargetSpaceId()
    setOrchestrationPlatform(null)
    const confirmed = await confirm({
      title: t('channelManager.wxGzhAuthNoticeTitle'),
      content: t('channelManager.wxGzhAuthNoticeContent'),
      okText: t('channelManager.continueAuth'),
    })

    if (confirmed) {
      startAuth(PlatType.WxGzh, spaceId || undefined)
    }
  }

  // 处理平台点击
  const handlePlatformClick = async (platform: PlatType) => {
    // 移动端点击小红书时显示提示
    if (isMobile && platform === PlatType.Xhs) {
      toast.warning(t('channelManager.xhsMobileNotSupported'))
      return
    }

    // 未登录时关闭频道弹框并跳转登录页
    if (!token) {
      closeModal()
      navigateToLogin()
      return
    }

    // 如果没有设置目标空间，使用默认空间
    const spaceId = ensureTargetSpaceId()
    if (platform === PlatType.WxGzh || platform === PlatType.Toutiao) {
      setOrchestrationPlatform(platform)
      return
    }

    // 开始授权流程
    startAuth(platform, spaceId || undefined)
  }

  return (
    <div className="flex h-full flex-col">
      {/* 头部 - 返回按钮 */}
      <div className="flex items-center gap-3 border-b px-4 py-3">
        <Button
          data-testid="cm-connect-back-btn"
          variant="ghost"
          size="sm"
          className="cursor-pointer"
          onClick={handleBack}
        >
          <ArrowLeft className="mr-1 h-4 w-4" />
          {t('channelManager.backToChannels')}
        </Button>
      </div>

      {/* 新用户提示 */}
      {isNewUser && (
        <div
          data-testid="cm-connect-new-user-tip"
          className="mx-4 mt-4 flex items-center gap-3 rounded-lg border bg-muted/30 p-4"
        >
          <Sparkles className="h-6 w-6 shrink-0 text-muted-foreground" />
          <p className="text-sm text-muted-foreground">{t('channelManager.newUserTip')}</p>
        </div>
      )}

      <Alert
        data-testid="cm-connect-multi-account-tip"
        role="note"
        className="mx-4 mt-4 w-auto border-border bg-muted/30 text-muted-foreground [&>svg]:text-muted-foreground"
      >
        <Info className="h-4 w-4" />
        <AlertDescription className="text-xs leading-relaxed sm:text-sm">
          {t('channelManager.connectNewChannelTip')}
        </AlertDescription>
      </Alert>

      {/* 平台网格 */}
      <ScrollArea className="flex-1 p-4">
        <div
          data-testid="cm-connect-list"
          className="
            grid w-full gap-2 sm:gap-3
            pt-3
            grid-cols-3
            sm:grid-cols-4
            md:grid-cols-5
            lg:grid-cols-6
          "
        >
          <TooltipProvider>
            {AccountPlatInfoArr.map(([key, value]) => {
              return (
                <Tooltip key={key}>
                  <TooltipTrigger asChild>
                    <Button
                      data-testid="cm-connect-platform-card"
                      variant="ghost"
                      className={`
                        group relative flex h-[90px] min-w-0
                        w-full cursor-pointer flex-col items-center
                        justify-center overflow-hidden whitespace-normal
                        rounded-lg border border-border bg-card
                        p-2 transition-all duration-200
                        hover:-translate-y-0.5 hover:border-foreground/30 hover:bg-accent
                        hover:shadow-md
                        active:translate-y-0 active:scale-[0.98]
                        sm:h-[100px] sm:rounded-xl sm:p-3
                        md:h-[110px]
                      `}
                      onClick={() => handlePlatformClick(key as PlatType)}
                    >
                      {/* 小红书浏览器插件标签 */}
                      {key === PlatType.Xhs && (
                        <span className="absolute -right-px -top-px z-20 rounded-bl rounded-tr-lg bg-muted px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground">
                          {t('channelManager.browserPlugin')}
                        </span>
                      )}

                      {/* 光泽效果 */}
                      <div className="absolute inset-0 -translate-x-full bg-gradient-to-r from-transparent via-white/40 to-transparent transition-transform duration-700 group-hover:translate-x-full" />

                      <div className="relative z-10 flex w-full flex-col items-center gap-1.5 sm:gap-2">
                        <img
                          src={value.icon}
                          className="
                            h-9 w-9 object-contain
                            drop-shadow-md filter transition-all
                            duration-300 group-hover:rotate-[5deg]
                            group-hover:scale-110
                            sm:h-10 sm:w-10
                            md:h-11 md:w-11
                          "
                          alt={value.name}
                        />
                        <span
                          className="
                            line-clamp-2 w-full text-center
                            text-[11px] font-medium leading-tight
                            text-foreground transition-all duration-300
                            group-hover:font-semibold
                            sm:text-xs
                          "
                        >
                          {value.name}
                        </span>
                      </div>
                    </Button>
                  </TooltipTrigger>
                  {value.tips?.account && (
                    <TooltipContent className="max-w-[200px] text-xs">
                      <p>{value.tips.account}</p>
                    </TooltipContent>
                  )}
                </Tooltip>
              )
            })}
          </TooltipProvider>
        </div>
      </ScrollArea>

      <Dialog
        open={!!orchestrationPlatform}
        onOpenChange={(open) => !open && setOrchestrationPlatform(null)}
      >
        <DialogContent className="sm:w-[min(720px,95vw)]">
          <DialogHeader>
            <DialogTitle>{orchestrationPlatformInfo?.name || orchestrationPlatform}</DialogTitle>
            <DialogDescription>
              Select a publish target managed by ai-orchestration.
            </DialogDescription>
          </DialogHeader>

          <div className="max-h-[420px] overflow-y-auto space-y-2">
            {targetsLoading ? (
              <div className="flex items-center justify-center gap-2 py-8 text-sm text-muted-foreground">
                <Loader2 className="h-4 w-4 animate-spin" />
                Loading targets
              </div>
            ) : publishTargets.length === 0 ? (
              <div className="rounded-lg border border-dashed p-6 text-sm text-muted-foreground">
                No orchestration publish targets found for this platform.
              </div>
            ) : (
              publishTargets.map((target) => {
                const contentTypes = target.contentTypes ?? target.capabilities?.contentTypes ?? []
                const features = getTargetPublishFeatures(target)
                return (
                  <div
                    key={target.publishTargetId}
                    className="flex flex-col gap-3 rounded-lg border border-border p-3 sm:flex-row sm:items-center"
                  >
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-sm font-medium text-foreground">
                        {target.accountName || target.nickname || target.publishTargetId}
                      </div>
                      <div className="mt-1 truncate font-mono text-xs text-muted-foreground">
                        {target.publishTargetId}
                      </div>
                      <div className="mt-2 flex flex-wrap gap-1.5">
                        {contentTypes.map((contentType) => (
                          <Badge key={contentType} variant="secondary" className="text-[11px]">
                            {contentType}
                          </Badge>
                        ))}
                        {features.map((feature) => (
                          <Badge
                            key={feature}
                            variant="outline"
                            className="text-[11px] text-emerald-700"
                          >
                            {PUBLISH_FEATURE_LABELS[feature] || feature}
                          </Badge>
                        ))}
                        {target.platform === PlatType.WxGzh && features.length === 0 && (
                          <Badge variant="outline" className="text-[11px] text-amber-600">
                            组件能力未声明
                          </Badge>
                        )}
                        {!target.ready && (
                          <Badge variant="outline" className="text-[11px] text-amber-600">
                            {target.reason || target.status || 'not_ready'}
                          </Badge>
                        )}
                      </div>
                    </div>
                    <Button
                      size="sm"
                      disabled={!target.ready || linkingTargetId === target.publishTargetId}
                      onClick={() => handleLinkOrchestrationTarget(target)}
                    >
                      {linkingTargetId === target.publishTargetId && (
                        <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
                      )}
                      Link
                    </Button>
                  </div>
                )
              })
            )}
          </div>

          <DialogFooter>
            {orchestrationPlatform === PlatType.WxGzh && (
              <Button variant="outline" onClick={handleLegacyWxGzhAuth}>
                Legacy OAuth
              </Button>
            )}
            {orchestrationPlatform && (
              <Button
                variant="outline"
                onClick={() => loadOrchestrationTargets(orchestrationPlatform)}
              >
                <RefreshCw className="mr-1.5 h-3.5 w-3.5" />
                Refresh
              </Button>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
