import http from 'http'
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const PORT = Number(process.env.PORT || 3001)
const LOG_DIR = path.join(__dirname, '..', 'logs')

fs.mkdirSync(LOG_DIR, { recursive: true })

function sendJson(res, status, data) {
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  })
  res.end(JSON.stringify(data))
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let body = ''
    req.on('data', chunk => {
      body += chunk
      if (body.length > 2_000_000) {
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

function appendLog(entry) {
  const date = new Date().toISOString().slice(0, 10)
  const filePath = path.join(LOG_DIR, `${date}.jsonl`)
  const line = JSON.stringify({
    timestamp: new Date().toISOString(),
    ...entry,
  }) + '\n'
  fs.appendFileSync(filePath, line, 'utf8')
}

function readLogs(date) {
  const filePath = path.join(LOG_DIR, `${date}.jsonl`)
  if (!fs.existsSync(filePath)) return []

  return fs.readFileSync(filePath, 'utf8')
    .split('\n')
    .filter(Boolean)
    .map(line => JSON.parse(line))
}

function buildUserContent(userText, codeContext = {}) {
  const blocks = []
  if (codeContext.code) {
    blocks.push(`対象コード:\n\`\`\`${codeContext.language || ''}\n${codeContext.code}\n\`\`\``)
  }
  if (codeContext.selectedText) {
    blocks.push(`選択範囲:\n\`\`\`\n${codeContext.selectedText}\n\`\`\``)
  }
  blocks.push(`学習者の発言:\n${userText}`)
  return blocks.join('\n\n')
}

function fallbackReply({ codeContext, userText }) {
  if (codeContext?.selectedText) {
    return '選択した範囲に注目すると、そこで変化している値は何でしょうか？その値が直前と直後でどう変わるかを、1行ずつ追ってみましょう。'
  }

  if (userText?.trim()) {
    return 'その見方はよさそうです。次に、このコードで最初に状態が変わる場所はどこだと思いますか？変数名と行の役割を手がかりに探してみましょう。'
  }

  return 'まず、このコード全体の目的は何に見えますか？根拠になりそうな関数名や最後の出力行を探してみましょう。'
}

async function callAnthropic({ messages, systemPrompt, codeContext }) {
  const apiKey = process.env.ANTHROPIC_API_KEY
  if (!apiKey) {
    return fallbackReply({
      codeContext,
      userText: messages.at(-1)?.content ?? '',
    })
  }

  const apiMessages = [...messages]
  const last = apiMessages.at(-1)
  if (last?.role === 'user') {
    last.content = buildUserContent(last.content, codeContext)
  }

  const response = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: process.env.ANTHROPIC_MODEL || 'claude-sonnet-4-20250514',
      max_tokens: 700,
      system: systemPrompt,
      messages: apiMessages,
    }),
  })

  if (!response.ok) {
    const detail = await response.text()
    throw new Error(`Anthropic API error: ${detail}`)
  }

  const data = await response.json()
  return data.content?.[0]?.text ?? fallbackReply({ codeContext })
}

const server = http.createServer(async (req, res) => {
  if (req.method === 'OPTIONS') {
    return sendJson(res, 204, {})
  }

  const url = new URL(req.url, `http://localhost:${PORT}`)

  try {
    if (req.method === 'POST' && url.pathname === '/api/log') {
      const body = await readBody(req)
      appendLog({
        type: 'event',
        ...body,
      })
      return sendJson(res, 200, { ok: true })
    }

    if (req.method === 'POST' && url.pathname === '/api/chat') {
      const body = await readBody(req)
      const messages = Array.isArray(body.messages) ? body.messages : []
      const codeContext = body.codeContext ?? {}
      const lastUser = messages.filter(message => message.role === 'user').at(-1)

      appendLog({
        type: 'chat',
        sessionId: body.sessionId,
        role: 'user',
        content: lastUser?.content ?? '',
        metadata: {
          settings: body.settings ?? {},
          language: codeContext.language,
          selectedText: codeContext.selectedText || null,
          codeLength: codeContext.code?.length ?? 0,
        },
      })

      const reply = await callAnthropic({
        messages,
        systemPrompt: body.systemPrompt,
        codeContext,
      })

      appendLog({
        type: 'chat',
        sessionId: body.sessionId,
        role: 'assistant',
        content: reply,
        metadata: {},
      })

      return sendJson(res, 200, { reply })
    }

    if (req.method === 'GET' && url.pathname === '/api/logs') {
      const date = url.searchParams.get('date') || new Date().toISOString().slice(0, 10)
      return sendJson(res, 200, { logs: readLogs(date) })
    }

    return sendJson(res, 404, { error: 'Not found' })
  } catch (error) {
    console.error(error)
    return sendJson(res, 500, { error: error.message })
  }
})

server.listen(PORT, () => {
  console.log(`Server listening on http://localhost:${PORT}`)
})
