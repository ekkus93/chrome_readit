from pathlib import Path

# This helper is intentionally self-deleting after repairing the generated test fixture.
path = Path(__file__).with_name('apply-offscreen-target-routing-fix.py')
text = path.read_text(encoding='utf-8')
old = "    expect(listener(startRequest(), null, vi.fn())).toBe(false)"
new = """    expect(listener({
      kind: 'START_PLAYBACK',
      requestId: 'request-untargeted',
      source: 'popup-test',
      text: 'Untargeted.',
      settings: { ttsUrl: 'http://localhost:5002/api/tts', voice: 'p225', rate: 1 },
    }, null, vi.fn())).toBe(false)"""
if text.count(old) != 1:
    raise SystemExit('Untargeted start fixture anchor did not match exactly once')
path.write_text(text.replace(old, new), encoding='utf-8')
Path(__file__).unlink()
