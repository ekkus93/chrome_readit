import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { crx } from '@crxjs/vite-plugin'
import manifest from './src/manifest'
import { resolve } from 'node:path'

export default defineConfig({
  plugins: [react(), crx({ manifest })],
  build: {
    target: 'es2022',
    rollupOptions: {
      input: {
        offscreen: resolve(__dirname, 'src/offscreen.html'),
      },
    },
  },
})
