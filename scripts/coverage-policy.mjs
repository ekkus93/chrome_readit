export const productionCoverageInclude = ['src/**/*.{ts,tsx}']

export const approvedCoverageExclusions = [
  {
    path: 'src/manifest.ts',
    reason: 'Declarative Chrome manifest configuration; the production build and manifest contract checks validate the emitted manifest.',
  },
  {
    path: 'src/options/main.tsx',
    reason: 'React bootstrap only; Options component behavior is measured in src/options/Options.tsx.',
  },
]

export const productionCoverageExclude = [
  '**/*.test.ts',
  '**/*.test.tsx',
  'src/**/*.d.ts',
  ...approvedCoverageExclusions.map(({ path }) => path),
]

export const globalCoverageThresholds = {
  statements: 85,
  branches: 75,
  functions: 85,
  lines: 85,
}

export const criticalFileCoverageThresholds = {
  'src/offscreen/playback-coordinator.ts': { lines: 90, branches: 85 },
  'src/background/service-worker.ts': { lines: 85, branches: 80 },
  'src/offscreen.ts': { lines: 85, branches: 80 },
  'src/lib/tts-client.ts': { lines: 95, branches: 90 },
  'src/lib/storage.ts': { lines: 95, branches: 90 },
  'src/lib/voices.ts': { lines: 95, branches: 90 },
  'src/lib/playback-runtime-client.ts': { lines: 90, branches: 85 },
  'src/popup/Popup.tsx': { lines: 85, branches: 75 },
  'src/options/Options.tsx': { lines: 85, branches: 75 },
}
