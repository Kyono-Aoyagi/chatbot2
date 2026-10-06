// opportunistic条件の「状態」に関するロジック（DBにもLLMにも触れない純粋関数）。
//
// 状態は4つ。サーバーレスなのでクライアントが保持し、毎回送受信する。
//   mentalModel : { why, how }          各 unresolved | conjectured | confirmed
//   openQuestions: [{ id, level, target, status, source }]
//   trapStates  : [{ id, status }]      各 untouched | triggered | cleared（罠のidは t1, t2, ... = activeCode.traps の並び順）
//   phase       : 'reading' | 'done'
//
// 読解の「終了」は、LLMの自己申告（done）をサーバーが検算して決める（evaluateCompletion / resolvePhase）。

export const MAX_OPEN_QUESTIONS = 5
const MAX_TRAPS = 5

const VALID_STATUS = new Set(['unresolved', 'conjectured', 'confirmed'])
const VALID_LEVEL = new Set(['why', 'how', 'what'])
const VALID_Q_STATUS = new Set(['open', 'deferred', 'resolved'])
const VALID_SOURCE = new Set(['user', 'tutor'])
const VALID_TRAP_STATUS = new Set(['untouched', 'triggered', 'cleared'])
const VALID_MOVE = new Set([
  'bottom_up', 'revisit', 'top_down', 'narrow', 'trace', 'switch', 'correct',
  'wrap_up', // 終了の締めくくり
  'answer', // 完了後の直接回答
  'other',
])

export function defaultMentalModel() {
  return { why: 'unresolved', how: 'unresolved' }
}

// ユーザーの未解決の問い（これが残っている間は終了できない）。
const isUnresolvedUserQuestion = q => q?.source === 'user' && (q.status === 'open' || q.status === 'deferred')

// ---------- サニタイズ ----------

// ログ分析用タグ。不正値・未指定は null（guided/free条件でも null になる）。
export function sanitizeMove(candidate) {
  return VALID_MOVE.has(candidate) ? candidate : null
}

// LLMが返したmentalModelを軽くサニタイズする。壊れていれば直前の状態にフォールバック。
export function sanitizeMentalModel(candidate, fallback) {
  const base = fallback ?? defaultMentalModel()
  if (!candidate || typeof candidate !== 'object') return base
  const why = VALID_STATUS.has(candidate.why) ? candidate.why : base.why
  const how = VALID_STATUS.has(candidate.how) ? candidate.how : base.how
  return { why, how }
}

// LLMが返したopenQuestionsをサニタイズする。
// - source は、以前の状態にあれば引き継ぐ（LLMが後から「ユーザー由来」を「チューター由来」に書き換えて終了条件を回避できないように）。
//   新規の問いは、LLMの指定が有効ならそれを、無ければ 'tutor' とする。
// - ユーザー由来の未解決の問いは、LLMが黙って消しても残す（消すなら "resolved" にさせる）。
export function sanitizeOpenQuestions(candidate, fallback) {
  const prev = Array.isArray(fallback) ? fallback : []
  if (!Array.isArray(candidate)) return prev

  const prevById = new Map(prev.map(q => [q.id, q]))
  const cleaned = candidate
    .filter(q => q && typeof q === 'object' && typeof q.id === 'string' && typeof q.target === 'string')
    .map(q => ({
      id: q.id,
      level: VALID_LEVEL.has(q.level) ? q.level : 'what',
      target: String(q.target).slice(0, 200),
      status: VALID_Q_STATUS.has(q.status) ? q.status : 'open',
      source: prevById.get(q.id)?.source ?? (VALID_SOURCE.has(q.source) ? q.source : 'tutor'),
    }))

  const cleanedIds = new Set(cleaned.map(q => q.id))
  const carried = prev.filter(q => isUnresolvedUserQuestion(q) && !cleanedIds.has(q.id))
  return [...carried, ...cleaned].slice(0, MAX_OPEN_QUESTIONS)
}

// ---------- 罠 ----------

// activeCode.traps に id（t1, t2, ...）を振る。プロンプトとログで同じ id を使う。
export function buildTrapList(activeCode) {
  const traps = Array.isArray(activeCode?.traps) ? activeCode.traps.slice(0, MAX_TRAPS) : []
  return traps.map((text, i) => ({ id: `t${i + 1}`, text: String(text) }))
}

// クライアントから受け取った（信用できない）罠の状態を、罠のリストに合わせて整える。
export function normalizeTrapStates(candidate, trapList) {
  const byId = new Map(
    Array.isArray(candidate)
      ? candidate.filter(s => s && typeof s.id === 'string').map(s => [s.id, s.status])
      : [],
  )
  return trapList.map(t => ({
    id: t.id,
    status: VALID_TRAP_STATUS.has(byId.get(t.id)) ? byId.get(t.id) : 'untouched',
  }))
}

// LLMが返した trapUpdates（状態が変わった罠だけ）を反映する。
export function applyTrapUpdates(prevStates, updates, trapList) {
  const next = normalizeTrapStates(prevStates, trapList)
  if (!Array.isArray(updates)) return next
  for (const u of updates) {
    const target = next.find(s => s.id === u?.id)
    if (target && VALID_TRAP_STATUS.has(u.status)) target.status = u.status
  }
  return next
}

// ---------- 終了判定 ----------

// 終了条件:
//   - why / how がどちらも confirmed
//   - source:"user" の問いに open / deferred が残っていない
//   - "triggered"（誤解の兆候が出たが未解消）の罠が無い
// "untouched" の罠は終了を妨げない（罠を確認するために、ユーザーが触れていない点を探し回らせないため）。
// tutor 由来の問いも終了を妨げない。
// 戻り値: { ok, gaps }  gaps は満たせていない理由（ログ・拒否時の再生成指示・「理解できた」ボタンの記録に使う）。
export function evaluateCompletion({ mentalModel, openQuestions, trapStates }) {
  const gaps = []
  if (mentalModel?.why !== 'confirmed') gaps.push('why が confirmed ではない')
  if (mentalModel?.how !== 'confirmed') gaps.push('how が confirmed ではない')
  for (const q of openQuestions ?? []) {
    if (isUnresolvedUserQuestion(q)) gaps.push(`ユーザー由来の問いが未解決: ${q.target}`)
  }
  for (const t of trapStates ?? []) {
    if (t.status === 'triggered') gaps.push(`罠が未解消: ${t.id}`)
  }
  return { ok: gaps.length === 0, gaps }
}

// LLMの done / reopen を、状態で検算して phase を決める。
// 戻り値: { phase, event, rejected }
//   event: 'complete'（読解が終了した）| 'reopen'（完了後に読解へ戻った）| null
//   rejected: 申告が通らなかったときの理由（配列）。通った/申告が無かったときは null。
export function resolvePhase({ prevPhase, modelDone, modelReopen, state }) {
  if (prevPhase !== 'done') {
    if (!modelDone) return { phase: 'reading', event: null, rejected: null }
    const { ok, gaps } = evaluateCompletion(state)
    return ok
      ? { phase: 'done', event: 'complete', rejected: null }
      : { phase: 'reading', event: null, rejected: gaps }
  }

  if (!modelReopen) return { phase: 'done', event: null, rejected: null }

  // 完了後に読解へ戻れるのは、誤解の兆候（triggered の罠）かユーザー由来の未解決の問いがあるときだけ。
  // 単なる質問では戻さない。
  const hasReason =
    (state.trapStates ?? []).some(t => t.status === 'triggered') ||
    (state.openQuestions ?? []).some(isUnresolvedUserQuestion)
  return hasReason
    ? { phase: 'reading', event: 'reopen', rejected: null }
    : { phase: 'done', event: null, rejected: ['reopen の根拠（triggered の罠 / 未解決のユーザー由来の問い）が無い'] }
}

// LLMの出力（parsed）と直前の状態から、次の状態を決める。
// 完了後（done）に reopen されない場合は、LLMが何を返しても状態を変えない（完了後にチューターが新しい問いを作らないようにする）。
export function settleOpportunisticState({ parsed, prev, trapList }) {
  const modelDone = parsed.done === true
  const modelReopen = parsed.reopen === true

  const mentalModel = sanitizeMentalModel(parsed.mentalModel, prev.mentalModel)
  const openQuestions = sanitizeOpenQuestions(parsed.openQuestions, prev.openQuestions)
  const trapStates = applyTrapUpdates(prev.trapStates, parsed.trapUpdates, trapList)
  const next = { mentalModel, openQuestions, trapStates }

  const { phase, event, rejected } = resolvePhase({
    prevPhase: prev.phase,
    modelDone,
    modelReopen,
    state: next,
  })

  const frozen = prev.phase === 'done' && event !== 'reopen'
  return {
    ...(frozen ? { mentalModel: prev.mentalModel, openQuestions: prev.openQuestions, trapStates: prev.trapStates } : next),
    phase,
    phaseEvent: event,
    completionRejected: rejected,
    done: modelDone,
  }
}
