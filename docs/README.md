# Chrome Read It documentation index

## Current governing documents

- `CHROME_READIT_PLAYBACK_HARDENING_SPEC_2026-08-02.md` — target architecture and behavioral requirements.
- `CHROME_READIT_PLAYBACK_HARDENING_TODO_2026-08-02.md` — Ralph-loop implementation and validation plan.
- `CHROME_READIT_PLAYBACK_HARDENING_IMPLEMENTATION_REPORT_2026-08-02.md` — current implementation state, evidence, and remaining runtime gates.

These files describe the authoritative playback design: one offscreen-owned coordinator, one browser audio element, an offscreen-owned synthesis queue, typed cross-context messages, sentence packing, bounded pacing, and a loopback-only bounded Coqui service.

## Historical review documents

Older review, TODO, and completion documents in this directory record earlier repository states. They may mention:

- background-service-worker queue ownership;
- `OFFSCREEN_PLAY_AUDIO` and `PLAYBACK_FINISHED` acknowledgements;
- popup or Options page `Audio()` instances;
- content-script or standalone player implementations;
- `/api/tts/play` and host-audio playback;
- the removed `docker/legacy/` service.

Those descriptions are historical and must not be treated as current implementation guidance. When an older document conflicts with the current governing documents or source code, the current playback hardening specification, TODO, implementation report, and source code take precedence.

## Validation rule

A checked-in implementation is not equivalent to runtime proof. The implementation report distinguishes:

1. code and test coverage that has been committed;
2. CI gates that are configured but whose run result has not been retrieved;
3. real Docker/model and structured listening validation that still requires a suitable runtime environment.
