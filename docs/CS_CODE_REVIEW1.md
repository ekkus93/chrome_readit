# Code Review — Claude Sonnet 4.6
**Date:** 2026-04-09  
**Reviewer:** Claude Sonnet 4.6 (GitHub Copilot)  
**Focus:** Full codebase review with special attention to the audio overlap / stumbling bug.

---

## What's Good

**Idempotent content bridge.**  
The `__readitContentBridgeState` guard on `globalThis` is exactly right. It prevents duplicate `onMessage` listeners even when `executeScript` re-injects the content script.

**Per-playback token invalidation.**  
The `activePlaybackToken` counter in `PlaybackController` is clean. Any completion callback that captures a stale token is a no-op. It's the right pattern.

**Explicit `PLAYBACK_FINISHED` handshake.**  
Having the content script send `PLAYBACK_FINISHED` back to the background, with the background waiting on it before advancing, is the correct serialization mechanism. The redundant `sendResult` path (via `sendResponse`) as a backup is also good resilience.

**1-chunk lookahead prefetch.**  
Fetching chunk N+1 while N plays keeps the pipeline fed without pre-loading everything. Smart.

**Canonical settings.**  
`storage.ts` is a clean, single source of truth. No duplication.

**Session ownership model.**  
The `latestPlaybackRequestId` / `activeSession` combination correctly implements latest-read-wins cancellation without complex task graphs.

---

## What's Bad

### 1. `DEBUG = true` in production
`content.ts:7` and `service-worker.ts:53` both have `const DEBUG = true` hardcoded. Every user gets verbose console logs. Should be `false` (or `import.meta.env.DEV`).

### 2. Redundant `playback.stop()` call
`content.ts:98` explicitly calls `playback.stop()` before the play call. But `playUint8Array` also calls `this.stop()` at its very first line. So `stop()` is called twice per new chunk — the token increments twice (T→T+1→T+2) and `clearCurrentAudio` runs twice. Functionally harmless but wasteful. Remove the explicit call in `content.ts`.

### 3. `playViaWebAudio` stale-token path leaks a Promise
`playback.ts:74-76`: when `this.activePlaybackToken !== playbackToken`, the code calls `cleanupWebAudioSource` and **returns without resolving the Promise**. That Promise hangs forever. `tryWebAudioFallback` is awaiting it and is never freed. The fix is one line: replace `return` with `resolve({ ok: false, error: 'stopped' })`.

### 4. `test-tts` causes dual playback
`service-worker.ts:595-606`: the handler sends `PLAY_AUDIO` directly to the content script (line 600) AND returns `{ audio: buf }` to the popup (line 606). The popup's test-speech button plays audio locally from the `sendResponse` data. The content script *also* plays it. That's two concurrent plays on every test-speech press. The content script forward should be removed — the popup handles its own playback from the response audio.

### 5. `requireActivePlaybackTab()` called twice in `sendToActiveTabOrInject`
Line 330 calls it to get the tab for `executeScript` selection grabbing. Line 345 calls it again to get the tab for `createPlaybackSession`. Between the two calls, the user can switch tabs — the text was grabbed from tab A, but the session is created for tab B. Capture the tab once and reuse the reference.

### 6. `waitForPlaybackAck` throws instead of recovering
`service-worker.ts:191`: if `pendingPlaybackAck` is non-null when called (shouldn't happen in normal flow, but possible if session logic has a race), it throws. That exception propagates through `processChunksSequentially`'s catch and silently cancels the session with no user-visible error. Better: log a warning, resolve the old pending ack as cancelled, then set the new one.

### 7. `Msg` type is missing fields that are actually sent
`messaging.ts:4`: the `PLAY_AUDIO` variant only declares `audio` and `mime`. But every `sendTabMessageWithBootstrap` call also sends `playbackToken` and `rate`. All call sites must cast to `Record<string, unknown>` to access those fields. The type should include them.

### 8. Inconsistent message naming
Control messages use `action: 'pause-speech'` (old form) alongside `kind: 'pause-speech'` checks (`anyReq.action === 'pause-speech' || anyReq.kind === 'pause-speech'`) while playback uses `kind: 'PAUSE_SPEECH'` (new form). The dual-alias checks are spread across the file. Pick one canonical form and remove the aliases.

---

## The Remaining Overlap / Stumbling Issue

The code-level serialization looks correct after the `PLAYBACK_FINISHED` work. The residual stumbling at paragraph boundaries is most likely **no inter-chunk silence**. Here's why:

When the ack for chunk N arrives, the background immediately sends chunk N+1 (the prefetch is already done). The content receives it, calls `playback.stop()` (which is a no-op since audio has ended), and starts the new audio. Effectively zero gap.

Audio output hardware has output buffers. When the `ended` event fires, the last few milliseconds of chunk N's audio may still be physically draining through the hardware path while chunk N+1 has already started decoding. At natural pause points — sentence ends, paragraph breaks — this sounds like overlap or stumbling to the listener.

**The fix is one line** in `processChunksSequentially`, immediately after `const ack = await ackPromise` (line 302):

```ts
const ack = await ackPromise
if (!ack.ok) { ... }
// Let the audio output buffer drain before starting the next chunk.
await sleep(150)
```

150–200ms is enough to cover hardware buffer latency. At paragraph boundaries you could detect them in `splitTextIntoChunks` (the `\n` case) and use a longer pause (e.g. 400ms) for a more natural reading rhythm.

---

## Priority Fix Summary

| Priority | Issue | File | Fix |
|---|---|---|---|
| 🔴 High | No inter-chunk silence (stumbling) | `service-worker.ts:302` | `await sleep(150)` after ack |
| 🔴 High | `test-tts` dual playback | `service-worker.ts:595-604` | Remove content script forward |
| 🟡 Medium | `playViaWebAudio` Promise leak | `playback.ts:75` | `resolve({ ok: false, error: 'stopped' })` |
| 🟡 Medium | `DEBUG = true` | both files | `false` or `import.meta.env.DEV` |
| 🟡 Medium | Double `stop()` | `content.ts:98` | Remove explicit call |
| 🟡 Medium | Double `requireActivePlaybackTab()` | `service-worker.ts:330,345` | Capture once, reuse |
| 🟢 Low | `Msg` type incomplete | `messaging.ts:4` | Add `playbackToken`, `rate` fields |
| 🟢 Low | `waitForPlaybackAck` throws | `service-worker.ts:191` | Log + recover instead of throw |
| 🟢 Low | Inconsistent message naming | `service-worker.ts` | Standardize to `kind: 'PAUSE_SPEECH'` form |
