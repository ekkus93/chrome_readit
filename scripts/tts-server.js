#!/usr/bin/env node
// Simple local TTS server that accepts POST /speak with JSON { text }
// and calls `spd-say` (or `espeak-ng` if spd-say is not available).
// Usage: node scripts/tts-server.js [port]

import http from 'http'
import { spawn } from 'child_process'
import os from 'os'
import { fileURLToPath } from 'url'

const COQUI_URL = process.env.COQUI_URL || process.env.OPENTTS_URL || ''
const COQUI_MODEL = process.env.COQUI_MODEL || ''

const port = parseInt(process.argv[2], 10) || 4000

function speakWithSpdSay(text) {
  return new Promise((resolve, reject) => {
    const p = spawn('spd-say', [text], { stdio: 'ignore' })
    p.on('error', (err) => reject(err))
    p.on('close', (code) => (code === 0 ? resolve() : reject(new Error('spd-say failed'))))
  })
}

function speakWithEspeak(text) {
  return new Promise((resolve, reject) => {
    const p = spawn('espeak-ng', [text], { stdio: 'ignore' })
    p.on('error', (err) => reject(err))
    p.on('close', (code) => (code === 0 ? resolve() : reject(new Error('espeak-ng failed'))))
  })
}

async function speak(text) {
  try {
    await speakWithSpdSay(text)
  } catch (err) {
    try {
      await speakWithEspeak(text)
    } catch (err2) {
      throw err2
    }
  }
}

const server = http.createServer(async (req, res) => {
  // Basic CORS for local calls
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type')

  if (req.method === 'OPTIONS') {
    res.writeHead(204)
    return res.end()
  }

  if (req.method === 'GET' && req.url === '/ping') {
    res.writeHead(200, { 'Content-Type': 'application/json' })
    return res.end(JSON.stringify({ ok: true }))
  }

  if (req.method === 'POST' && req.url === '/speak') {
    let body = ''
    req.on('data', (chunk) => (body += chunk))
    req.on('end', async () => {
      try {
        const data = JSON.parse(body || '{}')
        const text = (data && data.text) ? String(data.text) : ''
        if (!text) {
          res.writeHead(400, { 'Content-Type': 'application/json' })
          return res.end(JSON.stringify({ error: 'missing text' }))
        }
        // If a Coqui/OpenTTS server is configured, try to proxy the request
        if (COQUI_URL) {
          try {
            const url = COQUI_URL
            const payload = COQUI_MODEL ? { text, model_name: COQUI_MODEL } : { text }
            const upstream = await fetch(url, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify(payload),
            })

            const contentType = upstream.headers.get('content-type') || ''

            // If upstream returned audio, stream to host audio player and reply OK
            if (contentType.startsWith('audio/')) {
              // Try to play via aplay (ALSA). If missing, just consume the stream.
              try {
                const player = spawn('aplay', ['-'])
                upstream.body.pipe(player.stdin)
                player.on('error', (err) => {
                  console.error('player error', err)
                })
                player.on('close', (code) => {
                  if (code !== 0) console.warn('player exited', code)
                })
              } catch (playErr) {
                // consume stream so connection completes
                await upstream.arrayBuffer()
              }

              res.writeHead(200, { 'Content-Type': 'application/json' })
              return res.end(JSON.stringify({ ok: true, proxied: true }))
            }

            // If upstream returned JSON or other text, forward it to the client
            const txt = await upstream.text()
            res.writeHead(200, { 'Content-Type': 'application/json' })
            return res.end(JSON.stringify({ ok: true, proxied: true, upstream: txt }))
          } catch (upErr) {
            console.error('Coqui/OpenTTS proxy failed:', upErr && upErr.message)
            // fallthrough to local TTS
          }
        }

        // Fallback to local system TTS
        await speak(text)
        res.writeHead(200, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ ok: true }))
      } catch (err) {
        res.writeHead(500, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ error: String(err && err.message) }))
      }
    })
    return
  }

  // Proxy endpoint that returns raw audio from upstream (if available)
  if (req.method === 'POST' && req.url === '/speak_audio') {
    let body = ''
    req.on('data', (chunk) => (body += chunk))
    req.on('end', async () => {
      try {
        if (!COQUI_URL) {
          res.writeHead(501, { 'Content-Type': 'application/json' })
          return res.end(JSON.stringify({ error: 'no COQUI_URL configured' }))
        }
        const data = JSON.parse(body || '{}')
        const text = (data && data.text) ? String(data.text) : ''
        if (!text) {
          res.writeHead(400, { 'Content-Type': 'application/json' })
          return res.end(JSON.stringify({ error: 'missing text' }))
        }
        const payload = COQUI_MODEL ? { text, model_name: COQUI_MODEL } : { text }
        const upstream = await fetch(COQUI_URL, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        })
        if (!upstream.ok) {
          res.writeHead(502, { 'Content-Type': 'application/json' })
          return res.end(JSON.stringify({ error: 'upstream error', status: upstream.status }))
        }
        const contentType = upstream.headers.get('content-type') || 'application/octet-stream'
        res.writeHead(200, { 'Content-Type': contentType })
        // Stream upstream audio directly to client
        upstream.body.pipe(res)
      } catch (err) {
        res.writeHead(500, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ error: String(err && err.message) }))
      }
    })
    return
  }

  res.writeHead(404)
  res.end()
})

server.listen(port, '127.0.0.1', () => {
  console.log(`TTS server listening on http://127.0.0.1:${port}`)
  console.log('POST JSON { "text": "..." } to /speak')
})
