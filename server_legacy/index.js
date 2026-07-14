import http from 'http'
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'
import { askGemini } from './gemini.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const PORT = Number(process.env.PORT || 3001)
const LOG_DIR = path.join(__dirname, '..', 'logs')

fs.mkdirSync(LOG_DIR, { recursive: true })

function sendJson(res, status, data) {
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
  })
  res.end(JSON.stringify(data))
}

function readJson(req) {
  return new Promise((resolve, reject) => {
    let body = ''
    req.on('data', chunk => {
      body += chunk
      if (body.length > 1_000_000) {
        reject(new Error('Request body is too large'))
        req.destroy()
      }
    })
    req.on('end', () => {
      if (!body) return resolve({})
      try {
        resolve(JSON.parse(body))
      } catch {
        reject(new Error('Invalid JSON'))
      }
    })
    req.on('error', reject)
  })
}

function appendLog(event) {
  const date = new Date().toISOString().slice(0, 10)
  const filePath = path.join(LOG_DIR, `${date}.jsonl`)
  const entry = { timestamp: new Date().toISOString(), ...event }
  fs.appendFileSync(filePath, JSON.stringify(entry) + '\n', 'utf8')
}

const server = http.createServer(async (req, res) => {
  if (req.method === 'OPTIONS') {
    return sendJson(res, 204, {})
  }

  const url = new URL(req.url, `http://localhost:${PORT}`)

  try {
    if (req.method === 'POST' && url.pathname === '/api/chat') {
      const body = await readJson(req)
      const { activeCode, currentStep, userMessage, sessionId } = body

      if (!activeCode?.code || !userMessage || !sessionId) {
        return sendJson(res, 400, { error: 'activeCode.code と userMessage と sessionId は必須です。' })
      }

      const t0 = Date.now()
      const { reply, advance, chatReadyMs, apiCallMs } = await askGemini({
        sessionId,
        activeCode,
        currentStep,
        userMessage,
      })
      const totalMs = Date.now() - t0

      appendLog({
        sessionId,
        eventType: 'chat',
        currentStep,
        userMessage,
        reply,
        advance,
        totalMs,
        chatReadyMs,
        apiCallMs,
      })

      return sendJson(res, 200, { reply, advance })
    }

    if (req.method === 'POST' && url.pathname === '/api/log') {
      const event = await readJson(req)
      appendLog(event)
      return sendJson(res, 200, { ok: true })
    }

    return sendJson(res, 404, { error: 'Not found' })
  } catch (error) {
    console.error('[server error]', error)
    return sendJson(res, 500, { error: error.message })
  }
})

server.listen(PORT, () => {
  console.log(`Server listening on http://localhost:${PORT}`)
})
