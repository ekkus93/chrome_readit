# Read It — Resume checklist

This tiny checklist helps you (or another session) pick up development quickly after restarting this chat or your machine.

## Quick resume commands

Save current work and push (recommended):

```bash
git add .
git commit -m "WIP: save resume checkpoint (README, memory, resume checklist)"
git push
```

Install deps and run headless tests:

```bash
npm install
npx vitest --run
```

Start dev server (hot reload for popup/options UI):

```bash
npm run dev
```

Build production bundle:

```bash
npm run build
```

## Files to open first when resuming

- `src/options/Options.tsx` — fix Options mount/save race (HIGH priority)
- `src/background/service-worker.ts` — background injection fallback and message routing
- `src/manifest.ts` — consider narrowing `host_permissions` (ask-first change)
- `README.md` and `memory.md` — context and recent change log
- `.github/workflows/ci.yml` — CI runs lint, tests, build on push/PR

## High-priority tasks remaining

1. Options mount/save race (HIGH)
   - Problem: Options persists default values on mount before stored settings are loaded.
   - Action: Ensure settings are loaded first (set a `loaded` flag) and only persist after load or require explicit Save.

2. Permissions audit (HIGH — ask-first)
   - Problem: `host_permissions` currently includes `<all_urls>` which is broad.
   - Action: Propose narrowed patterns or move to `optional_permissions` and request confirmation before editing `manifest.ts`.

3. (Optional) Commit & push `RESUME_CHECKLIST.md`, `memory.md`, and README to create an authoritative checkpoint.

## Helpful notes

- Tests: The `test` script may open the Vitest UI; for CI or local headless runs use:

```bash
npx vitest --run
```

- `memory.md` contains a timestamped summary of recent changes (types, tests, CI, background fallback, popup routing). See that file for quick context.

- If you want, I can also open a PR that implements the Options fix and a proposed narrowed `host_permissions` set — tell me which hosts you expect to support and I will prepare the PR (ask-first required for permission changes).

---

Last updated: 2025-10-27T03:46:00Z
