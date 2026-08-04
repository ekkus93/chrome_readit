from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
coordinator_path = ROOT / "src/offscreen/playback-coordinator.ts"
test_path = ROOT / "src/offscreen/playback-coordinator.test.ts"
block13_path = ROOT / "scripts/chromium-block13-e2e.mjs"

coordinator = coordinator_path.read_text(encoding="utf-8")
old_run = """        await this.playChunk(session, chunk, currentResult.audio)\n        if (!this.isCurrent(session)) return\n        this.emit('chunk-ended', chunk)\n"""
new_run = """        await this.playChunk(session, chunk, currentResult.audio)\n        if (!this.isCurrent(session)) return\n        await this.waitWhilePaused(session)\n        if (!this.isCurrent(session)) return\n        this.emit('chunk-ended', chunk)\n"""
if coordinator.count(old_run) != 1:
    raise SystemExit("Coordinator post-play sequence did not match exactly once")
coordinator = coordinator.replace(old_run, new_run)
coordinator_path.write_text(coordinator, encoding="utf-8")

tests = test_path.read_text(encoding="utf-8")
anchor = """  it('pauses, resumes, and cancels the same player idempotently', async () => {\n"""
regression = """  it('does not complete when an ended callback races with a paused session', async () => {\n    const { audio, coordinator, events } = harness()\n    const started = await coordinator.start(request('Pause ended race.', 'pause-ended-race'))\n    if (!started.ok) throw new Error('start failed')\n    await waitForPlay(audio, 1)\n    await waitForStartedPlayer(coordinator)\n\n    await coordinator.control('pause', started.sessionId)\n    expect(coordinator.getStatus().state).toBe('paused')\n\n    audio.finish()\n    await new Promise((resolve) => setTimeout(resolve, 0))\n    expect(coordinator.getStatus().state).toBe('paused')\n    expect(events.some((event) => event.event === 'completed')).toBe(false)\n\n    await coordinator.control('resume', started.sessionId)\n    await vi.waitFor(() => expect(coordinator.getStatus().state).toBe('completed'))\n    expect(events.filter((event) => event.event === 'completed')).toHaveLength(1)\n  })\n\n"""
if tests.count(anchor) != 1:
    raise SystemExit("Coordinator pause-test anchor did not match exactly once")
tests = tests.replace(anchor, regression + anchor)
test_path.write_text(tests, encoding="utf-8")

block13 = block13_path.read_text(encoding="utf-8")
old_wait = """async function waitForStatus(cdp, sessionId, label, predicate, timeoutMs = 30_000) {\n  return await waitFor(label, async () => {\n    const status = await queryStatus(cdp, sessionId)\n    return predicate(status) ? status : null\n  }, timeoutMs)\n}\n"""
new_wait = """async function waitForStatus(cdp, sessionId, label, predicate, timeoutMs = 30_000) {\n  let lastStatus = null\n  try {\n    return await waitFor(label, async () => {\n      const status = await queryStatus(cdp, sessionId)\n      lastStatus = status\n      return predicate(status) ? status : null\n    }, timeoutMs)\n  } catch (error) {\n    throw new Error(`${error instanceof Error ? error.message : String(error)}; last status: ${JSON.stringify(lastStatus)}`)\n  }\n}\n"""
if block13.count(old_wait) != 1:
    raise SystemExit("Block13 status waiter did not match exactly once")
block13 = block13.replace(old_wait, new_wait)
block13_path.write_text(block13, encoding="utf-8")

Path(__file__).unlink()
