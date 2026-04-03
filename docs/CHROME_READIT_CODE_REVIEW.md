# CHROME_READIT_CODE_REVIEW.md

## Overview

This document summarizes the code review findings for the `chrome_readit` project, with a specific focus on the reported bugs:

1. **Speech speed adjustment is inconsistent**.
2. **Sentences sometimes overlap and play on top of each other**.

This review also captures the agreed direction for the next implementation pass:

- **Client-side playback only**
- **Reuse `src/lib/storage.ts` everywhere**
- **Remove the direct `executeScript` audio-player fallback and replace it with bootstrap/retry of the normal content-script playback path**
- **Enforce a single active playback session**
- **Use server voices everywhere**
- **Fix popup playback status handling**
- **Fix WebAudio fallback cleanup**

---

## Executive summary

The main issue is not one isolated bug. The playback architecture is currently split across multiple incompatible paths:

1. **Client-side playback** using `/api/tts`
2. **Server-side playback** using `/api/tts/play`
3. **Mixed playback** when `/api/tts` returns audio to the extension while the server also plays on the host

Because those paths are not consistently separated, the result is:

- speed changes sometimes apply and sometimes do not
- some chunks play sequentially while others overlap
- different UI surfaces can save different assumptions into shared settings

The project is structurally decent, but playback needs to be simplified and made deterministic.

---

## What is good about the code

### 1. Good overall modular structure
The project has a reasonable separation of responsibilities:

- background/service-worker orchestration
- content-side playback control
- options/popup UI
- shared storage helpers
- TTS server integration

That is a solid foundation.

### 2. Playback controller abstraction is good
`src/content/playback.ts` is the right place to centralize playback behavior such as:

- play
- pause
- resume
- stop
- playback rate changes
- fallback behavior

This is a good design choice.

### 3. Chunking and prefetching approach is good in principle
The producer/consumer pipeline in the background is the right overall direction for long-form reading. It is much better than a naïve fire-and-forget approach.

### 4. Existing defensive practices are useful
There are signs of good engineering instincts:

- rate clamping
- explicit stop calls before replacement in some paths
- attempt to handle fallback audio playback
- attempt to centralize settings

So this is not a poorly structured project. It mainly needs playback-path consolidation and stronger session control.

---

## Primary bugs and root causes

## 1. Speed adjustment is inconsistent because the project uses two incompatible TTS endpoints

### Root cause
The extension is sometimes configured to use:

- `/api/tts` → returns audio, extension plays it locally, playback rate can be applied in the browser
- `/api/tts/play` → server plays audio directly, extension cannot control the playback rate of host-side audio

### Why this causes the reported symptom
When playback is local in the browser, `playbackRate` works.
When playback happens on the server/host, the browser rate slider has no control over what the user hears.

That directly explains the reported symptom:

> Sometimes the speed adjustment works. Sometimes it does not.

### Contributing issue
The default TTS URL is inconsistent across the codebase:

- one place defaults to `/api/tts`
- another defaults to `/api/tts/play`

This means user behavior can vary depending on which UI last saved settings.

### Agreed fix direction
- make playback **client-side only**
- use **`/api/tts` only** in the extension
- do **not** use `/api/tts/play` in the normal extension workflow
- ensure all settings are sourced from `src/lib/storage.ts`

---

## 2. Sentences overlap because there are multiple ways audio can be played concurrently

This section mixes two kinds of claims:

- **confirmed architectural hazards / code-level bugs**
- **likely contributors to the reported runtime overlap symptom whose exact production share is not yet proven**

The mixed-mode design is definitely real, and the `executeScript` fallback definitely does not preserve sequencing. What is not yet proven is whether real-world overlap is caused mostly by host+client double playback, mostly by the fallback sequencing bug, or by both together.

### Root cause A: mixed playback mode
If the server is configured to also play audio on the host while the extension receives the same audio and plays it locally, the same sentence can be heard twice or slightly offset.

This is a likely contributor when overlap sounds like duplicate playback of the same chunk, but its exact production frequency still needs instrumentation to confirm.

### Root cause B: direct `executeScript` fallback does not preserve sequencing
The background fallback currently creates a raw `Audio()` object in the page and returns immediately instead of waiting for playback completion.

That means the queue/consumer loop believes the chunk finished even though it is still playing, so the next chunk may begin before the previous one actually ends.

This is a direct sequencing bug.

### Root cause C: global mutable playback state instead of per-session state
The background currently uses shared mutable state for cancellation, pause, chunk indexing, and current chunk storage.

That is fragile. If the user starts another read before the first fully unwinds, two logical playback runs can interfere with each other.

This can cause:

- old playback continuing after a new playback starts
- stop/cancel signals applying to the wrong run
- queue corruption or interleaving

### Agreed fix direction
- enforce **client-side only playback**
- remove direct fallback audio playback in the background
- keep the **content script as the only playback engine**
- add a **single active playback session** model in the background

---

## 3. `src/lib/storage.ts` is not the single source of truth yet

### Root cause
Some UI code duplicates:

- settings types
- defaults
- storage read/write helpers
- default TTS URL

This is a correctness problem, not just a cleanliness issue.

### Why it matters
When defaults diverge, the extension becomes nondeterministic. One UI can save a value that another UI assumes should be different.

### Agreed fix direction
Use `src/lib/storage.ts` as the canonical source for:

- `Settings`
- default URL
- default settings
- load/save helpers

---

## 4. Popup and Options do not agree on what a voice is

### Root cause
The popup uses browser `speechSynthesis` voices, while actual TTS playback is coming from the configured TTS server.

### Why this is a bug
The popup can store a voice name that is valid for browser speech synthesis but meaningless to the Coqui server.

That creates invalid or confusing state.

### Agreed fix direction
Use **server voices everywhere** by fetching the voice list from `/api/voices` in both popup and options.

---

## 5. Popup test playback status handling is incorrect

### Root cause
The popup’s async play flow treats some failures like success because the promise chain uses `catch(...).then(...)`.

### Why this is wrong
A caught rejection resolves the chain, and the subsequent `.then()` still runs.

This can cause false-positive success UI state.

### Agreed fix direction
Replace the chained promise flow with a simple `try/await/catch` so success is only reported after actual successful playback.

---

## 6. WebAudio fallback cleanup is incomplete

### Root cause
The fallback path clears the current source reference on normal completion but does not always close the `AudioContext`.

### Why this matters
Repeated fallback playback can leak resources over time.

### Agreed fix direction
Close the `AudioContext` on normal completion and on stop/cancel paths.

---

## Architectural direction agreed for implementation

## 1. Client-side playback only
The browser should be the only playback engine for the extension workflow.

### Consequences
- the extension should call `/api/tts`
- the server should return audio
- the browser should play the audio
- server-side host playback should be off
- `/api/tts/play` should not be used by the extension’s normal workflow
- `/api/tts/play` may remain on the server as a manual debug endpoint, but it should be treated as deprecated for extension use

This makes playback rate, pause, resume, stop, and sequencing controllable in one place.

---

## 2. Content script should be the only audio player
The content script should be the sole component responsible for actual speech playback in tab context.

### Consequences
The background should not create ad-hoc page-local `Audio()` players via `executeScript`.

Instead, if messaging fails, the background should:

1. on ordinary supported tabs, inject or rebootstrap the content script once
2. retry the normal `sendMessage` path
3. abort cleanly if that still fails

On restricted or unsupported pages, the extension should fail fast with a clear "playback not supported on this page" message instead of introducing a second playback engine.

That preserves one playback engine and one completion model.

---

## 3. Single active playback session in the background
The background should track a single active session object with a unique session ID.

### Consequences
Every long-running playback loop should verify that it still belongs to the active session.
If not, it should exit immediately.

This prevents old runs from leaking into new ones.

---

## 4. Shared storage and shared voice loading
All settings should be loaded from the shared storage module, and all voice choices should come from the TTS server.

This avoids split-brain configuration.

---

## Specific code areas that likely need changes

## `src/lib/storage.ts`
Should become the canonical source of:

- settings type
- default settings
- default TTS URL
- load/save helpers

## `src/options/Options.tsx`
Should stop defining a separate settings model and should stop carrying its own defaults. Should consume shared storage helpers instead.

Also should stop exposing stale server-playback UX if the app is switching to client-side-only playback.

## `src/popup/Popup.tsx`
Should:

- use shared storage helpers
- stop using browser speech-synthesis voices
- fetch server voices instead
- fix promise handling for test playback

## `src/background/service-worker.ts`
Should:

- stop special-casing `/play`
- stop direct fallback playback via `executeScript`
- implement bootstrap/retry of the content script instead
- implement session-based playback state
- explicitly stop existing playback before beginning a new session

## `src/content/playback.ts`
Should:

- continue to be the main playback engine
- ensure proper cleanup of fallback `AudioContext`
- remain the single place where rate/pause/resume/stop are applied

## `docker/docker-compose.yml`
Should disable host playback.

## `docker/coqui-local/app.py`
Should keep `/api/tts` as “return audio only” for the extension path.

---

## Risk assessment

## High-risk / user-visible issues

### 1. Mixed playback architecture
This is the most important issue because it causes both of the user-reported bugs.

### 2. Non-session-based background state
This can cause intermittent failures that are hard to reproduce and hard to trust once the queue becomes busy.

### 3. Split settings model
This causes hidden configuration drift.

---

## Lower-risk but still important issues

### 4. Popup false success state
This creates misleading diagnostics.

### 5. WebAudio cleanup leak
This is unlikely to be the primary reported bug, but it is still worth fixing.

---

## Recommended implementation order

1. Make shared storage canonical
2. Switch extension defaults to `/api/tts`
3. Disable host playback in Docker/server config
4. Remove extension support for `/api/tts/play`
5. Replace direct fallback playback with bootstrap/retry
6. Add single active playback session support
7. Switch popup to server voices
8. Fix popup playback status handling
9. Fix `AudioContext` cleanup
10. Remove stale server-playback UI/status from options

---

## Acceptance expectations after the refactor

After the changes, the project should behave like this:

- changing playback speed always affects audible speech
- only one sentence/chunk plays at a time
- starting a new read stops the previous run cleanly
- popup and options show the same TTS URL and same voice list
- invalid browser-only voices are no longer selectable
- playback test UI only shows success after real success
- fallback audio cleanup does not leak contexts

---

## Final assessment

The codebase is workable and has a decent structure, but playback currently suffers from split ownership and inconsistent assumptions.

The fixes above are not just cleanup. They directly target the reported bugs and should make playback deterministic enough to debug and extend safely.
