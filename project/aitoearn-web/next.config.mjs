import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

/** @type {import('next').NextConfig} */
const nextConfig = {
  images: {
    unoptimized: true,
  },
  webpack(config) {
    config.module.rules.push({
      test: /\.svg$/,
      use: ['@svgr/webpack'],
      exclude: path.resolve(__dirname, 'src/assets/svgs/plat'),
    })

    config.module.rules.push({
      test: /\.svg$/,
      include: path.resolve(__dirname, 'src/assets/svgs/plat'),
      type: 'asset/resource',
    })

    return config
  },
  reactStrictMode: false,
  experimental: {
    forceSwcTransforms: true,
    outputFileTracingRoot: undefined,
  },
  output: 'standalone', // Temporarily disabled to avoid symlink issues on Windows
  productionBrowserSourceMaps: process.env.NEXT_PUBLIC_EVN === 'dev',
  rewrites: async () => {
    const rewrites = []
    const isDev = process.env.NODE_ENV === 'development'
    const apiProxyUrl = process.env.API_PROXY_URL || (isDev ? 'http://127.0.0.1:3002' : '')
    const aiApiProxyUrl = process.env.AI_API_PROXY_URL || (isDev ? 'http://127.0.0.1:3010' : '')

    if (aiApiProxyUrl) {
      rewrites.push({
        source: '/api/ai/:path*',
        destination: `${aiApiProxyUrl}/ai/:path*`,
      })
      rewrites.push({
        source: '/api/agent/:path*',
        destination: `${aiApiProxyUrl}/agent/:path*`,
      })
    }

    if (apiProxyUrl) {
      rewrites.push({
        source: '/api/:path*',
        destination: `${apiProxyUrl}/:path*`,
      })
    }
    return rewrites
  },
}

const CorsHeaders = [
  { key: 'Access-Control-Allow-Credentials', value: 'true' },
  { key: 'Access-Control-Allow-Origin', value: '*' },
  {
    key: 'Access-Control-Allow-Methods',
    value: '*',
  },
  {
    key: 'Access-Control-Allow-Headers',
    value: '*',
  },
  {
    key: 'Access-Control-Max-Age',
    value: '86400',
  },
]

nextConfig.headers = async () => {
  return [
    {
      source: '/api/:path*',
      headers: CorsHeaders,
    },
    {
      // 为所有页面添加 SEO 相关的 headers
      source: '/:path*',
      headers: [
        {
          key: 'Content-Signal',
          value: 'search=yes, ai-train=yes', // 注意：逗号后面有空格，这是正确的语法
        },
      ],
    },
  ]
}

export default nextConfig
