import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('./../lib/storage', () => ({ getSettings: vi.fn(async () => ({ rate: 1.0, ttsUrl: 'http://localhost:5002/api/tts', voice: 'v' })) }))

describe('chunk timeout behavior', () => {
  beforeEach(() => {
    vi.resetModules()
    vi.resetAllMocks()
    // set a small timeout so the test runs quickly
    ;(globalThis as any).__CHUNK_TIMEOUT_MS = 50

    ;(globalThis as unknown as { chrome?: any }).chrome = {
      tabs: {
        query: vi.fn(() => Promise.resolve([{ id: 301, url: 'https://example.com' }])),
        // make sendMessage slow: resolves after 200ms (longer than our 50ms timeout)
        sendMessage: vi.fn((..._a: any[]) => new Promise((res) => setTimeout(() => res(undefined), 200)))
      },
      scripting: { executeScript: vi.fn() },
      commands: { onCommand: { addListener: vi.fn() } },
      runtime: { onMessage: { addListener: vi.fn() }, onInstalled: { addListener: vi.fn() }, sendMessage: vi.fn() },
      contextMenus: { create: vi.fn(), onClicked: { addListener: vi.fn() } },
    }
  })

  it('proceeds after chunk ack timeout and sends subsequent chunks', async () => {
    // make a long text that will be split into multiple chunks
    const base = 'Sentence one. Sentence two. Sentence three. Sentence four. Sentence five.'
    const long = Array(50).fill(base).join(' ')

    // capture fetch bodies
    const fetched: string[] = []
    vi.stubGlobal('fetch', vi.fn(async (_input: unknown, init?: any) => {
      try { if (init && typeof init.body === 'string') { const js = JSON.parse(init.body); if (js && typeof js.text === 'string') fetched.push(js.text) } } catch {}
      return Promise.resolve({ ok: true, status: 200, headers: { get: () => 'audio/wav' }, arrayBuffer: async () => new Uint8Array([1,2,3]).buffer })
    }))

    const mod = await import('./service-worker')
    // call the pipeline
    await (mod.sendToActiveTabOrInject as any)({ kind: 'READ_TEXT', text: long })

    // we should have fetched multiple chunks
    expect(fetched.length).toBeGreaterThanOrEqual(2)

    // chrome.tabs.sendMessage should have been called at least once per fetched chunk
    const calls = (globalThis as any).chrome.tabs.sendMessage.mock.calls.length
    expect(calls).toBeGreaterThanOrEqual(fetched.length)
  })
})
