Local TTS helper

This folder contains a tiny local HTTP server to call system TTS (spd-say or espeak-ng) from the browser when the browser's speechSynthesis voices are unavailable (e.g., snap Chromium).

Usage:

1) Install dependencies (none required besides system tools: `spd-say` or `espeak-ng`).

2) Run the server:

```bash
node scripts/tts-server.js 4000
```

3) From the page or extension, POST text to speak:

```js
fetch('http://127.0.0.1:4000/speak', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ text: 'Hello from local helper' })
})
.then(r => r.json()).then(console.log).catch(console.error)
```

Notes:
- The server listens on localhost only (127.0.0.1) and enables CORS for convenience during local testing.
- This is a development helper and should not be used as a production remote API.
- You can wire the extension to POST to this helper when `speechSynthesis.getVoices()` returns an empty array.
