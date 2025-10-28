# Read It — Chrome extension (React + TypeScript + Vite)

[![CI](https://github.com/ekkus93/chrome_readit/actions/workflows/ci.yml/badge.svg?branch=master)](https://github.com/ekkus93/chrome_readit/actions/workflows/ci.yml)

[![Coverage](https://codecov.io/gh/ekkus93/chrome_readit/branch/master/graph/badge.svg)](https://codecov.io/gh/ekkus93/chrome_readit)

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

## Current project status (updated)

- Core functionality: Implemented and wired up. The extension supports reading selection, keyboard shortcut, context menu, popup and options, and stores settings in `chrome.storage.sync`.
- Fixes completed since the prior review:
	- Fixed Options mount/save race so default settings are not persisted on mount before stored settings are loaded.
	- Added a CI workflow (`.github/workflows/ci.yml`) that runs lint, tests, build, and validates the extension icons are present in the final `dist/` build output.
	- Addressed lint failures by removing explicit `any` usages in key tests and `lib/messaging.ts`, replacing `@ts-ignore` uses with typed mocks, and removing an unused catch binding in the background service worker.
	- All unit tests pass locally (run with `npx vitest --run`) — current run: 13 tests across 3 files (added background error-path tests).
	- Continuous Integration: the GitHub Actions `ci.yml` workflow is passing on `master` (badge at top of this README).
	- Changes were committed and pushed to `master` (latest commits include the Options fix, CI workflow, and lint/test fixes).
- Build system: Vite with `@crxjs/vite-plugin` remains in use. The CI workflow builds the project and checks the `dist/` output.
- UI: Popup and Options implemented in React/TypeScript; Options no longer overwrites stored settings on mount.
- Types: `@types/chrome` is present and code was updated to use proper Chrome typings where practical.
- Icons & packaging: Manifest references `icon16.png`, `icon48.png`, `icon128.png` and CI now validates these exist in `dist/` after build.
- Permissions: Per user instruction the project keeps `host_permissions: ['<all_urls>']` for now. This was an explicit decision (Option C) and no manifest change was made.
	- Note: This decision was recorded in `memory.md` on 2025-10-27T04:20:00Z. If you later decide to narrow permissions (Option A) or move to `optional_permissions` (Option B), I can make that change and update the manifest and docs.

## What still needs to be done (recommended next steps)

1. Permissions audit (HIGH — ask-first): If you want to narrow `host_permissions` we can:
	 - Replace `<all_urls>` with a smaller set (e.g. `['http://*/*','https://*/*']`) or
	 - Move broad hosts to `optional_permissions` and request them at runtime when needed.
2. Additional tests & coverage (MEDIUM): Some unit coverage has been added (background error-paths). Remaining work: add more background-path tests (e.g. injection success/failure edge cases) and consider integration/e2e tests (Playwright) that load the unpacked extension into a Chromium instance.
3. CI improvements (MEDIUM): Parse the built `dist/manifest.json` after `npm run build` to discover any referenced assets (icons, web_accessible_resources) instead of hardcoding icon names. Consider adding Vitest coverage reports and gating thresholds.
4. UX polish (LOW): Improve popup feedback (e.g., "No selection", "Reading…", handle voice-list race conditions) and consider an explicit "Save" action on the Options page if preferred.
5. Docs & release readiness (LOW): Add a short publishing guide (Chrome Web Store packaging, keys, CHANGELOG) and confirm icon assets exist for all platforms.

Notes:
- Tests and linting were validated locally; GitHub Actions CI is currently passing on `master` (see badge). If CI shows any environment-specific lint issues, I can iterate on them.
- A short reminder to run lint locally before pushing was added to `memory.md`; consider adding a Husky pre-push hook to run lint automatically.
- If you change your mind about permissions, tell me which option (A: narrow hosts, B: optional_permissions, or C: keep `<all_urls>`) and I will apply updates to `src/manifest.ts` and related documentation.

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

## Host audio playback (Coqui Docker)

If you prefer the Docker/Coqui TTS server to play audio on the host (so the browser doesn't handle playback), this repo includes an opt-in `PLAY_ON_HOST` mode. It uses `paplay` (PulseAudio) or `aplay` (ALSA) inside the container to output the generated WAV file to the host sound system.

Quick command to start the local Coqui container with host audio forwarding (Linux desktop):

```bash
# from repo root — adjust XDG_RUNTIME_DIR if your runtime dir differs
XDG_RUNTIME_DIR=/run/user/$(id -u) docker-compose -f docker-compose.coqui.yml up --build
```

Notes:
- The compose file sets `PLAY_ON_HOST=1` and mounts the Pulse socket from `${XDG_RUNTIME_DIR:-/run/user/1000}/pulse/native` into the container. This is required for `paplay` to talk to your PulseAudio/pipewire session.
- If your system uses a different runtime dir or different user ID, set `XDG_RUNTIME_DIR` accordingly (for example, `XDG_RUNTIME_DIR=/run/user/1001`).

Troubleshooting

- Permission denied when connecting to Pulse socket:
	- Ensure the host socket is readable by the container user. You can run the container with your host UID by adding `user: "${UID}:${GID}"` in the service definition or run the container with `--user $(id -u):$(id -g)`.
	- Alternatively mount your Pulse cookie into the container (uncomment the cookie mount in `docker-compose.coqui.yml`).

- `paplay` not found / playback fails inside container:
	- Confirm the container image was rebuilt after the Dockerfile change. Rebuild with the compose command above.
	- Exec into the running container and test playback manually:
		```bash
		docker exec -it $(docker ps -qf "ancestor=coqui-local") bash
		# inside container
		paplay /path/to/sample.wav || aplay /path/to/sample.wav
		```

- Pulse/pipewire compatibility issues:
	- Many modern distros run PipeWire with PulseAudio compatibility; mounting the Pulse socket often works. If it doesn't, consider Option C (host helper) described below.

Security note

- Mounting the host sound socket or `/dev/snd` allows the container to output audio through your session. Only enable this for trusted containers.

Alternative (safer) approach

- If you prefer to avoid mounting host devices, run a small host-side player service (a tiny HTTP endpoint on `127.0.0.1`) that receives audio bytes and plays them with `paplay` on the host. The container can POST the generated WAV to that endpoint. This keeps the container isolated and delegates audio playback to a trusted host process.

## Quick contact / contributor notes

If you'd like, I can open a PR that:
- Fixes the Options mount/save race so stored settings are not overwritten on load.
- Proposes a narrowed `host_permissions` and (optionally) converts broad hosts to `optional_permissions` (ask-first change).
- Adds CI validations for manifest assets and a short publishing checklist.

---

This file was updated after a brief code review of the repository files to summarize functionality and current state.

