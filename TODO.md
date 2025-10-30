#TODO

## Current project status (updated October 29, 2025)

- **Core functionality: Fully implemented and working!** The extension supports reading selection via keyboard shortcut, context menu, popup, and options page using a local Coqui TTS Docker server with 109 voices.
- **Recent major improvements:**
  - ✅ Upgraded from browser Web Speech API to Coqui TTS VITS multi-speaker model
  - ✅ Added 109 high-quality voices (previously only 1 voice)
  - ✅ Implemented reliable Docker-based TTS server with FastAPI endpoints
  - ✅ Fixed all TTS entry points: Options "Test Speech", popup input, keyboard shortcut (Alt+Shift+R), context menu "Read selection aloud"
  - ✅ Added comprehensive debug logging for troubleshooting
  - ✅ Implemented base64 audio transfer for consistent cross-context messaging
- **Build system:** Vite with `@crxjs/vite-plugin` remains in use. The CI workflow builds the project and checks the `dist/` output.
- **UI:** Popup and Options implemented in React/TypeScript with proper settings persistence.
- **Types:** `@types/chrome` is present and code uses proper Chrome typings.
- **Icons & packaging:** Manifest references `icon16.png`, `icon48.png`, `icon128.png` and CI validates these exist in `dist/` after build.
- **Permissions:** Currently uses `host_permissions: ['<all_urls>']` for broad web page access (recorded in memory.md). This enables TTS on any website but could be narrowed for production use.

## What still needs to be done (recommended next steps)

1. Permissions audit (HIGH — ask-first): If you want to narrow `host_permissions` we can:
	 - Replace `<all_urls>` with a smaller set (e.g. `['http://*/*','https://*/*']`) or
	 - Move broad hosts to `optional_permissions` and request them at runtime when needed.
2. Additional tests & coverage (MEDIUM): Some unit coverage has been added (background error-paths). Remaining work: add more background-path tests (e.g. injection success/failure edge cases) and consider integration/e2e tests (Playwright) that load the unpacked extension into a Chromium instance.
3. CI improvements (MEDIUM): Parse the built `dist/manifest.json` after `npm run build` to discover any referenced assets (icons, web_accessible_resources) instead of hardcoding icon names. Consider adding Vitest coverage reports and gating thresholds.
4. UX polish (LOW): Improve popup feedback (e.g., "No selection", "Reading…", handle voice-list race conditions) and consider an explicit "Save" action on the Options page if preferred.
5. Docs & release readiness (LOW): Add a short publishing guide (Chrome Web Store packaging, keys, CHANGELOG) and confirm icon assets exist for all platforms.
