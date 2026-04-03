# CHROME_READIT_TODO.md

## Goal

Refactor playback so the extension uses **client-side playback only**, applies settings consistently from shared storage, prevents overlapping sentence playback, and makes voice/rate behavior deterministic.

This TODO is intended to be handed to GitHub Copilot or another coding agent for implementation.

---

# Phase 1 — Make shared storage the single source of truth

**Status:** Done

## Task 1.1 — Canonicalize settings in `src/lib/storage.ts`

**Status:** Done

### Subtasks
- [x] Export a single canonical `Settings` type from `src/lib/storage.ts`.
- [x] Export a canonical `DEFAULT_TTS_URL` set to `http://localhost:5002/api/tts`.
- [x] Export canonical default settings, for example `DEFAULT_SETTINGS`.
- [x] Ensure `getSettings()` returns merged defaults plus persisted values.
- [x] Ensure `saveSettings()` persists partial updates safely.

### Acceptance criteria
- There is exactly one canonical settings definition.
- Default TTS URL is `/api/tts`, not `/api/tts/play`.
- Any module can import settings type/defaults/helpers from `src/lib/storage.ts`.

---

## Task 1.2 — Remove duplicate settings logic from `src/options/Options.tsx`

**Status:** Done

### Subtasks
- [x] Delete local `Settings` type definitions in `Options.tsx`.
- [x] Delete local `DEFAULTS` / `DEFAULT_TTS_URL` definitions in `Options.tsx`.
- [x] Delete local `getSettings()` / `saveSettings()` wrappers in `Options.tsx`.
- [x] Import and use shared helpers from `src/lib/storage.ts`.

### Acceptance criteria
- `Options.tsx` no longer defines a separate settings model.
- Options uses the shared defaults and storage helpers only.

---

## Task 1.3 — Remove duplicate settings assumptions from other UI modules

**Status:** Done

### Subtasks
- [x] Audit `Popup.tsx` and any other UI modules for local copies of defaults or storage behavior.
- [x] Replace any local default URL assumptions with imports from `src/lib/storage.ts`.
- [x] Ensure popup and options read/write the same settings schema.

### Acceptance criteria
- Popup and Options persist and load the same settings values.
- TTS URL and rate remain consistent regardless of which UI was used last.

---

# Phase 2 — Enforce client-side playback only

**Status:** Done

## Task 2.1 — Remove extension dependency on `/api/tts/play`

**Status:** Done

### Subtasks
- [x] Audit `src/background/service-worker.ts` for any logic that branches on `/play`.
- [x] Remove special handling for `ttsUrl.endsWith('/play')` or equivalent.
- [x] Ensure all extension TTS requests go to `/api/tts` and expect audio data.
- [x] Remove or rewrite any JSON-success path that assumes server-side playback.

### Acceptance criteria
- The extension’s normal playback path only uses `/api/tts`.
- Playback code always expects audio to be returned for speech generation.
- `/api/tts/play` is treated as out of scope for extension use, even if it remains available on the server for manual debugging.

---

## Task 2.2 — Disable host playback in Docker/runtime config

**Status:** Done

### Subtasks
- [x] Update `docker/docker-compose.yml` to set `PLAY_ON_HOST=0`, or remove the variable if host playback is no longer needed.
- [x] Verify any local dev or README instructions do not tell the extension workflow to rely on host-side playback.

### Acceptance criteria
- Dockerized dev setup does not play speech on the host during normal extension use.

---

## Task 2.3 — Make `/api/tts` audio-return only in the server

**Status:** Done

### Subtasks
- [x] Update `docker/coqui-local/app.py` so `/api/tts` returns audio only.
- [x] Remove any “also play on host” behavior from `/api/tts`.
- [x] Keep `/api/tts/play` only if useful for manual debugging, but make sure extension code does not use it.

### Acceptance criteria
- Calling `/api/tts` from the extension does not also play audio on the server host.
- Only the browser produces audible playback in the extension workflow.

---

# Phase 3 — Make the content script the only playback engine

## Task 3.1 — Remove direct fallback page playback from the background

### Subtasks
- Find the fallback path in `src/background/service-worker.ts` that uses `chrome.scripting.executeScript()` to create an ad-hoc `Audio()` object.
- Remove the direct playback logic.
- Do not leave any path where the background can start unmanaged audio playback outside the content playback controller.

### Acceptance criteria
- Background code no longer plays speech directly via injected `Audio()`.
- There is only one playback engine in the extension: the content playback controller.

---

## Task 3.2 — Replace fallback with bootstrap/retry of content playback

### Subtasks
- Add a helper like `ensurePlaybackBridge(tabId)` that injects or re-injects the content script/player bridge when messaging fails.
- On message failure for an ordinary supported tab, attempt bridge bootstrap once.
- Retry the original `chrome.tabs.sendMessage()` playback message after bootstrap.
- If retry fails, abort the playback session cleanly rather than spawning an unmanaged fallback player or any second playback engine.

### Acceptance criteria
- Playback fallback preserves the same message-based flow as the primary path.
- The queue waits for the same completion path regardless of whether reinjection was needed.

---

## Task 3.3 — Harden content-script readiness assumptions

### Subtasks
- Verify the content script is available on all supported pages where reading is allowed.
- Handle unsupported pages gracefully and fail fast on restricted pages.
- Make error reporting explicit when playback cannot proceed because no content player is available.

### Acceptance criteria
- Unsupported pages fail cleanly.
- Supported pages can recover from missing content script via reinjection.
- Reinjection is a one-retry recovery path on supported tabs, not a replacement playback path.

---

# Phase 4 — Add single active playback session support

## Task 4.1 — Replace loose globals with a session object

### Subtasks
- Introduce a `PlaybackSession` type in `src/background/service-worker.ts`.
- Include fields such as:
  - `id`
  - `cancelRequested`
  - `paused`
  - `chunks`
  - `currentIndex`
- Add `activeSession` and monotonic `nextSessionId` state.

### Acceptance criteria
- Background playback state is attached to an explicit session object.
- There is at most one active session at a time.

---

## Task 4.2 — Cancel old session before starting a new session

### Subtasks
- Before starting a new read, cancel the current active session if one exists.
- Send a stop signal to content playback before beginning the new session.
- Replace the old active session with a new session ID.

### Acceptance criteria
- Starting a new read reliably stops the previous read.
- Old playback does not continue after a new session begins.

---

## Task 4.3 — Guard producer/consumer loops by session ID

### Subtasks
- Capture the session ID at the start of each async playback pipeline.
- Before each major async step, verify that the current work still belongs to `activeSession`.
- Exit immediately if the session ID is stale.

### Acceptance criteria
- Old producer/consumer loops cannot continue mutating state after a newer session starts.
- No cross-session chunk overlap occurs due to stale async work.

---

## Task 4.4 — Make pause/resume/cancel session-aware

### Subtasks
- Route pause/resume/cancel operations through the active session object.
- Ensure popup and background controls act on the current session only.
- Verify stop/cancel cleans up queue state and playback state.

### Acceptance criteria
- Pause/resume/cancel commands apply only to the current active session.
- Cancel truly stops the active run and leaves the system ready for the next run.

---

# Phase 5 — Use server voices everywhere

## Task 5.1 — Remove browser voice enumeration from popup

### Subtasks
- Delete any use of `window.speechSynthesis.getVoices()` in `src/popup/Popup.tsx`.
- Remove browser `SpeechSynthesisVoice` state from popup UI.
- Remove logic that persists browser-only voice names.

### Acceptance criteria
- Popup no longer depends on browser speech-synthesis voices.

---

## Task 5.2 — Add a shared server-voice loader helper

### Subtasks
- Create or extract a helper to fetch voices from the configured TTS server, for example via `/api/voices`.
- Use the configured TTS base URL consistently.
- Normalize returned voice data into a shared UI-friendly shape.

### Acceptance criteria
- Voice loading logic exists in one reusable place.
- Both popup and options can consume the same voice-loading helper.

---

## Task 5.3 — Use server voices in both Popup and Options

### Subtasks
- Update `src/options/Options.tsx` to use the shared server-voice loader if it does not already.
- Update `src/popup/Popup.tsx` to use the same helper and same voice data model.
- Ensure the selected voice is persisted in shared settings.

### Acceptance criteria
- Popup and Options display the same server-provided voice list.
- Selected voice values are valid for the actual TTS backend.

---

## Task 5.4 — Update UI copy to match reality

### Subtasks
- Remove any UI text that says voice availability depends on browser/OS speech synthesis.
- Replace it with text that says voice availability depends on the configured TTS server/model.

### Acceptance criteria
- UI descriptions match actual runtime behavior.

---

# Phase 6 — Fix popup test playback handling

## Task 6.1 — Replace broken promise chaining with `try/catch`

### Subtasks
- Find the popup test-play path where playback uses `.catch(...).then(...)`.
- Replace it with `await a.play()` inside `try/catch`.
- Report success only if `play()` actually succeeds.
- Report failure only from the catch block.

### Acceptance criteria
- Popup no longer reports success after a failed `play()` call.

---

## Task 6.2 — Make popup test playback require returned audio

### Subtasks
- Update popup test logic so success requires actual returned audio data.
- Remove any legacy handling for `/api/tts/play` response shapes from the popup.
- Fail clearly if the response contains no playable audio.

### Acceptance criteria
- Popup test playback reflects the client-side-only architecture.
- Missing audio is treated as an error, not as success.

---

# Phase 7 — Fix content-side fallback cleanup

## Task 7.1 — Close `AudioContext` on normal completion

### Subtasks
- In `src/content/playback.ts`, update WebAudio fallback `onended` handlers to close the associated `AudioContext`.
- Clear internal source/context references after completion.

### Acceptance criteria
- WebAudio fallback does not leak `AudioContext` instances on normal completion.

---

## Task 7.2 — Verify cleanup on stop/cancel/error paths

### Subtasks
- Audit stop/cancel/error handling in `src/content/playback.ts`.
- Ensure `AudioContext` and source references are cleaned up in all non-success paths.
- Ensure cleanup is idempotent.

### Acceptance criteria
- Repeated play/stop/play cycles do not accumulate stale fallback resources.

---

# Phase 8 — Remove stale server-playback UI and behavior

## Task 8.1 — Remove server-speaking status UX if no longer relevant

### Subtasks
- Audit Options and Popup for any UI tied to host/server playback state.
- Remove polling for endpoints like `/api/playing` if those are now irrelevant to the extension flow.
- Remove or rewrite cancel controls that only make sense for host-side playback.

### Acceptance criteria
- UI reflects the new architecture instead of exposing stale server-playback concepts.

---

## Task 8.2 — Remove dead code branches related to `/api/tts/play`

### Subtasks
- Audit background, popup, and options code for `/play`-specific response handling.
- Remove dead code and simplify state transitions accordingly.

### Acceptance criteria
- Codebase no longer carries normal-path complexity for server-side playback.

---

# Phase 9 — Add tests and validation coverage

## Task 9.1 — Add storage tests

### Subtasks
- Add tests for shared settings defaults.
- Add tests for merged persisted settings.
- Add tests ensuring default URL remains `/api/tts`.

### Acceptance criteria
- Settings behavior is covered by automated tests.

---

## Task 9.2 — Add playback session tests

### Subtasks
- Add tests for starting a second session canceling the first.
- Add tests for stale async work exiting when session ID changes.
- Add tests ensuring only one active playback session is possible.

### Acceptance criteria
- Playback session ownership is validated automatically.

---

## Task 9.3 — Add sequencing tests for fallback/bootstrap behavior

### Subtasks
- Add tests that simulate content-script message failure.
- Verify reinjection/bootstrap is attempted.
- Verify playback only continues via the normal content-script path.
- Verify the queue does not advance early due to unmanaged fallback playback.

### Acceptance criteria
- Message-failure recovery does not reintroduce overlapping playback.

---

## Task 9.4 — Add popup behavior tests

### Subtasks
- Add tests for popup play success/failure handling.
- Add tests ensuring a failed `play()` does not flip UI into success state.
- Add tests for server-voice loading behavior.

### Acceptance criteria
- Popup diagnostics are reliable.

---

## Task 9.5 — Add manual QA checklist

### Subtasks
- Verify changing rate while reading changes audible playback every time.
- Verify repeated reads do not overlap.
- Verify starting a second read interrupts the first cleanly.
- Verify popup and options show the same TTS URL.
- Verify popup and options show the same voice list.
- Verify browser speech-synthesis voices are no longer part of the UI.
- Verify fallback recovery works after content script reinjection.

### Acceptance criteria
- Manual verification confirms the two originally reported bugs are fixed.

---

# Suggested implementation order

1. Phase 1 — Shared storage canonicalization
2. Phase 2 — Client-side playback only
3. Phase 3 — Remove direct playback fallback and bootstrap/retry instead
4. Phase 4 — Single active playback session
5. Phase 5 — Server voices everywhere
6. Phase 6 — Popup test playback fix
7. Phase 7 — AudioContext cleanup
8. Phase 8 — Dead code / stale UI cleanup
9. Phase 9 — Tests and QA coverage

---

# Definition of done

This work is done when all of the following are true:

- the extension uses `/api/tts` only for normal playback
- host/server playback is not part of the extension workflow
- speed changes always affect audible speech
- only one chunk/sentence plays at a time
- starting a new read stops the previous run cleanly
- popup and options use the same shared settings model
- popup and options use the same server-provided voice list
- popup success/failure state is accurate
- content playback fallback cleanup is complete
- playback architecture is simpler, more deterministic, and easier to maintain
