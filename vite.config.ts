import { defineConfig } from 'vite'
import type { PluginOption } from 'vite'
import react from '@vitejs/plugin-react'
import manifest from './src/manifest'

// Avoid importing '@crxjs/vite-plugin' at module-evaluation time because
// some environments (CI runners) load transitive deps (undici) that expect
// browser globals such as `File`. Polyfill `File` synchronously, then
// require the plugin synchronously so Vite receives a plain sync config.

// Minimal File polyfill for Node environments that lack it (safe no-op
// replacement for the purposes of the build-time plugin usage).
const g = globalThis as unknown as { File?: unknown }
if (typeof g.File === 'undefined') {
  ;(g as { File?: unknown }).File = class File {
    constructor(_parts?: unknown[], _name?: string, _opts?: Record<string, unknown> | undefined) {
      void _parts
      void _name
      void _opts
    }
  }
}

let crxPlugin: unknown = undefined
try {
  // Use createRequire to synchronously load the plugin in an ESM environment
  // without triggering top-level ESM import resolution earlier than desired.
  const { createRequire } = await import('module')
  const req = createRequire(import.meta.url)
  const mod = req('@crxjs/vite-plugin')
  crxPlugin = mod.crx
} catch (err) {
  // If dynamic require fails (CI environment lacking the package), continue
  // without the plugin — build will surface the issue later if necessary.
  console.warn('Could not require @crxjs/vite-plugin:', err)
}

const plugins: PluginOption[] = [react() as PluginOption]
if (crxPlugin) {
  const factory = crxPlugin as unknown as (opts: unknown) => PluginOption
  const p = factory({ manifest })
  plugins.push(p)
}

export default defineConfig({
  plugins,
  build: { target: 'es2022' },
})
