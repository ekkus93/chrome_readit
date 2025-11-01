import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('./../lib/storage', () => ({ getSettings: vi.fn(async () => ({ rate: 1.0, ttsUrl: 'http://localhost:5002/api/tts', voice: 'v' })) }))

describe('chunk timeout behavior', () => {
  beforeEach(() => {
    vi.resetModules()
    vi.resetAllMocks()
    // set a small timeout so the test runs quickly
    ;(globalThis as unknown as { __CHUNK_TIMEOUT_MS?: number }).__CHUNK_TIMEOUT_MS = 50

    type ChromeMock = {
      tabs: { query: (...args: unknown[]) => Promise<unknown>, sendMessage: (...args: unknown[]) => unknown }
      scripting: { executeScript: (...args: unknown[]) => unknown }
      commands: { onCommand: { addListener: (...args: unknown[]) => unknown } }
      runtime: { onMessage: { addListener: (...args: unknown[]) => unknown }, onInstalled: { addListener: (...args: unknown[]) => unknown }, sendMessage: (...args: unknown[]) => unknown }
      contextMenus: { create: (...args: unknown[]) => unknown, onClicked: { addListener: (...args: unknown[]) => unknown } }
    }

    const chromeObj = {
      tabs: {
        query: vi.fn(() => Promise.resolve([{ id: 301, url: 'https://example.com' }])),
        // make sendMessage slow: resolves after 200ms (longer than our 50ms timeout)
        sendMessage: vi.fn((...args: unknown[]) => { void args; return new Promise((res) => setTimeout(() => res(undefined), 200)) })
      },
      scripting: { executeScript: vi.fn() },
      commands: { onCommand: { addListener: vi.fn() } },
      runtime: { onMessage: { addListener: vi.fn() }, onInstalled: { addListener: vi.fn() }, sendMessage: vi.fn() },
      contextMenus: { create: vi.fn(), onClicked: { addListener: vi.fn() } },
    } as unknown as ChromeMock
    ;(globalThis as unknown as Record<string, unknown>).chrome = chromeObj
  })

  it('proceeds after chunk ack timeout and sends subsequent chunks', async () => {
    // make a long text that will be split into multiple chunks
    const base = 'Sentence one. Sentence two. Sentence three. Sentence four. Sentence five.'
    const long = Array(50).fill(base).join(' ')

    // capture fetch bodies
    const fetched: string[] = []
    vi.stubGlobal('fetch', vi.fn(async (_input: unknown, init?: unknown) => {
      try {
        const maybe = init as Record<string, unknown> | undefined
        if (maybe && typeof maybe.body === 'string') {
          const js = JSON.parse(maybe.body)
          if (js && typeof js.text === 'string') fetched.push(js.text)
        }
      } catch (e) { void e }
      return Promise.resolve({ ok: true, status: 200, headers: { get: () => 'audio/wav' }, arrayBuffer: async () => new Uint8Array([1,2,3]).buffer })
    }))

    const mod = await import('./service-worker')
    // call the pipeline
    await (mod.sendToActiveTabOrInject as unknown as (x: unknown) => Promise<unknown>)({ kind: 'READ_TEXT', text: long })

    // we should have fetched multiple chunks
    expect(fetched.length).toBeGreaterThanOrEqual(2)

    // chrome.tabs.sendMessage should have been called at least once per fetched chunk
    const calls = (((globalThis as unknown as Record<string, unknown>).chrome as unknown as { tabs: { sendMessage?: { mock?: { calls?: unknown[][] } } } }).tabs.sendMessage?.mock?.calls?.length) ?? 0
    expect(calls).toBeGreaterThanOrEqual(fetched.length)
  })
})
