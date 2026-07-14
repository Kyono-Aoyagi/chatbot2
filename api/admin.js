import { getSupabase } from './_lib/supabase.js'

const ADMIN_USER = process.env.ADMIN_USER
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD

function checkBasicAuth(req) {
  // ADMIN_USER/ADMIN_PASSWORDが未設定なら、事故防止のため管理画面ごとアクセス拒否にする
  // （「設定忘れ＝誰でも見れる」ではなく「設定忘れ＝誰も見れない」側に倒す）
  if (!ADMIN_USER || !ADMIN_PASSWORD) return false

  const header = req.headers.authorization ?? ''
  if (!header.startsWith('Basic ')) return false

  const decoded = Buffer.from(header.slice(6), 'base64').toString('utf8')
  const separatorIndex = decoded.indexOf(':')
  const user = decoded.slice(0, separatorIndex)
  const pass = decoded.slice(separatorIndex + 1)

  return user === ADMIN_USER && pass === ADMIN_PASSWORD
}

function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

function renderPage({ rows, eventType, sessionId, limit, configured }) {
  const filterForm = `
    <form method="GET" class="filters">
      <label>event_type
        <select name="event_type">
          <option value="">(all)</option>
          ${['session_start', 'step_change', 'chat'].map(t =>
            `<option value="${t}" ${t === eventType ? 'selected' : ''}>${t}</option>`
          ).join('')}
        </select>
      </label>
      <label>session_id
        <input type="text" name="session_id" value="${escapeHtml(sessionId)}" placeholder="sess_...">
      </label>
      <label>limit
        <input type="number" name="limit" value="${limit}" min="1" max="1000">
      </label>
      <button type="submit">絞り込み</button>
    </form>
  `

  const tableRows = rows.map(row => `
    <tr>
      <td>${escapeHtml(new Date(row.created_at).toLocaleString('ja-JP'))}</td>
      <td>${escapeHtml(row.session_id)}</td>
      <td><span class="badge badge--${escapeHtml(row.event_type)}">${escapeHtml(row.event_type)}</span></td>
      <td><pre>${escapeHtml(JSON.stringify(row.payload, null, 2))}</pre></td>
    </tr>
  `).join('')

  const notConfiguredNotice = configured ? '' : `
    <p class="notice">SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY が未設定です。環境変数を設定してください。</p>
  `

  return `<!DOCTYPE html>
<html lang="ja">
<head>
  <meta charset="UTF-8">
  <title>ログ管理画面</title>
  <style>
    body { font-family: system-ui, sans-serif; margin: 0; padding: 24px; background: #f7f7f8; color: #1a1a1a; }
    h1 { font-size: 20px; margin-bottom: 16px; }
    .filters { display: flex; gap: 16px; align-items: flex-end; margin-bottom: 20px; flex-wrap: wrap; }
    .filters label { display: flex; flex-direction: column; font-size: 12px; color: #555; gap: 4px; }
    .filters input, .filters select { padding: 6px 8px; font-size: 14px; border: 1px solid #ccc; border-radius: 4px; }
    .filters button { padding: 7px 16px; font-size: 14px; border: none; border-radius: 4px; background: #1a1a1a; color: white; cursor: pointer; }
    table { width: 100%; border-collapse: collapse; background: white; border-radius: 8px; overflow: hidden; box-shadow: 0 1px 3px rgba(0,0,0,0.1); }
    th, td { text-align: left; padding: 10px 12px; font-size: 13px; border-bottom: 1px solid #eee; vertical-align: top; }
    th { background: #efefef; }
    pre { margin: 0; white-space: pre-wrap; word-break: break-word; max-width: 480px; font-size: 12px; }
    .badge { padding: 2px 8px; border-radius: 999px; font-size: 11px; background: #e0e0e0; }
    .badge--chat { background: #d7ecff; }
    .badge--session_start { background: #dcf5df; }
    .badge--step_change { background: #fff3cf; }
    .notice { color: #b00020; }
    .meta { color: #666; font-size: 12px; margin-bottom: 12px; }
  </style>
</head>
<body>
  <h1>チャットボット ログ管理画面</h1>
  ${notConfiguredNotice}
  ${filterForm}
  <p class="meta">${rows.length}件表示中</p>
  <table>
    <thead>
      <tr><th>日時</th><th>session_id</th><th>event_type</th><th>payload</th></tr>
    </thead>
    <tbody>
      ${tableRows}
    </tbody>
  </table>
</body>
</html>`
}

export default async function handler(req, res) {
  if (!checkBasicAuth(req)) {
    res.setHeader('WWW-Authenticate', 'Basic realm="Admin"')
    return res.status(401).send('Authentication required.')
  }

  const supabase = getSupabase()
  const eventType = req.query?.event_type ?? ''
  const sessionId = req.query?.session_id ?? ''
  const limit = Math.min(Number(req.query?.limit) || 100, 1000)

  if (!supabase) {
    res.setHeader('Content-Type', 'text/html; charset=utf-8')
    return res.status(200).send(renderPage({ rows: [], eventType, sessionId, limit, configured: false }))
  }

  let query = supabase
    .from('chat_logs')
    .select('*')
    .order('created_at', { ascending: false })
    .limit(limit)

  if (eventType) query = query.eq('event_type', eventType)
  if (sessionId) query = query.eq('session_id', sessionId)

  const { data, error } = await query

  if (error) {
    return res.status(500).send(`Query failed: ${escapeHtml(error.message)}`)
  }

  res.setHeader('Content-Type', 'text/html; charset=utf-8')
  return res.status(200).send(renderPage({ rows: data ?? [], eventType, sessionId, limit, configured: true }))
}
