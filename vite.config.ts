import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'
import { defineConfig } from 'vite'

// GitHub Pages serves project sites from /<repo>/ — the deploy workflow sets BASE_PATH=/<repo>/.
// Default './' (relative) works from any folder for other static hosts.
const base = process.env.BASE_PATH || './'

export default defineConfig({
  base,
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['favicon.png', 'icons/icon.svg', 'icons/apple-touch-icon.png'],
      manifest: {
        id: base,
        name: 'O2 Vibe Companion',
        short_name: 'O2 Vibe',
        description: 'Live blood oxygen and heart rate from your BodiMetrics O2 Vibe, plus easy-to-read overnight summaries.',
        theme_color: '#0e9f8e',
        background_color: '#f4f6fa',
        display: 'standalone',
        orientation: 'portrait',
        start_url: base,
        scope: base,
        categories: ['health', 'medical', 'lifestyle'],
        icons: [
          { src: 'icons/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
          { src: 'icons/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
          { src: 'icons/maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
      workbox: {
        globPatterns: ['**/*.{js,css,html,png,svg,webmanifest}'],
        navigateFallback: 'index.html',
      },
    }),
  ],
  preview: { host: '0.0.0.0', port: 4173 },
})
