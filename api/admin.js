import { getSupabase } from './_lib/supabase.js'
import {
  escapeHtml,
  groupSessions,
  renderRawPage,
  renderSessionDetail,
  renderSessionList,
} from './_lib/adminView.js'

const ADMIN_USER = process.env.ADMIN_USER
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD

// セッション一覧の集計に使うイベント数の上限。
// Supabase(PostgREST)は1リクエストで最大1000行までしか返さないため、これが実質の上限になる。
const LIST_FETCH_LIMIT = 1000

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

function sendHtml(res, html, status = 200) {
  res.setHeader('Content-Type', 'text/html; charset=utf-8')
  return res.status(status).send(html)
}

// 画面の種類:
//   (既定)            セッション一覧
//   ?session_id=...   そのセッションの会話ビュー
//   ?view=raw         従来の生ログ表（event_type / mode / session_id で絞り込み）
export default async function handler(req, res) {
  if (!checkBasicAuth(req)) {
    res.setHeader('WWW-Authenticate', 'Basic realm="Admin"')
    return res.status(401).send('Authentication required.')
  }

  const q = req.query ?? {}
  const supabase = getSupabase()
  const isRaw = q.view === 'raw'
  const sessionId = q.session_id ?? ''

  // ---- 生ログ ----
  if (isRaw) {
    const eventType = q.event_type ?? ''
    const condition = q.condition ?? ''
    const limit = Math.min(Number(q.limit) || 100, 1000)

    if (!supabase) {
      return sendHtml(res, renderRawPage({ rows: [], eventType, sessionId, condition, limit, configured: false }))
    }

    let query = supabase.from('chat_logs').select('*').order('created_at', { ascending: false }).limit(limit)
    if (eventType) query = query.eq('event_type', eventType)
    if (sessionId) query = query.eq('session_id', sessionId)
    // payload はJSONB列。 ->> でテキストとして条件を絞り込む。
    // step_change等 condition を持たないイベントは、この絞り込みでは出てこない点に注意。
    if (condition) query = query.eq('payload->>condition', condition)

    const { data, error } = await query
    if (error) return res.status(500).send(`Query failed: ${escapeHtml(error.message)}`)
    return sendHtml(res, renderRawPage({ rows: data ?? [], eventType, sessionId, condition, limit, configured: true }))
  }

  // ---- 会話ビュー ----
  if (sessionId) {
    if (!supabase) {
      return sendHtml(res, renderSessionDetail({ sessionId, summary: null, rows: [], configured: false }))
    }

    const { data, error } = await supabase
      .from('chat_logs')
      .select('*')
      .eq('session_id', sessionId)
      .order('created_at', { ascending: true })
      .limit(1000)
    if (error) return res.status(500).send(`Query failed: ${escapeHtml(error.message)}`)

    const rows = data ?? []
    const summary = groupSessions(rows)[0] ?? null
    return sendHtml(res, renderSessionDetail({ sessionId, summary, rows, configured: true }))
  }

  // ---- セッション一覧 ----
  const filters = {
    condition: q.condition ?? '',
    codeId: q.code_id ?? '',
    promptVersion: q.prompt_version ?? '',
    showEmpty: q.show_empty === '1',
  }

  if (!supabase) {
    return sendHtml(res, renderSessionList({
      sessions: [], filters, options: { codes: [], versions: [] }, truncated: false, configured: false,
    }))
  }

  const { data, error } = await supabase
    .from('chat_logs')
    .select('*')
    .in('event_type', ['session_start', 'chat', 'chat_error', 'session_complete', 'session_reopen'])
    .order('created_at', { ascending: false })
    .limit(LIST_FETCH_LIMIT)
  if (error) return res.status(500).send(`Query failed: ${escapeHtml(error.message)}`)

  const rows = data ?? []
  const all = groupSessions(rows)

  // 絞り込みの選択肢は、絞り込み前の全セッションから作る
  const options = {
    codes: [...new Set(all.map(s => s.codeId).filter(Boolean))].sort(),
    versions: [...new Set(all.map(s => s.promptVersion).filter(Boolean))].sort(),
  }

  const sessions = all.filter(s =>
    (filters.showEmpty || s.turns > 0 || s.errors > 0)
    && (!filters.condition || s.condition === filters.condition)
    && (!filters.codeId || s.codeId === filters.codeId)
    && (!filters.promptVersion || s.promptVersion === filters.promptVersion))

  return sendHtml(res, renderSessionList({
    sessions, filters, options, truncated: rows.length >= LIST_FETCH_LIMIT, configured: true,
  }))
}
