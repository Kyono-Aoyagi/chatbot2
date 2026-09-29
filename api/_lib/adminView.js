// 管理画面(api/admin.js)の表示とセッション集計。すべて純粋関数で、DBには触れない。
// HTMLに埋め込む文字列は必ず escapeHtml を通すこと（ログにはユーザー入力・LLM出力が含まれる）。

export const CONDITION_LABELS = {
  guided: '段階的ガイド',
  free: '自由質問',
  opportunistic: '日和見',
}

export function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

// ---------- 小さな整形ヘルパー ----------

const fmtTime = iso =>
  iso ? new Date(iso).toLocaleString('ja-JP', { timeZone: 'Asia/Tokyo', hour12: false }) : '-'

function fmtDuration(ms) {
  if (!Number.isFinite(ms) || ms < 0) return '-'
  const sec = Math.round(ms / 1000)
  if (sec < 60) return `${sec}秒`
  return `${Math.floor(sec / 60)}分${sec % 60}秒`
}

// move（チューターが選んだ一手）の表示。色は道筋を一目で追うためのもの。
const MOVE_META = {
  bottom_up: { label: '割り込み', color: '#2e9e5b' },
  revisit: { label: '再訪', color: '#2b7bd6' },
  top_down: { label: 'トップダウン', color: '#7a8aa0' },
  narrow: { label: '問いを絞る', color: '#e08a1e' },
  trace: { label: '小入力で追う', color: '#c9a400' },
  switch: { label: '観点を移す', color: '#8a4fd6' },
  correct: { label: '指摘対応', color: '#d6456b' },
  other: { label: 'その他', color: '#999999' },
}

function moveChip(move, title) {
  const meta = MOVE_META[move]
  if (!meta) return `<span class="chip chip--none" title="${escapeHtml(title)}"></span>`
  return `<span class="chip" style="background:${meta.color}" title="${escapeHtml(title)}"></span>`
}

function moveBadge(move) {
  const meta = MOVE_META[move]
  if (!meta) return ''
  return `<span class="move-badge" style="background:${meta.color}">${escapeHtml(meta.label)}</span>`
}

const MENTAL_LABEL = { unresolved: '未', conjectured: '仮', confirmed: '確' }

function mentalChip(key, status) {
  const s = MENTAL_LABEL[status] ? status : 'unresolved'
  return `<span class="mental mental--${s}">${key} ${MENTAL_LABEL[s]}</span>`
}

function conditionBadge(condition) {
  if (!CONDITION_LABELS[condition]) return '<span class="badge badge--unknown">-</span>'
  return `<span class="badge badge--${condition}">${escapeHtml(CONDITION_LABELS[condition])}</span>`
}

// ---------- セッション集計 ----------

// rows: chat_logs の行（順不同でよい）。session_start / chat / chat_error だけを使う。
// 返り値: セッション要約の配列（開始が新しい順）。
export function groupSessions(rows) {
  const sorted = [...rows].sort((a, b) => new Date(a.created_at) - new Date(b.created_at))
  const map = new Map()

  for (const row of sorted) {
    if (!row.session_id) continue
    if (!['session_start', 'chat', 'chat_error'].includes(row.event_type)) continue
    if (!map.has(row.session_id)) {
      map.set(row.session_id, { id: row.session_id, start: null, startRow: null, chats: [], errors: [] })
    }
    const s = map.get(row.session_id)
    if (row.event_type === 'session_start') { s.start = row.payload ?? {}; s.startRow = row }
    else if (row.event_type === 'chat') s.chats.push(row)
    else s.errors.push(row)
  }

  return [...map.values()].map(summarizeSession).sort((a, b) => b.startedAtMs - a.startedAtMs)
}

function summarizeSession(s) {
  const allRows = [s.startRow, ...s.chats, ...s.errors].filter(Boolean)
  const times = allRows.map(r => new Date(r.created_at).getTime())
  const startedAtMs = Math.min(...times)
  const lastAtMs = Math.max(...times)

  const firstChat = s.chats[0]?.payload
  const lastChat = s.chats[s.chats.length - 1]?.payload
  const pick = key =>
    s.start?.[key] ?? s.chats.find(c => c.payload?.[key] != null)?.payload?.[key]
    ?? s.errors.find(e => e.payload?.[key] != null)?.payload?.[key]

  const condition = pick('condition')
  const codeId = pick('codeId')

  return {
    id: s.id,
    condition,
    codeId,
    title: s.start?.title ?? codeId ?? '(不明)',
    difficulty: s.start?.difficulty ?? null,
    promptVersion: firstChat?.promptVersion ?? null,
    model: firstChat?.model ?? null,
    startedAtMs,
    lastAtMs,
    startedAt: new Date(startedAtMs).toISOString(),
    durationMs: lastAtMs - startedAtMs,
    turns: s.chats.length,
    errors: s.errors.length,
    retries: s.chats.reduce((n, c) => n + (Number(c.payload?.retries) || 0), 0),
    parseFailed: s.chats.filter(c => c.payload?.parseFailed === true).length,
    moves: condition !== 'opportunistic' ? [] : s.chats.map((c, i) => ({
      turn: c.payload?.turn ?? i + 1,
      move: c.payload?.move ?? null,
      note: c.payload?.note ?? '',
    })),
    // guided/free の chat ログにも既定の mentalModel が入るため、opportunistic 以外では状態を出さない。
    finalMental: condition === 'opportunistic' ? (lastChat?.mentalModel ?? null) : null,
    lastStep: lastChat?.currentStep ?? null,
  }
}

// ---------- 共通レイアウト ----------

const CSS = `
  body { font-family: system-ui, sans-serif; margin: 0; padding: 24px; background: #f7f7f8; color: #1a1a1a; }
  h1 { font-size: 20px; margin: 0 0 12px; }
  h2 { font-size: 16px; margin: 0 0 8px; }
  a { color: #1a5fb4; }
  small, .meta { color: #666; font-size: 12px; }
  .nav { display: flex; gap: 16px; margin-bottom: 16px; font-size: 14px; }
  .nav a { text-decoration: none; padding: 4px 0; }
  .nav a.active { font-weight: 700; border-bottom: 2px solid #1a1a1a; color: #1a1a1a; }
  .filters { display: flex; gap: 16px; align-items: flex-end; margin-bottom: 16px; flex-wrap: wrap; }
  .filters label { display: flex; flex-direction: column; font-size: 12px; color: #555; gap: 4px; }
  .filters label.inline { flex-direction: row; align-items: center; }
  .filters input, .filters select { padding: 6px 8px; font-size: 14px; border: 1px solid #ccc; border-radius: 4px; }
  .filters button { padding: 7px 16px; font-size: 14px; border: none; border-radius: 4px; background: #1a1a1a; color: #fff; cursor: pointer; }
  table { width: 100%; border-collapse: collapse; background: #fff; border-radius: 8px; overflow: hidden; box-shadow: 0 1px 3px rgba(0,0,0,.1); }
  th, td { text-align: left; padding: 9px 12px; font-size: 13px; border-bottom: 1px solid #eee; vertical-align: top; }
  th { background: #efefef; white-space: nowrap; }
  pre { margin: 0; white-space: pre-wrap; word-break: break-word; font-size: 12px; }
  .badge { padding: 2px 8px; border-radius: 999px; font-size: 11px; background: #e0e0e0; white-space: nowrap; }
  .badge--chat { background: #d7ecff; }
  .badge--chat_error { background: #ffd6d6; color: #8a0000; }
  .badge--session_start { background: #dcf5df; }
  .badge--step_change { background: #fff3cf; }
  .badge--guided { background: #ffe1c2; color: #7a3e00; font-weight: 600; }
  .badge--free { background: #e3d9ff; color: #3d1a8a; font-weight: 600; }
  .badge--opportunistic { background: #d7f5e3; color: #0f6b3a; font-weight: 600; }
  .badge--unknown { color: #999; }
  .badge--warn { background: #fff0c2; color: #6b4b00; }
  .badge--err { background: #ffd6d6; color: #8a0000; }
  .notice { color: #b00020; }
  .chip { display: inline-block; width: 14px; height: 14px; border-radius: 3px; margin-right: 3px; vertical-align: middle; }
  .chip--none { background: #ddd; }
  .band { white-space: nowrap; }
  .legend { display: flex; flex-wrap: wrap; gap: 12px; font-size: 12px; color: #555; margin-bottom: 12px; }
  .legend .chip { margin-right: 4px; }
  .mental { display: inline-block; padding: 1px 7px; border-radius: 4px; font-size: 12px; margin-right: 4px; }
  .mental--unresolved { background: #e6e6e6; color: #555; }
  .mental--conjectured { background: #fff0c2; color: #6b4b00; }
  .mental--confirmed { background: #d7f5e3; color: #0f6b3a; }
  .move-badge { color: #fff; padding: 1px 8px; border-radius: 4px; font-size: 12px; margin-right: 6px; }
  .session-head { background: #fff; border-radius: 8px; padding: 14px 16px; margin-bottom: 16px; box-shadow: 0 1px 3px rgba(0,0,0,.1); font-size: 13px; line-height: 1.8; }
  .turn { margin-bottom: 18px; max-width: 860px; }
  .turn-label { font-size: 11px; color: #888; margin-bottom: 4px; }
  .bubble { padding: 10px 14px; border-radius: 10px; font-size: 14px; line-height: 1.6; white-space: pre-wrap; word-break: break-word; margin-bottom: 6px; }
  .bubble--user { background: #dbeafe; margin-right: 15%; }
  .bubble--bot { background: #fff; box-shadow: 0 1px 3px rgba(0,0,0,.1); margin-left: 8%; }
  .bot-meta { margin-left: 8%; font-size: 12px; color: #555; line-height: 1.7; }
  .state { margin-left: 8%; font-size: 12px; color: #444; background: #f0f0f2; border-radius: 6px; padding: 6px 10px; margin-top: 4px; }
  .state ul { margin: 4px 0 0; padding-left: 18px; }
  .state .dim { color: #999; }
  .state .changed { font-weight: 600; }
  .error-box { margin-left: 8%; background: #fff0f0; border: 1px solid #f0b4b4; color: #8a0000; border-radius: 8px; padding: 8px 12px; font-size: 13px; margin-bottom: 12px; }
  details { margin-left: 8%; font-size: 12px; margin-top: 4px; }
  details summary { cursor: pointer; color: #777; }
`

function renderLayout({ title, active, body }) {
  return `<!DOCTYPE html>
<html lang="ja">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${escapeHtml(title)}</title>
  <style>${CSS}</style>
</head>
<body>
  <h1>チャットボット ログ管理画面</h1>
  <nav class="nav">
    <a href="?" class="${active === 'list' ? 'active' : ''}">セッション一覧</a>
    <a href="?view=raw" class="${active === 'raw' ? 'active' : ''}">生ログ</a>
  </nav>
  ${body}
</body>
</html>`
}

function notConfiguredNotice(configured) {
  return configured
    ? ''
    : '<p class="notice">SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY が未設定です。環境変数を設定してください。</p>'
}

// ---------- セッション一覧 ----------

export function renderSessionList({ sessions, filters, options, truncated, configured }) {
  const legend = Object.values(MOVE_META)
    .map(m => `<span><span class="chip" style="background:${m.color}"></span>${escapeHtml(m.label)}</span>`)
    .join('')

  const select = (name, label, values, current, labelOf = v => v) => `
    <label>${label}
      <select name="${name}">
        <option value="">(all)</option>
        ${values.map(v => `<option value="${escapeHtml(v)}" ${v === current ? 'selected' : ''}>${escapeHtml(labelOf(v))}</option>`).join('')}
      </select>
    </label>`

  const form = `
    <form method="GET" class="filters">
      ${select('condition', 'mode', Object.keys(CONDITION_LABELS), filters.condition, c => CONDITION_LABELS[c])}
      ${select('code_id', '問題', options.codes, filters.codeId)}
      ${select('prompt_version', 'プロンプト版', options.versions, filters.promptVersion)}
      <label class="inline"><input type="checkbox" name="show_empty" value="1" ${filters.showEmpty ? 'checked' : ''}>ターン0も表示</label>
      <button type="submit">絞り込み</button>
    </form>`

  const rows = sessions.map(s => {
    const band = s.moves.length
      ? s.moves.map(m => moveChip(m.move, `ターン${m.turn}: ${MOVE_META[m.move]?.label ?? '-'}${m.note ? ' / ' + m.note : ''}`)).join('')
      : '-'
    const progress = s.finalMental
      ? `${mentalChip('why', s.finalMental.why)}${mentalChip('how', s.finalMental.how)}`
      : (s.lastStep ? `<small>step: ${escapeHtml(s.lastStep)}</small>` : '-')
    const issues = [
      s.errors ? `<span class="badge badge--err">エラー ${s.errors}</span>` : '',
      s.retries ? `<span class="badge badge--warn">リトライ ${s.retries}</span>` : '',
      s.parseFailed ? `<span class="badge badge--warn">解析失敗 ${s.parseFailed}</span>` : '',
    ].join(' ') || '-'

    return `
    <tr>
      <td>${escapeHtml(fmtTime(s.startedAt))}</td>
      <td>${escapeHtml(s.title)}${s.difficulty ? `<br><small>難易度 ${escapeHtml(s.difficulty)}</small>` : ''}</td>
      <td>${conditionBadge(s.condition)}</td>
      <td>${s.turns}</td>
      <td>${escapeHtml(fmtDuration(s.durationMs))}</td>
      <td>${progress}</td>
      <td class="band">${band}</td>
      <td>${issues}</td>
      <td><small>${escapeHtml(s.promptVersion ?? '-')}</small></td>
      <td><a href="?session_id=${encodeURIComponent(s.id)}">開く</a></td>
    </tr>`
  }).join('')

  const body = `
    ${notConfiguredNotice(configured)}
    ${form}
    <div class="legend">${legend}</div>
    <p class="meta">${sessions.length}セッション表示中${truncated ? '（直近のイベントのみ集計。古いセッションは一部欠けている可能性があります）' : ''}</p>
    <table>
      <thead>
        <tr><th>開始</th><th>問題</th><th>mode</th><th>ターン</th><th>所要</th><th>最終状態</th><th>道筋（move）</th><th>問題点</th><th>プロンプト版</th><th></th></tr>
      </thead>
      <tbody>${rows}</tbody>
    </table>`

  return renderLayout({ title: 'セッション一覧', active: 'list', body })
}

// ---------- 会話ビュー ----------

const INITIAL_MENTAL = { why: 'unresolved', how: 'unresolved' }

function renderMentalDiff(prev, next) {
  return ['why', 'how'].map(key => {
    const before = prev?.[key] ?? 'unresolved'
    const after = next?.[key] ?? 'unresolved'
    if (before === after) return `<span class="dim">${mentalChip(key, after)}</span>`
    return `<span class="changed">${mentalChip(key, before)}→${mentalChip(key, after)}</span>`
  }).join(' ')
}

function renderQuestionDiff(prevList, nextList) {
  const prevMap = new Map((prevList ?? []).map(q => [q.id, q]))
  const nextIds = new Set((nextList ?? []).map(q => q.id))
  const items = []

  for (const q of nextList ?? []) {
    const label = `[${escapeHtml(q.level)}] ${escapeHtml(q.target)}`
    const before = prevMap.get(q.id)
    if (!before) items.push(`<li class="changed">＋ ${label}（${escapeHtml(q.status)}）</li>`)
    else if (before.status !== q.status) items.push(`<li class="changed">${label}：${escapeHtml(before.status)} → ${escapeHtml(q.status)}</li>`)
    else items.push(`<li class="dim">${label}（${escapeHtml(q.status)}）</li>`)
  }
  for (const q of prevList ?? []) {
    if (!nextIds.has(q.id)) items.push(`<li class="changed">－ [${escapeHtml(q.level)}] ${escapeHtml(q.target)}（削除）</li>`)
  }
  return items.length ? `<ul>${items.join('')}</ul>` : ''
}

// summary: summarizeSession の結果（groupSessions 経由で得たもの）
// rows: そのセッションの chat_logs 行（順不同でよい）
export function renderSessionDetail({ sessionId, summary, rows, configured }) {
  const events = [...rows]
    .filter(r => r.event_type === 'chat' || r.event_type === 'chat_error')
    .sort((a, b) => new Date(a.created_at) - new Date(b.created_at))

  let prevMental = INITIAL_MENTAL
  let prevQuestions = []
  let counter = 0

  const turns = events.map(row => {
    const p = row.payload ?? {}
    const time = escapeHtml(fmtTime(row.created_at))

    if (row.event_type === 'chat_error') {
      return `
      <div class="turn">
        <div class="turn-label">${time} ・ 送信に失敗（発言: ${escapeHtml(p.userMessage ?? '')}）</div>
        <div class="error-box">
          エラー（${p.transient ? '一時的' : 'その他'}・リトライ ${escapeHtml(p.retries ?? 0)}回）<br>
          <small>${escapeHtml(p.errorMessage ?? '')}</small>
        </div>
      </div>`
    }

    counter += 1
    const isOpp = p.condition === 'opportunistic'
    const metaParts = []
    if (isOpp) {
      metaParts.push(`${moveBadge(p.move)}${p.note ? escapeHtml(p.note) : ''}`)
    } else if (p.currentStep) {
      metaParts.push(`step: ${escapeHtml(p.currentStep)} ・ ${p.advance ? '次へ進んだ' : '留まった'}`)
    }
    if (p.parseFailed) metaParts.push('<span class="badge badge--warn">JSON解析失敗</span>')
    if (p.retries) metaParts.push(`<span class="badge badge--warn">リトライ ${escapeHtml(p.retries)}回</span>`)

    let stateHtml = ''
    if (isOpp && p.mentalModel) {
      stateHtml = `<div class="state">${renderMentalDiff(prevMental, p.mentalModel)}${renderQuestionDiff(prevQuestions, p.openQuestions)}</div>`
      prevMental = p.mentalModel
      prevQuestions = p.openQuestions ?? []
    }

    return `
      <div class="turn">
        <div class="turn-label">ターン ${escapeHtml(p.turn ?? counter)} ・ ${time}</div>
        <div class="bubble bubble--user">${escapeHtml(p.userMessage)}</div>
        <div class="bubble bubble--bot">${escapeHtml(p.reply)}</div>
        ${metaParts.length ? `<div class="bot-meta">${metaParts.join(' ')}</div>` : ''}
        ${stateHtml}
        <details><summary>生ログ</summary><pre>${escapeHtml(JSON.stringify(p, null, 2))}</pre></details>
      </div>`
  }).join('')

  const head = summary
    ? `
    <div class="session-head">
      <div><strong>${escapeHtml(summary.title)}</strong>${summary.difficulty ? `（難易度 ${escapeHtml(summary.difficulty)}）` : ''} ・ ${conditionBadge(summary.condition)}</div>
      <div>開始 ${escapeHtml(fmtTime(summary.startedAt))} ・ 所要 ${escapeHtml(fmtDuration(summary.durationMs))} ・ ${summary.turns}ターン</div>
      <div><small>プロンプト版 ${escapeHtml(summary.promptVersion ?? '-')} ・ モデル ${escapeHtml(summary.model ?? '-')} ・ ${escapeHtml(sessionId)}</small></div>
      <div class="band">${summary.moves.map(m => moveChip(m.move, `ターン${m.turn}: ${MOVE_META[m.move]?.label ?? '-'}`)).join('')}</div>
    </div>`
    : `<div class="session-head">${escapeHtml(sessionId)}（該当するログがありません）</div>`

  const body = `
    ${notConfiguredNotice(configured)}
    <p><a href="?">← セッション一覧に戻る</a></p>
    ${head}
    ${turns || '<p class="meta">chat イベントがありません。</p>'}`

  return renderLayout({ title: `セッション ${sessionId}`, active: 'list', body })
}

// ---------- 生ログ（従来の表） ----------

export function renderRawPage({ rows, eventType, sessionId, condition, limit, configured }) {
  const eventTypes = ['session_start', 'chat', 'chat_error', 'result_shown', 'step_change', 'mental_state_change']

  const form = `
    <form method="GET" class="filters">
      <input type="hidden" name="view" value="raw">
      <label>event_type
        <select name="event_type">
          <option value="">(all)</option>
          ${eventTypes.map(t => `<option value="${t}" ${t === eventType ? 'selected' : ''}>${t}</option>`).join('')}
        </select>
      </label>
      <label>mode
        <select name="condition">
          <option value="">(all)</option>
          ${Object.keys(CONDITION_LABELS).map(c => `<option value="${c}" ${c === condition ? 'selected' : ''}>${escapeHtml(CONDITION_LABELS[c])}</option>`).join('')}
        </select>
      </label>
      <label>session_id
        <input type="text" name="session_id" value="${escapeHtml(sessionId)}" placeholder="sess_...">
      </label>
      <label>limit
        <input type="number" name="limit" value="${escapeHtml(limit)}" min="1" max="1000">
      </label>
      <button type="submit">絞り込み</button>
    </form>`

  const tableRows = rows.map(row => `
    <tr>
      <td>${escapeHtml(fmtTime(row.created_at))}</td>
      <td>${escapeHtml(row.session_id)}</td>
      <td><span class="badge badge--${escapeHtml(row.event_type)}">${escapeHtml(row.event_type)}</span></td>
      <td>${conditionBadge(row.payload?.condition)}</td>
      <td><pre>${escapeHtml(JSON.stringify(row.payload, null, 2))}</pre></td>
    </tr>`).join('')

  const body = `
    ${notConfiguredNotice(configured)}
    ${form}
    <p class="meta">${rows.length}件表示中</p>
    <table>
      <thead><tr><th>日時</th><th>session_id</th><th>event_type</th><th>mode</th><th>payload</th></tr></thead>
      <tbody>${tableRows}</tbody>
    </table>`

  return renderLayout({ title: '生ログ', active: 'raw', body })
}
