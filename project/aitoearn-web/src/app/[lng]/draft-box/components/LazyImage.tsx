/**
 * 懒加载图片组件
 * 封装 Next.js Image 组件，提供加载状态骨架屏和淡入动画效果
 */

'use client'

import type { ImageProps } from 'next/image'
import { ImageIcon } from 'lucide-react'
import Image from 'next/image'
import { memo, useState } from 'react'
import { Skeleton } from '@/components/ui/skeleton'
import { cn } from '@/lib/utils'

interface LazyImageProps extends Omit<ImageProps, 'onLoad'> {
  /** 骨架屏的额外类名 */
  skeletonClassName?: string
  /** 容器的额外类名 */
  containerClassName?: string
  /** 占位高度，用于图片加载前显示骨架屏 */
  placeholderHeight?: number | string
}

export const LazyImage = memo(({
  src,
  alt,
  className,
  skeletonClassName,
  containerClassName,
  placeholderHeight,
  ...props
}: LazyImageProps) => {
  const [loaded, setLoaded] = useState(false)
  const [error, setError] = useState(false)
  const hasRenderableSrc = typeof src !== 'string' || src.trim().length > 0
  const showFallback = error || !hasRenderableSrc

  const handleLoad = () => {
    setLoaded(prev => prev || true)
  }

  const handleError = () => {
    setError(prev => prev || true)
    setLoaded(prev => prev || true)
  }

  const fallbackStyle = placeholderHeight ? { minHeight: placeholderHeight } : undefined

  return (
    <div
      className={cn('relative', containerClassName)}
      style={!loaded && placeholderHeight ? { minHeight: placeholderHeight } : undefined}
    >
      {/* 骨架屏 */}
      {!loaded && (
        <Skeleton
          className={cn(
            'absolute inset-0 w-full h-full',
            skeletonClassName,
          )}
        />
      )}

      {/* 图片 */}
      {showFallback
        ? (
            <div
              role="img"
              aria-label={typeof alt === 'string' ? alt : undefined}
              className={cn(
                'flex w-full items-center justify-center rounded-xl border border-border bg-muted text-muted-foreground',
                className,
              )}
              style={fallbackStyle}
            >
              <ImageIcon className="h-8 w-8 opacity-60" />
            </div>
          )
        : (
            <Image
              src={src}
              alt={alt}
              className={cn(
                'transition-opacity duration-300',
                loaded ? 'opacity-100' : 'opacity-0',
                className,
              )}
              onLoad={handleLoad}
              onError={handleError}
              {...props}
            />
          )}
    </div>
  )
})

LazyImage.displayName = 'LazyImage'
