import react from '@vitejs/plugin-react'
import { defineConfig } from 'vitest/config'
import {
  productionCoverageExclude,
  productionCoverageInclude,
} from './scripts/coverage-policy.mjs'

export default defineConfig({
  plugins: [react()],
  test: {
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html'],
      all: true,
      include: productionCoverageInclude,
      exclude: productionCoverageExclude,
    },
  },
})
