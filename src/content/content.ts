import type { Msg } from '../lib/messaging'
import { getSettings } from '../lib/storage'

// Use page context Web Speech API
async function speak(text: string) {
  const s = await getSettings()
  const utter = new SpeechSynthesisUtterance(text)
  utter.rate = s.rate
  if (s.voice) {
    const voice = speechSynthesis.getVoices().find(v => v.name === s.voice)
    if (voice) utter.voice = voice
  }
  speechSynthesis.cancel() // stop any previous
  speechSynthesis.speak(utter)
}

chrome.runtime.onMessage.addListener((msg: Msg) => {
  if (msg.kind === 'READ_SELECTION') {
    const sel = window.getSelection()?.toString().trim()
    if (sel) speak(sel)
  } else if (msg.kind === 'READ_TEXT') {
    if (msg.text?.trim()) speak(msg.text.trim())
  }
})
