import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'

// GitHub Pages 项目站：默认 base=/ops/，构建输出到 docs/
const base = process.env.VITE_BASE || '/ops/'

// https://vitejs.dev/config/
export default defineConfig({
  base,
  publicDir: 'assets',
  build: {
    outDir: 'docs',
    emptyOutDir: true,
  },
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['icons/icon-192.png', 'icons/icon-512.png', 'favicon.svg'],
      manifest: {
        name: 'Personal Ops',
        short_name: 'Ops',
        description: '个人 AI 工作台 + GitHub 知识库入口 + 任务看板',
        theme_color: '#1a1a2e',
        background_color: '#1a1a2e',
        display: 'standalone',
        orientation: 'portrait',
        scope: base,
        start_url: base,
        lang: 'zh-CN',
        categories: ['productivity', 'business'],
        icons: [
          {
            src: 'icons/icon-192.png',
            sizes: '192x192',
            type: 'image/png',
            purpose: 'any'
          },
          {
            src: 'icons/icon-192.png',
            sizes: '192x192',
            type: 'image/png',
            purpose: 'maskable'
          },
          {
            src: 'icons/icon-512.png',
            sizes: '512x512',
            type: 'image/png',
            purpose: 'any'
          },
          {
            src: 'icons/icon-512.png',
            sizes: '512x512',
            type: 'image/png',
            purpose: 'maskable'
          }
        ]
      },
      workbox: {
        globPatterns: ['**/*.{js,css,html,ico,png,svg,woff2}'],
        runtimeCaching: [
          {
            urlPattern: /^https:\/\/api\.github\.com\/.*/i,
            handler: 'NetworkFirst',
            options: {
              cacheName: 'github-api-cache',
              expiration: {
                maxEntries: 50,
                maxAgeSeconds: 60 * 5 // 5 分钟
              },
              cacheableResponse: {
                statuses: [0, 200]
              }
            }
          },
          {
            urlPattern: /^https:\/\/raw\.githubusercontent\.com\/.*/i,
            handler: 'NetworkFirst',
            options: {
              cacheName: 'github-content-cache',
              expiration: {
                maxEntries: 100,
                maxAgeSeconds: 60 * 10 // 10 分钟
              },
              cacheableResponse: {
                statuses: [0, 200]
              }
            }
          }
        ]
      }
    })
  ],
  server: {
    host: true,
    port: 5173,
    proxy: {
      // 开发态代理 GitHub OAuth（Device Flow），避免浏览器 CORS
      '/gh-oauth': {
        target: 'https://github.com',
        changeOrigin: true,
        rewrite: (p) => p.replace(/^\/gh-oauth/, ''),
      },
      // 本机 Token 监测代理（npm run agent）
      '/token-agent': {
        target: 'http://127.0.0.1:3847',
        changeOrigin: true,
        rewrite: (p) => p.replace(/^\/token-agent/, ''),
      },
    },
  },
  preview: {
    host: true,
    port: 3000
  }
})
