import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import manifest from './src/manifest'

// Avoid importing '@crxjs/vite-plugin' at module-evaluation time because
// some environments (CI runners) load transitive deps (undici) that expect
// browser globals such as `File`. Loading the plugin dynamically after a
// small polyfill prevents a ReferenceError (`File is not defined`).
export default defineConfig(async () => {
  // Minimal File polyfill for Node environments that lack it (safe no-op
  // replacement for the purposes of the build-time plugin usage).
  if (typeof (globalThis as any).File === 'undefined') {
    ;(globalThis as any).File = class File {
      constructor(_parts?: any[], _name?: string, _opts?: any) {}
    }
  }

  let crxPlugin
  try {
    const mod = await import('@crxjs/vite-plugin')
    crxPlugin = mod.crx
  } catch (err) {
    // If dynamic import fails (rare), proceed without the plugin. This keeps
    // local dev and CI runs runnable; missing plugin will be noticed at build.
    // eslint-disable-next-line no-console
    console.warn('Could not load @crxjs/vite-plugin dynamically:', err)
  }

  const plugins: any[] = [react()]
  if (crxPlugin) plugins.push(crxPlugin({ manifest }))

  return {
    plugins,
    build: { target: 'es2022' },
  }
})
