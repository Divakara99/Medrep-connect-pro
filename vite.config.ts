import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { defineConfig, type Plugin } from 'vite'

// package.json is the single source of truth for the release version. It is
// injected as a compile-time constant so the UI (src/data/version.ts) always
// shows the shipped version without any hand-maintained duplicate.
const pkg = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8')) as {
  version: string
}
const projectRoot = fileURLToPath(new URL('.', import.meta.url))

const OCR_ASSETS = [
  { fileName: 'ocr/worker.min.js', source: 'node_modules/tesseract.js/dist/worker.min.js', contentType: 'text/javascript; charset=utf-8' },
  { fileName: 'ocr/tesseract-core-lstm.js', source: 'node_modules/tesseract.js-core/tesseract-core-lstm.js', contentType: 'text/javascript; charset=utf-8' },
  { fileName: 'ocr/tesseract-core-lstm.wasm', source: 'node_modules/tesseract.js-core/tesseract-core-lstm.wasm', contentType: 'application/wasm' },
  { fileName: 'ocr/4.0.0_best_int/eng.traineddata.gz', source: 'node_modules/@tesseract.js-data/eng/4.0.0_best_int/eng.traineddata.gz', contentType: 'application/gzip' },
]

function localOcrRuntimeAssets(): Plugin {
  return {
    name: 'local-vacancy-ocr-runtime-assets',
    configureServer(server) {
      server.middlewares.use((request, response, next) => {
        if (!request.url) return next()
        const pathname = new URL(request.url, 'http://vite.local').pathname
        const asset = OCR_ASSETS.find((item) => pathname.endsWith(`/${item.fileName}`))
        if (!asset) return next()
        try {
          const content = readFileSync(resolve(projectRoot, asset.source))
          response.statusCode = 200
          response.setHeader('Content-Type', asset.contentType)
          response.setHeader('Content-Length', content.byteLength)
          response.setHeader('Cache-Control', 'no-cache')
          response.end(content)
        } catch (cause) {
          next(cause instanceof Error ? cause : new Error('Could not serve local OCR assets.'))
        }
      })
    },
    generateBundle() {
      for (const asset of OCR_ASSETS) {
        this.emitFile({
          type: 'asset',
          fileName: asset.fileName,
          source: readFileSync(resolve(projectRoot, asset.source)),
        })
      }
    },
  }
}

export default defineConfig({
  // Relative base: the built app works from ANY host or sub-path
  // (Netlify/Vercel root, GitHub Pages project site, any folder on a server).
  base: './',
  plugins: [react(), tailwindcss(), localOcrRuntimeAssets()],
  define: {
    __APP_VERSION__: JSON.stringify(pkg.version),
  },
  server: {
    host: '0.0.0.0',
    port: 5173,
    allowedHosts: true,
  },
  preview: {
    host: '0.0.0.0',
    port: 4173,
    allowedHosts: true,
  },
})
