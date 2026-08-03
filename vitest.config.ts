import react from '@vitejs/plugin-react'
import { defineConfig } from 'vitest/config'

export default defineConfig({
  plugins: [react()],
  test: {
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html'],
      include: [
        'src/lib/playback-protocol.ts',
        'src/lib/text-normalization.ts',
        'src/lib/text-segmentation.ts',
        'src/lib/chunk-packing.ts',
        'src/lib/playback-pacing.ts',
        'src/offscreen/playback-coordinator.ts',
      ],
      exclude: [
        '**/*.test.ts',
        '**/*.test.tsx',
      ],
    },
  },
})
