import type { ForwardedRef } from 'react'
import type { Components } from 'react-markdown'
import { BookOpen, ImageOff } from 'lucide-react'
import { forwardRef, memo, useEffect, useRef } from 'react'
import { useTranslation } from 'react-i18next'
import ReactMarkdown from 'react-markdown'
import rehypeRaw from 'rehype-raw'
import remarkGfm from 'remark-gfm'
import { Navigation, Pagination } from 'swiper/modules'
import { Swiper, SwiperSlide } from 'swiper/react'
import { useShallow } from 'zustand/react/shallow'
import { isArticlePublishItem } from '@/components/PublishDialog/PublishDialog.util'
import { usePublishDialog } from '@/components/PublishDialog/usePublishDialog'
import 'swiper/css'
import 'swiper/css/pagination'

// 格式化文件大小
function formatFileSize(bytes: number): string {
  if (bytes === 0)
    return '0 Bytes'
  const k = 1024
  const sizes = ['Bytes', 'KB', 'MB', 'GB']
  const i = Math.floor(Math.log(bytes) / Math.log(k))
  return `${Number.parseFloat((bytes / k ** i).toFixed(2))} ${sizes[i]}`
}

// 格式化时长
function formatDuration(seconds: number): string {
  const hours = Math.floor(seconds / 3600)
  const minutes = Math.floor((seconds % 3600) / 60)
  const secs = Math.floor(seconds % 60)

  if (hours > 0) {
    return `${hours}:${minutes.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`
  }
  else {
    return `${minutes}:${secs.toString().padStart(2, '0')}`
  }
}

export interface IPublishDialogPreviewRef {}

export interface IPublishDialogPreviewProps {}

const articleMarkdownComponents: Components = {
  h1: ({ children }) => <h1 className="mb-4 text-2xl font-semibold leading-tight">{children}</h1>,
  h2: ({ children }) => <h2 className="mb-3 mt-6 text-xl font-semibold leading-snug">{children}</h2>,
  h3: ({ children }) => <h3 className="mb-2 mt-5 text-lg font-semibold leading-snug">{children}</h3>,
  p: ({ children }) => <p className="mb-3 leading-7 text-zinc-700">{children}</p>,
  ul: ({ children }) => <ul className="mb-3 list-disc space-y-1 pl-5 text-zinc-700">{children}</ul>,
  ol: ({ children }) => <ol className="mb-3 list-decimal space-y-1 pl-5 text-zinc-700">{children}</ol>,
  li: ({ children }) => <li className="leading-7">{children}</li>,
  blockquote: ({ children }) => (
    <blockquote className="mb-3 border-l-4 border-zinc-300 pl-3 text-zinc-600">{children}</blockquote>
  ),
  strong: ({ children }) => <strong className="font-semibold text-zinc-900">{children}</strong>,
  em: ({ children }) => <em className="text-zinc-700">{children}</em>,
  img: ({ src, alt }) => (
    <img src={src || ''} alt={alt || ''} className="my-4 w-full rounded-md object-contain" />
  ),
}

// 预览
const PublishDialogPreview = memo(
  forwardRef((_: IPublishDialogPreviewProps, ref: ForwardedRef<IPublishDialogPreviewRef>) => {
    const { t } = useTranslation('publish')
    const { expandedPubItem } = usePublishDialog(
      useShallow(state => ({
        expandedPubItem: state.expandedPubItem,
        pubList: state.pubList,
      })),
    )
    const videoRef = useRef<HTMLVideoElement>(null)

    useEffect(() => {
      if (!expandedPubItem) {
        videoRef.current?.pause()
      }
    }, [expandedPubItem])

    const isArticlePreview = expandedPubItem ? isArticlePublishItem(expandedPubItem) : false
    const articleHtml = expandedPubItem?.params.option.orchestration?.articleHtml
    const articleBody = (articleHtml || expandedPubItem?.params.des || '').trim()
    const articleTitle = expandedPubItem?.params.title || expandedPubItem?.params.option.wxGzh?.title || ''
    const hasPreviewContent = Boolean(
      expandedPubItem && (
        isArticlePreview
          ? (articleTitle || articleBody || expandedPubItem.params.images?.length)
          : (
              expandedPubItem.params.video
              || (expandedPubItem.params.images && expandedPubItem.params.images.length !== 0)
            )
      ),
    )

    return (
      <div className="bg-background w-[380px] overflow-hidden rounded-lg ml-[15px] h-[calc(100vh-80px)] flex flex-col">
        <div className="text-left min-w-[380px] flex flex-col h-full min-h-0">
          <div className="font-semibold text-base px-5 pt-5 flex-shrink-0">
            {t('preview.title')}
          </div>
          {hasPreviewContent && expandedPubItem ? (
            <div className="p-5 flex-1 min-h-0 flex flex-col">
              {isArticlePreview ? (
                <div className="h-full overflow-y-auto rounded-md border border-zinc-200 bg-white px-5 py-6 text-zinc-900 shadow-sm">
                  <div className="mb-4 flex items-center gap-2 text-xs font-medium text-zinc-500">
                    <BookOpen className="h-4 w-4" />
                    <span>文章</span>
                  </div>
                  {articleTitle && (
                    <h1 className="mb-5 text-2xl font-semibold leading-tight text-zinc-950">
                      {articleTitle}
                    </h1>
                  )}
                  <div className="text-sm">
                    <ReactMarkdown
                      remarkPlugins={[remarkGfm]}
                      rehypePlugins={[rehypeRaw]}
                      components={articleMarkdownComponents}
                    >
                      {articleBody}
                    </ReactMarkdown>
                  </div>
                  {(expandedPubItem.params.images?.length || 0) > 0 && (
                    <div className="mt-6 grid grid-cols-2 gap-2">
                      {expandedPubItem.params.images!.map((image, index) => (
                        <img
                          key={index + image.imgUrl}
                          src={image.imgUrl}
                          alt={`Article image ${index + 1}`}
                          className="aspect-video w-full rounded-md border border-zinc-100 object-cover"
                        />
                      ))}
                    </div>
                  )}
                </div>
              ) : expandedPubItem?.params.video ? (
                <div className="bg-black rounded-[30px] overflow-hidden box-border relative w-full flex-1 min-h-0 flex flex-col">
                  <div className="m-[5px] box-border flex-1 min-h-0 rounded-[30px] overflow-hidden flex flex-col">
                    <div className="absolute w-1/2 h-5 z-[8] rounded-b-[15px] top-0 left-1/2 -translate-x-1/2 bg-black" />
                    <div className="flex-1 min-h-0 flex items-center justify-center">
                      <video
                        ref={videoRef}
                        src={expandedPubItem.params.video?.videoUrl}
                        controls
                        poster={expandedPubItem.params.video?.cover?.imgUrl}
                        className="w-full max-h-full object-contain rounded-none"
                      />
                    </div>
                    {/* 视频信息显示 */}
                    <div className="bg-black/90 text-white p-3 rounded-b-[30px] text-xs border-t border-white/10 flex-shrink-0">
                      <div className="flex justify-between items-center mb-1">
                        <span className="font-semibold text-white/60 min-w-[60px] text-shadow">
                          {t('preview.videoInfo.filename' as any)}
                          :
                        </span>
                        <span className="text-white font-medium text-right flex-1 ml-2 text-shadow">
                          {expandedPubItem.params.video?.filename || 'Unknown'}
                        </span>
                      </div>
                      <div className="flex justify-between items-center mb-1">
                        <span className="font-semibold text-white/60 min-w-[60px] text-shadow">
                          {t('preview.videoInfo.format' as any)}
                          :
                        </span>
                        <span className="text-white font-medium text-right flex-1 ml-2 text-shadow">
                          {expandedPubItem.params.video?.filename
                            ?.split('.')
                            .pop()
                            ?.toUpperCase() || 'Unknown'}
                        </span>
                      </div>
                      <div className="flex justify-between items-center mb-1">
                        <span className="font-semibold text-white/60 min-w-[60px] text-shadow">
                          {t('preview.videoInfo.resolution' as any)}
                          :
                        </span>
                        <span className="text-white font-medium text-right flex-1 ml-2 text-shadow">
                          {expandedPubItem.params.video?.width
                            && expandedPubItem.params.video?.height
                            ? `${expandedPubItem.params.video.width}x${expandedPubItem.params.video.height}`
                            : 'Unknown'}
                        </span>
                      </div>
                      <div className="flex justify-between items-center mb-1">
                        <span className="font-semibold text-white/60 min-w-[60px] text-shadow">
                          {t('preview.videoInfo.size' as any)}
                          :
                        </span>
                        <span className="text-white font-medium text-right flex-1 ml-2 text-shadow">
                          {expandedPubItem.params.video?.size
                            ? formatFileSize(expandedPubItem.params.video.size)
                            : 'Unknown'}
                        </span>
                      </div>
                      <div className="flex justify-between items-center">
                        <span className="font-semibold text-white/60 min-w-[60px] text-shadow">
                          {t('preview.videoInfo.duration' as any)}
                          :
                        </span>
                        <span className="text-white font-medium text-right flex-1 ml-2 text-shadow">
                          {expandedPubItem.params.video?.duration
                            ? formatDuration(expandedPubItem.params.video.duration)
                            : 'Unknown'}
                        </span>
                      </div>
                    </div>
                  </div>
                </div>
              ) : (
                <div className="bg-black rounded-[30px] overflow-hidden box-border relative w-full flex-1 min-h-0 flex flex-col">
                  <div className="m-[5px] box-border flex-1 min-h-0 rounded-[30px] overflow-hidden flex flex-col justify-center">
                    <div className="absolute w-1/2 h-5 z-[8] rounded-b-[15px] top-0 left-1/2 -translate-x-1/2 bg-black" />
                    <div className="bg-white h-full box-border px-2.5 flex items-center [&_.swiper-pagination-bullet]:bg-primary [&_.swiper]:h-full [&_.swiper-slide]:h-full [&_img]:w-full [&_img]:h-full [&_img]:object-contain flex-1 min-h-0">
                      <Swiper
                        loop={(expandedPubItem!.params.images?.length || 0) > 1}
                        modules={[Navigation, Pagination]}
                        pagination={{
                          clickable: true,
                          el: '.swiper-pagination',
                        }}
                      >
                        {expandedPubItem!.params.images!.map((image, index) => (
                          <SwiperSlide key={index + image.imgUrl}>
                            <img src={image.imgUrl} alt={`Image ${index + 1}`} />
                          </SwiperSlide>
                        ))}
                      </Swiper>
                      <div className="swiper-pagination"></div>
                    </div>
                  </div>
                </div>
              )}
            </div>
          ) : (
            <div className="h-full flex items-center justify-center">
              <div className="flex flex-col items-center justify-center gap-3 text-muted-foreground">
                <ImageOff className="h-12 w-12 opacity-40" />
                <p className="text-sm">{t('preview.emptyDescription')}</p>
              </div>
            </div>
          )}
        </div>
      </div>
    )
  }),
)

export default PublishDialogPreview
