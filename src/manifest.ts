import type { ManifestV3 } from 'chrome-webstore-types'

const manifest: ManifestV3 = {
  manifest_version: 3,
  name: 'Read It – Reader',
  version: '0.0.1',
  description: 'Reads selected text aloud with keyboard-first accessible UI.',

  action: { default_popup: 'src/popup.html', default_title: 'Read It' },
  options_page: 'src/options.html',

  // Point to SOURCE code; CRXJS will rewrite to a loader in dist
  background: {
    service_worker: 'src/background/service-worker.ts',
    type: 'module',
  },

  icons: {
    '16': 'icon16.png',
    '48': 'icon48.png',
    '128': 'icon128.png',
  },

  permissions: ['storage', 'activeTab', 'scripting', 'contextMenus', 'offscreen'],
  host_permissions: ['<all_urls>'],

  commands: {
    'read-selection': {
      suggested_key: { default: 'Alt+Shift+R' },
      description: 'Read current selection',
    },
    // Added pause/resume/cancel keyboard shortcuts for quick control
    'pause-speech': {
      suggested_key: { default: 'Alt+Shift+P' },
      description: 'Pause reading',
    },
    'resume-speech': {
      suggested_key: { default: 'Alt+Shift+U' },
      description: 'Resume reading',
    },
    'cancel-speech': {
      suggested_key: { default: 'Alt+Shift+C' },
      description: 'Cancel/stop reading',
    },
  },

  // Remove web_accessible_resources unless you specifically need it
}

export default manifest
