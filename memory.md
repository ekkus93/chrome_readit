
2025-10-27T03:46:00Z - Project updates and review notes
- Added unit tests (Vitest) for messaging guards, storage helpers, and background behavior.
- Added `@types/chrome` and removed local `chrome` shims; updated tsconfig to include chrome types.
- Implemented robust background injection fallback (one-off executeScript) and READ_TEXT support.
- Routed popup read requests through background to reuse fallback logic.
- Replaced remaining unsafe `any` casts with runtime guards and concrete types.
- Added GitHub Actions CI: lint, tests, and build jobs on push/PR.
