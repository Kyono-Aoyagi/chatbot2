/**
 * バックエンドサーバー
 * - Anthropic API のプロキシ（APIキーをフロントに露出させない）
 * - セッションログの永続化（JSON Lines形式）
 *
 * 将来の拡張ポイント:
 *   - 認証（ユーザーID管理）
 *   - DBへのログ移行（SQLite → PostgreSQL）
 *   - 課題管理API（コードサンプルのCRUD）
 */

import http from 'http'
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const PORT = 3001
const LOG_DIR = path.join(__dirname, '..', 'logs')

// ログディレクトリが無ければ作成
if (!fs.existsSync(LOG_DIR)) fs.mkdirSync(LOG_DIR, { recursive: true })

// --- ユーティリティ ---

function readBody(req) {
  return new Promise((resolve, reject) => {
    let body = ''
    req.on('data', chunk => (body += chunk))
    req.on('end', () => {
      try { resolve(JSON.parse(body)) } catch { reject(new Error('Invalid JSON')) }
    })
    req.on('error', reject)
  })
}

function send(res, status, data) {
  const json = JSON.stringify(data)
  res.writeHead(status, {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type',
  })
  res.end(json)
}

// --- ログ ---

/**
 * セッションログをJSON Lines形式で追記保存
 * ファイル名: logs/YYYY-MM-DD.jsonl
 * 各行: { timestamp, sessionId, role, content, metadata }
 */
function appendLog(entry) {
  const date = new Date().toISOString().slice(0, 10)
  const file = path.join(LOG_DIR, `${date}.jsonl`)
  const line = JSON.stringify({ ...entry, timestamp: new Date().toISOString() }) + '\n'
  fs.appendFileSync(file, line, 'utf8')
}

/**
 * ログ一覧を返す（日付フィルタ対応）
 */
function readLogs(date) {
  const file = path.join(LOG_DIR, `${date}.jsonl`)
  if (!fs.existsSync(file)) return []
  return fs.readFileSync(file, 'utf8')
    .split('\n')
    .filter(Boolean)
    .map(l => JSON.parse(l))
}

// --- Anthropic API プロキシ ---

async function callAnthropic(messages, systemPrompt) {
  const apiKey = process.env.ANTHROPIC_API_KEY
  if (!apiKey) throw new Error('ANTHROPIC_API_KEY が設定されていません')

  const body = JSON.stringify({
    model: 'claude-sonnet-4-6',
    max_tokens: 1024,
    system: systemPrompt,
    messages,
  })

  // Node 18+ built-in fetch
  const response = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
    },
    body,
  })

  if (!response.ok) {
    const err = await response.text()
    throw new Error(`Anthropic API エラー: ${err}`)
  }

  return response.json()
}

// --- ルーティング ---

const server = http.createServer(async (req, res) => {
  // CORS preflight
  if (req.method === 'OPTIONS') {
    res.writeHead(204, {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
    })
    return res.end()
  }

  const url = new URL(req.url, `http://localhost:${PORT}`)

  try {
    // POST /api/chat  → Anthropic API に転送 & ログ記録
    if (req.method === 'POST' && url.pathname === '/api/chat') {
      const { messages, systemPrompt, sessionId, codeContext } = await readBody(req)

      // ユーザーの最新メッセージをログ
      const lastUser = messages[messages.length - 1]
      appendLog({
        sessionId,
        role: 'user',
        content: lastUser?.content ?? '',
        metadata: { codeSnippet: codeContext?.selectedText ?? null },
      })

      const data = await callAnthropic(messages, systemPrompt)
      const reply = data.content?.[0]?.text ?? ''

      // アシスタントの返答をログ
      appendLog({ sessionId, role: 'assistant', content: reply, metadata: {} })

      return send(res, 200, { reply })
    }

    // POST /api/log  → 任意のイベントをログ（ハイライト操作など）
    if (req.method === 'POST' && url.pathname === '/api/log') {
      const body = await readBody(req)
      appendLog(body)
      return send(res, 200, { ok: true })
    }

    // GET /api/logs?date=YYYY-MM-DD  → ログ取得
    if (req.method === 'GET' && url.pathname === '/api/logs') {
      const date = url.searchParams.get('date') || new Date().toISOString().slice(0, 10)
      const logs = readLogs(date)
      return send(res, 200, { logs })
    }

    send(res, 404, { error: 'Not found' })
  } catch (err) {
    console.error(err)
    send(res, 500, { error: err.message })
  }
})

server.listen(PORT, () => console.log(`サーバー起動: http://localhost:${PORT}`))
