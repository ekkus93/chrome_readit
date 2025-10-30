import { beforeEach, describe, expect, it, vi } from 'vitest'

// Use the exported sendToActiveTabOrInject function from the service worker
vi.mock('./../lib/storage', () => ({ getSettings: vi.fn(async () => ({ rate: 1.0, ttsUrl: 'http://localhost:5002/api/tts', voice: 'v' })) }))

describe('large text splitting and pipeline', () => {
  const sample = `Just look at the White House’s website right now. There’s a new “Major Events Timeline,” which begins as a seemingly standard sequence of events depicting the evolution of the People’s House, all the way back to George Washington selecting the site, rebuilding after it was set aflame in the War of 1812, and all the way through Richard Nixon’s bowling alley renovation. When the timeline gets to 1998, though, it abruptly transforms into a crude MAGA troll job with a caption highlighting Bill Clinton’s Oval Office sex scandal.

Trump’s “big lie” is, at its core, a witless tantrum thrown by a malignant narcissist who lacks the integrity to accept defeat.

That’s followed by a caption reading “Obama hosts members of the Muslim Brotherhood, a group that promotes Islamist extremism and has ties to Hamas.” This is an apparent reference to a 2012 meeting between mid-level National Security Council officials and political representatives of the Muslim Brotherhood in the aftermath of the overthrow of Egypt's longtime dictator Hosni Mubarak. If the trolling weren’t obvious enough, the caption is accompanied by a photo of Barack Obama wearing a turban during a visit to Kenya in 2006 — nowhere near the White House and years before Obama was president.`

  beforeEach(() => {
    vi.resetModules()
    vi.resetAllMocks()
    // minimal chrome mock
    type ChromeMock = {
      tabs: { query: (...args: unknown[]) => Promise<unknown>, sendMessage: (...args: unknown[]) => unknown }
      scripting: { executeScript: (...args: unknown[]) => unknown }
      commands: { onCommand: { addListener: (...args: unknown[]) => unknown } }
      runtime: { onMessage: { addListener: (...args: unknown[]) => unknown }, onInstalled: { addListener: (...args: unknown[]) => unknown }, sendMessage: (...args: unknown[]) => unknown }
      contextMenus: { create: (...args: unknown[]) => unknown, onClicked: { addListener: (...args: unknown[]) => unknown } }
    }
    const chromeObj = {
      tabs: {
        query: vi.fn(() => Promise.resolve([{ id: 201, url: 'https://example.com' }])),
        sendMessage: vi.fn(() => Promise.resolve(undefined)),
      },
      scripting: { executeScript: vi.fn() },
      commands: { onCommand: { addListener: vi.fn() } },
      runtime: { onMessage: { addListener: vi.fn() }, onInstalled: { addListener: vi.fn() }, sendMessage: vi.fn() },
      contextMenus: { create: vi.fn(), onClicked: { addListener: vi.fn() } },
    } as unknown as ChromeMock
    ;(globalThis as unknown as Record<string, unknown>).chrome = chromeObj
  })

  it('splits large text, fetches audio per chunk and forwards in order', async () => {
    // make the text long enough to force chunking
    let long = sample
    while (long.length < 3000) long = long + '\n\n' + sample

    const fetchedTexts: string[] = []
    // mock fetch to capture the text bodies sent to the TTS endpoint
    vi.stubGlobal('fetch', vi.fn(async (_input: unknown, init?: unknown) => {
      // parse JSON body if present
      try {
        const maybe = init as Record<string, unknown> | undefined
        if (maybe && typeof maybe.body === 'string') {
          const js = JSON.parse(maybe.body)
          if (js && typeof js.text === 'string') fetchedTexts.push(js.text)
        }
      } catch (e) { void e }
      return Promise.resolve({ ok: true, status: 200, headers: { get: () => 'audio/wav' }, arrayBuffer: async () => new Uint8Array([1,2,3]).buffer })
    }))

    // import module after mocks set up
    const mod = await import('./service-worker')

  // call the exported helper to send the text
  await (mod.sendToActiveTabOrInject as unknown as (x: unknown) => Promise<unknown>)({ kind: 'READ_TEXT', text: long })

  // The fetch mock should have been called and captured chunk texts
  expect((globalThis as unknown as Record<string, unknown>).fetch).toHaveBeenCalled()
    expect(fetchedTexts.length).toBeGreaterThanOrEqual(1)

    // Ensure that concatenating the fetched chunk texts (normalized) equals the original normalized text
    const reconstructed = fetchedTexts.map(s => (s || '').trim()).join(' ')
    const originalTrim = long.trim().replace(/\s+/g, ' ')

    const normalize = (s: string) => s
      .replace(/[‘’]/g, "'")
      .replace(/[“”]/g, '"')
      .replace(/\s+([.,;:!?])/g, '$1')
      .replace(/\s+/g, ' ')
      .trim()

    expect(normalize(reconstructed)).toEqual(normalize(originalTrim))

    // Each fetched chunk should be within the configured max length
    for (const t of fetchedTexts) {
  expect(t.length).toBeLessThanOrEqual(400)
    }

    // Ensure we forwarded audio to the content script once per fetched chunk
  const sendCalls = ((globalThis as unknown as Record<string, unknown>).chrome as unknown as { tabs: { sendMessage?: { mock?: { calls?: unknown[][] } } } }).tabs.sendMessage?.mock?.calls?.length ?? 0
    expect(sendCalls).toBeGreaterThanOrEqual(fetchedTexts.length)
    // If the producer/consumer worked normally, they should match
    expect(sendCalls).toBe(fetchedTexts.length)
  })
})
