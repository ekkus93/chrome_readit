1. The docs read like a strong diagnosis, but some points are still hypotheses until verified in code — especially whether overlap is caused mainly by mixed `/api/tts` + host playback, by the `executeScript` fallback sequencing bug, or by both.

2. There’s an intentional choice to make `/api/tts/play` non-extension-only. That’s clear directionally, but we should decide later whether it remains as a manual debug endpoint or is treated as effectively deprecated.

3. “Supported pages” vs “unsupported pages” for reinjection/recovery is still a bit open. The desired behavior is clear, but the exact boundary will depend on Chrome/MV3 constraints and the current manifest/injection setup.
