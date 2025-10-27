# Read It — Chrome extension (React + TypeScript + Vite)

This repository contains "Read It", a small Chrome extension built with React + TypeScript and Vite. The extension provides a keyboard-first, accessible UI to read selected text aloud using the browser's Web Speech API.

This README documents what the extension does, how it's implemented, current project state, how to build & load it locally, and next recommended steps.

## What the extension does

- Reads the currently selected text aloud using the browser's Speech Synthesis (Web Speech API).
- Keyboard shortcut support: Alt+Shift+R (configured as the `read-selection` command).
- Context menu entry: "Read selection aloud" for selection contexts.
- Popup UI (React) with controls to manually trigger reading and to set voice & rate.
- Options page (React) for persistent voice and rate settings saved in `chrome.storage.sync`.
- Background service worker manages commands and context menu clicks, and injects a small page-level handler when necessary so speech runs in the page context (required for the Web Speech API in some cases).

## High-level architecture

- `src/manifest.ts` — MV3 manifest (TypeScript). Uses source paths; CRX/Vite plugin rewrites for distribution.
- `src/background/service-worker.ts` — Background service worker (MV3). Handles keyboard command, context menu, and injection fallback.
- `src/content/content.ts` — Content script that listens for messages to speak selection or arbitrary text. Runs in the content script world and uses page `speechSynthesis` when available.
- `src/lib/messaging.ts` — Shared message types and helpers.
- `src/lib/storage.ts` — Small storage wrapper for getting/saving voice and rate settings via `chrome.storage.sync`.
- `src/popup/Popup.tsx` — React popup UI allowing the user to trigger reading and configure voice/rate for the current browser.
- `src/options/Options.tsx` — React options page that persists settings.

Key implementation notes:
- The extension prefers to run speech in the page's MAIN world to avoid limitations of service workers or isolated script contexts. The background worker attempts to send a message to the tab; if no content script is present, it injects a small handler into the page (via `chrome.scripting.executeScript`) and then re-sends the message.
- Settings are stored under `settings` in `chrome.storage.sync` and default rate is `1.0`.

## Files of interest

- `src/manifest.ts` — manifest settings (permissions include `storage`, `activeTab`, `scripting`, `contextMenus`; `host_permissions` currently set to `<all_urls>`).
- `src/background/service-worker.ts` — command and context menu logic plus injection fallback.
- `src/content/content.ts` — message listener and `speak()` implementation.
- `src/popup/Popup.tsx` and `src/options/Options.tsx` — React UIs for quick controls and persistent options.

## Current project status (as of this review)

- Core functionality: Implemented and wired up. The extension supports reading selection, keyboard shortcut, context menu, popup and options, and stores settings in `chrome.storage.sync`.
- Build system: Vite with `@crxjs/vite-plugin` is present in `package.json`. Source `manifest.ts` uses source paths — CRX plugin rewrites on build.
- UI: Popup and Options implemented in React/TypeScript.
- Types: `@types/chrome` has been added and the codebase was updated to remove local `chrome` shims and use proper Chrome typings.
- Tests: Unit tests were added (Vitest) for message guards, storage helpers, and background messaging/injection behavior. Tests run locally with `npx vitest --run` and currently pass.
- CI: A GitHub Actions workflow was added (`.github/workflows/ci.yml`) that runs a lint job (`npm run lint`), tests (`npx vitest --run`), and a production build (`npm run build`) on push and PR.
- Important fixes done: popup now routes read requests through the background (so injection fallback is used), and the background injection fallback was rewritten to inject a one-off page script (reads selection or provided text) instead of attempting to register `chrome.runtime` in page context.
- Icons: `manifest.ts` references `icon16.png`, `icon48.png`, `icon128.png` — confirm these exist in `public/` or the build output before publishing.
- Permissions: `host_permissions` are still set to `<all_urls>` which is broad — consider narrowing the host list or moving hosts to `optional_permissions` if you plan to publish.

Known quirks / things to watch

- speechSynthesis.getVoices() may be populated asynchronously in some browsers. The popup/options handle this by listening to `voiceschanged`, but user machines may still see a race.
- Background service workers cannot access window-level APIs; this repo correctly injects a page script when needed. This is intentional and required for reliable TTS.
- Popup directly sends `chrome.tabs.sendMessage` to the active tab. If the content script has not yet been injected on that page, the background injection path will still handle the keyboard shortcut or context menu, but the popup's one-shot may fail silently unless the content script is present. You may want to route popup actions through the background for a consistent injection fallback.

## How to build and load locally

Install dependencies:

```bash
npm install
```

Development (hot-reload for UI-only parts):

```bash
npm run dev
```

Build for distribution:

```bash
npm run build
```

After a build, load the extension into Chrome/Edge via `chrome://extensions` → "Load unpacked" and point to the build output directory (commonly `dist/` when using `@crxjs/vite-plugin`). If you are using a custom build output path, point to that instead.

Manual testing tips

- Select text on any page and use Alt+Shift+R to trigger reading.
- Right-click selection -> "Read selection aloud".
- Open the popup to change Rate / Voice and try reading again.

## Recommendations / next steps

Below are remaining recommended improvements, prioritized by impact.

1. Options mount/save race (HIGH): fix `src/options/Options.tsx` so it doesn't persist default values on mount before stored settings are loaded. Persist only after an initial load completes or require an explicit Save action.
2. Permissions audit (HIGH for publishing): review `host_permissions` and either narrow the match patterns or switch to `optional_permissions` and programmatic injection where possible. I can propose specific host lists if you want.
3. Icons & packaging (MEDIUM): confirm icon assets are present and add a CI validation step that verifies assets listed in the manifest exist in the build output.
4. Additional tests & coverage (MEDIUM): extend tests to cover more background paths (e.g., executeScript failure), and add integration/e2e tests (Playwright with Chrome extension loading) before publishing.
5. UX polish (LOW): show popup feedback (e.g., "No selection", "Reading…", voice unavailable) and improve voice-list handling to reduce race conditions.
6. Docs & release readiness (LOW): add a short publishing guide (Chrome Web Store packaging, keys, and a CHANGELOG).

## Quick contact / contributor notes

If you'd like, I can open a PR that:
- Fixes the Options mount/save race so stored settings are not overwritten on load.
- Proposes a narrowed `host_permissions` and (optionally) converts broad hosts to `optional_permissions` (ask-first change).
- Adds CI validations for manifest assets and a short publishing checklist.

---

This file was updated after a brief code review of the repository files to summarize functionality and current state.

## Quick prompt to continue work with the assistant

When you're ready to resume work with the assistant, paste the exact prompt below (you can edit details like branch name or which tasks to prioritise):

"Resume Read It work — context: I have the repo at commit <COMMIT_HASH> (or branch <BRANCH_NAME>). Current status: README, memory.md, and RESUME_CHECKLIST.md present; unit tests pass with `npx vitest --run`. Tasks to continue (pick or edit):

- Fix Options mount/save race in `src/options/Options.tsx` so defaults are not persisted before stored settings are loaded (HIGH priority).
- Propose narrowed `host_permissions` for `src/manifest.ts` and optionally convert to `optional_permissions` (ask-first; list hosts to include: <HOST_LIST>).
- Add a CI validation step to confirm icons referenced in `manifest.ts` exist in the build output (optional).

Commands to run locally:
```
git checkout <BRANCH_NAME>
git pull
npm install
npx vitest --run
npm run dev   # optional: start UI dev server
```

Notes:
- If you changed anything, commit WIP changes before asking the assistant to continue: `git add . && git commit -m "WIP: checkpoint" && git push`.
- If you want the assistant to open a PR, include the target branch and a short description.

When you paste this prompt, replace the placeholders (`<COMMIT_HASH>`, `<BRANCH_NAME>`, `<HOST_LIST>`) and tell the assistant which of the listed tasks to do first."


