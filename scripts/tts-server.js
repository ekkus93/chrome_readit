#!/usr/bin/env node
// Simple local TTS server that accepts POST /speak with JSON { text }
// and calls `spd-say` (or `espeak-ng` if spd-say is not available).
// Usage: node scripts/tts-server.js [port]

const http = require('http')
const { spawn } = require('child_process')
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

  res.writeHead(404)
  res.end()
})

server.listen(port, '127.0.0.1', () => {
  console.log(`TTS server listening on http://127.0.0.1:${port}`)
  console.log('POST JSON { "text": "..." } to /speak')
})
