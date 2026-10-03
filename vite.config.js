import path from 'path'
import { fileURLToPath } from 'url'
import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { inworldDevProxyPlugin } from './vite-inworld-proxy.js'
import { deepgramDevProxyPlugin } from './vite-deepgram-proxy.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

// https://vite.dev/config/
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '')
  const inworldKey = String(env.VITE_INWORLD_API_KEY ?? '').trim()
  const deepgramKey = String(env.VITE_DEEPGRAM_API_KEY ?? '').trim()
  const deepgramModel = String(env.VITE_DEEPGRAM_MODEL ?? env.DEEPGRAM_MODEL ?? 'nova-3').trim()
  const deepgramLanguage = String(env.VITE_DEEPGRAM_LANGUAGE ?? env.DEEPGRAM_LANGUAGE ?? 'multi').trim()

  return {
    plugins: [
      react(),
      tailwindcss(),
      inworldDevProxyPlugin(inworldKey),
      deepgramDevProxyPlugin(deepgramKey, { model: deepgramModel, language: deepgramLanguage }),
    ],
    server: {
      proxy: {
        '/api/weather': {
          target: 'https://api.open-meteo.com',
          changeOrigin: true,
          rewrite: (path) => path.replace(/^\/api\/weather/, ''),
        },
      },
    },
    resolve: {
      alias: [
        {
          find: 'three/addons',
          replacement: path.resolve(__dirname, 'node_modules/three/examples/jsm'),
        },
        {
          find: 'three',
          replacement: path.resolve(__dirname, 'src/three-mindar-shim.js'),
        },
      ],
    },
  }
})
