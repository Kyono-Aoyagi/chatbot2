// opportunistic条件の「状態」に関するロジック（DBにもLLMにも触れない純粋関数）。
//
// 状態（tutorState）はサーバーレスなのでクライアントが保持し、毎回送受信する。
//   expectationStates: [{ id, status, evidence }]  期待（ユーザーに自分の言葉で言ってほしい内容）ごとの到達度
//                       status: missing | partial | covered。covered には evidence（ユーザーの発言の一部）が要る
//   trapStates       : [{ id, status }]            罠（誤解）ごとの状態。untouched | triggered | cleared
//   focus            : { target, level } | null    前ターンの返答が取り上げた期待/罠のidと、そのとき使った支援段階(0〜3)
//   phase            : 'reading' | 'done'
//   pendingWrapUp    : boolean                     終了条件を満たしたが、返答が締めくくりでなかった（次ターンに締めくくらせる）
//
// 期待は e1, e2, ...（activeCode.expectations の並び順）、罠は t1, t2, ...（activeCode.traps の並び順）。
// 読解の「終了」は、LLMの申告ではなく、この状態からサーバーが決める（evaluateCompletion / settleOpportunisticState）。

const MAX_EXPECTATIONS = 6
const MAX_TRAPS = 5
export const MAX_LEVEL = 3
export const LADDER = ['pump', 'hint', 'prompt', 'assertion']

// 問題に expectations が無い場合（ユーザー貼付コードなど）の既定。
const DEFAULT_EXPECTATIONS = [
  'コード全体の目的（何を受け取り、何を返すか）を自分の言葉で説明できる',
  '処理の流れ（どう実現しているか）を、コード上の根拠（変数・処理）を挙げて説明できる',
]

const EXPECTATION_STATUS = new Set(['missing', 'partial', 'covered'])
const TRAP_STATUS = new Set(['untouched', 'triggered', 'cleared'])
const USER_ACTS = new Set(['answer', 'claim', 'question', 'dont_know', 'complaint', 'chitchat', 'ack'])
const VALID_MOVE = new Set(['pump', 'hint', 'prompt', 'assertion', 'answer', 'feedback', 'repair', 'wrap_up', 'other'])

// 進み具合の順位（支援段階を上げるかどうかの判定に使う）
const RANK = { missing: 0, partial: 1, covered: 2, untouched: 0, triggered: 0, cleared: 2 }

// 締めくくりが出なかったときの代わりのメッセージ（forcedWrapUp）
export const FORCED_WRAP_UP_REPLY =
  'ここまでの説明で、このコードの要点は押さえられていると判断しました。このあとも質問は自由にできます。'

// ---------- 期待・罠のリスト ----------

export function buildExpectationList(activeCode) {
  const own = Array.isArray(activeCode?.expectations)
    ? activeCode.expectations.filter(t => typeof t === 'string' && t.trim())
    : []
  return (own.length ? own : DEFAULT_EXPECTATIONS)
    .slice(0, MAX_EXPECTATIONS)
    .map((text, i) => ({ id: `e${i + 1}`, text }))
}

export function buildTrapList(activeCode) {
  const traps = Array.isArray(activeCode?.traps) ? activeCode.traps.slice(0, MAX_TRAPS) : []
  return traps.map((text, i) => ({ id: `t${i + 1}`, text: String(text) }))
}

// ---------- 正規化（クライアントから来た信用できない状態を、リストに合わせて整える） ----------

export function normalizeExpectationStates(candidate, list) {
  const byId = new Map(
    Array.isArray(candidate) ? candidate.filter(s => s && typeof s.id === 'string').map(s => [s.id, s]) : [],
  )
  return list.map(e => {
    const s = byId.get(e.id)
    return {
      id: e.id,
      status: EXPECTATION_STATUS.has(s?.status) ? s.status : 'missing',
      evidence: typeof s?.evidence === 'string' ? s.evidence.slice(0, 80) : null,
    }
  })
}

export function normalizeTrapStates(candidate, list) {
  const byId = new Map(
    Array.isArray(candidate) ? candidate.filter(s => s && typeof s.id === 'string').map(s => [s.id, s.status]) : [],
  )
  return list.map(t => ({
    id: t.id,
    status: TRAP_STATUS.has(byId.get(t.id)) ? byId.get(t.id) : 'untouched',
  }))
}

function normalizeFocus(candidate, expectationList, trapList) {
  if (!candidate || typeof candidate.target !== 'string') return null
  const known = [...expectationList, ...trapList].some(x => x.id === candidate.target)
  if (!known) return null
  const level = Number.isInteger(candidate.level) ? Math.min(Math.max(candidate.level, 0), MAX_LEVEL) : 0
  return { target: candidate.target, level }
}

export function normalizeTutorState(candidate, { expectationList, trapList }) {
  const phase = candidate?.phase === 'done' ? 'done' : 'reading'
  return {
    expectationStates: normalizeExpectationStates(candidate?.expectationStates, expectationList),
    trapStates: normalizeTrapStates(candidate?.trapStates, trapList),
    focus: normalizeFocus(candidate?.focus, expectationList, trapList),
    phase,
    pendingWrapUp: phase === 'reading' && candidate?.pendingWrapUp === true,
  }
}

// ---------- LLM出力のサニタイズ ----------

// ログ分析用タグ。不正値・未指定は null。
export function sanitizeMove(candidate) {
  return VALID_MOVE.has(candidate) ? candidate : null
}

export function sanitizeUserAct(candidate) {
  return USER_ACTS.has(candidate) ? candidate : null
}

const squash = s => String(s ?? '').replace(/\s+/g, '')

// evidence が、実際にユーザーが言った言葉に含まれているか（LLMが根拠を捏造していないかの検査）。
function evidenceInUserTexts(evidence, userTexts) {
  const e = squash(evidence)
  return e.length >= 2 && userTexts.some(t => squash(t).includes(e))
}

// 期待の更新を反映する。covered にするには、ユーザーの発言に実在する evidence が要る。
// 満たさない covered は partial に下げる（すでに covered だった場合はそのまま）。
// 戻り値: { states, downgraded }（downgraded は下げた期待のid）
export function applyExpectationUpdates(prevStates, updates, list, userTexts) {
  const states = normalizeExpectationStates(prevStates, list)
  const downgraded = []
  for (const u of Array.isArray(updates) ? updates : []) {
    const target = states.find(s => s.id === u?.id)
    if (!target || !EXPECTATION_STATUS.has(u.status)) continue
    if (u.status === 'covered' && !evidenceInUserTexts(u.evidence, userTexts)) {
      downgraded.push(target.id)
      if (target.status !== 'covered') target.status = 'partial'
      continue
    }
    target.status = u.status
    if (typeof u.evidence === 'string' && u.evidence.trim()) target.evidence = u.evidence.slice(0, 80)
  }
  return { states, downgraded }
}

export function applyTrapUpdates(prevStates, updates, list) {
  const states = normalizeTrapStates(prevStates, list)
  for (const u of Array.isArray(updates) ? updates : []) {
    const target = states.find(s => s.id === u?.id)
    if (target && TRAP_STATUS.has(u.status)) target.status = u.status
  }
  return states
}

// ---------- 終了条件 ----------

// 終了条件: すべての期待が covered で、triggered（誤解の兆候が出て未解消）の罠が無い。
// untouched の罠は終了を妨げない（罠を確認するために、ユーザーが触れていない点を探し回らせないため）。
// 戻り値: { ok, gaps }  gaps は満たせていない理由（ログと「理解できた」ボタンの記録に使う）。
export function evaluateCompletion({ expectationStates, trapStates }) {
  const gaps = []
  for (const e of expectationStates ?? []) {
    if (e.status !== 'covered') gaps.push(`期待が未到達: ${e.id}（${e.status}）`)
  }
  for (const t of trapStates ?? []) {
    if (t.status === 'triggered') gaps.push(`罠が未解消: ${t.id}`)
  }
  return { ok: gaps.length === 0, gaps }
}

// ---------- 焦点と支援段階 ----------

const statusOf = (id, { expectationStates, trapStates }) =>
  expectationStates.find(s => s.id === id)?.status ?? trapStates.find(s => s.id === id)?.status ?? null

// 今回の返答が取り上げた焦点（期待/罠のid）と、そのとき使った支援段階。
// 同じ焦点を続けて前進しなかったら段階を一つ上げる（上限 assertion）。前進したなら据え置く。別の焦点なら 0（pump）から。
// 解決済み（covered / cleared）の対象は焦点にしない。
export function computeFocus({ prevFocus, focusId, prev, next }) {
  if (typeof focusId !== 'string') return null
  const nextStatus = statusOf(focusId, next)
  if (nextStatus === null || RANK[nextStatus] >= 2) return null
  if (prevFocus?.target !== focusId) return { target: focusId, level: 0 }
  const progressed = RANK[nextStatus] > RANK[statusOf(focusId, prev) ?? 'missing']
  return { target: focusId, level: progressed ? prevFocus.level : Math.min(prevFocus.level + 1, MAX_LEVEL) }
}

// ---------- 状態の確定 ----------

// LLMの出力（parsed）と直前の状態から、次の状態を決める。
// - 読解中: 更新後に終了条件を満たし、かつ move が wrap_up なら終了。満たしたのに締めくくっていなければ pendingWrapUp にして、
//   次ターンに締めくくらせる（それでも締めくくらなければ forcedWrapUp で打ち切る）。
// - 完了後: reopen が無い限り状態は凍結（チューターが新しい問いを作らない）。reopen は、罠が triggered か期待が未到達に戻ったときだけ有効。
export function settleOpportunisticState({ parsed, prev, expectationList, trapList, userTexts }) {
  const userAct = sanitizeUserAct(parsed.userAct)
  const move = sanitizeMove(parsed.move)
  const reopenRequested = prev.phase === 'done' && parsed.reopen === true

  const base = {
    userAct,
    move,
    downgraded: [],
    completionRejected: null,
    forcedWrapUp: false,
    phaseEvent: null,
  }

  // 完了後で reopen でもなければ凍結
  if (prev.phase === 'done' && !reopenRequested) {
    return { ...base, ...pickState(prev), focus: null, phase: 'done', pendingWrapUp: false }
  }

  const { states: expectationStates, downgraded } = applyExpectationUpdates(
    prev.expectationStates, parsed.expectationUpdates, expectationList, userTexts)
  const trapStates = applyTrapUpdates(prev.trapStates, parsed.trapUpdates, trapList)
  const next = { expectationStates, trapStates }
  const { ok, gaps } = evaluateCompletion(next)

  if (prev.phase === 'done') {
    // reopen の検証
    if (ok) {
      return { ...base, ...pickState(prev), focus: null, phase: 'done', pendingWrapUp: false,
        completionRejected: ['reopen の根拠（triggered の罠 / 未到達の期待）が無い'] }
    }
    return { ...base, ...next, downgraded, phase: 'reading', pendingWrapUp: false, phaseEvent: 'reopen',
      focus: computeFocus({ prevFocus: null, focusId: parsed.focus, prev, next }) }
  }

  // 読解中
  if (!ok) {
    return { ...base, ...next, downgraded, phase: 'reading', pendingWrapUp: false,
      // 締めくくりの返答なのに条件を満たしていない（ユーザーには終わったように見える）。ログに残す。
      completionRejected: move === 'wrap_up' ? gaps : null,
      focus: computeFocus({ prevFocus: prev.focus, focusId: parsed.focus, prev, next }) }
  }
  if (move === 'wrap_up') {
    return { ...base, ...next, downgraded, phase: 'done', pendingWrapUp: false, phaseEvent: 'complete', focus: null }
  }
  if (prev.pendingWrapUp) {
    return { ...base, ...next, downgraded, phase: 'done', pendingWrapUp: false, phaseEvent: 'complete', focus: null,
      forcedWrapUp: true }
  }
  return { ...base, ...next, downgraded, phase: 'reading', pendingWrapUp: true,
    focus: computeFocus({ prevFocus: prev.focus, focusId: parsed.focus, prev, next }) }
}

function pickState(s) {
  return { expectationStates: s.expectationStates, trapStates: s.trapStates }
}
