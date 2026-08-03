import { defineManifest } from '@crxjs/vite-plugin'

export default defineManifest({
  manifest_version: 3,
  minimum_chrome_version: '116',
  name: 'Read It – Reader',
  version: '0.0.1',
  description: 'Reads selected text aloud with keyboard-first accessible UI.',

  action: { default_popup: 'src/popup.html', default_title: 'Read It' },
  options_page: 'src/options.html',

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
  // The user may configure any HTTP(S) synthesis endpoint. Selection capture
  // itself remains user-invoked through activeTab; broad host access exists for
  // endpoint fetches and should become optional-host permission work before
  // Chrome Web Store publication.
  host_permissions: ['<all_urls>'],

  commands: {
    'read-selection': {
      suggested_key: { default: 'Alt+Shift+R' },
      description: 'Read current selection',
    },
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
})
