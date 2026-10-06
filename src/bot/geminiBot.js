const API_BASE = '/api'

export const STEPS = [
  'purpose',
  'input_output',
  'loop',
  'condition',
  'state_change',
  'early_stop',
  'summary',
]

export const STEP_LABELS = {
  purpose:      '全体の目的',
  input_output: '入力と出力',
  loop:         'ループ',
  condition:    '条件分岐',
  state_change: '状態変化',
  early_stop:   '早期終了',
  summary:      'まとめ',
  free:         '自由に質問できます',
  opportunistic: '気になったところから自由に',
}

export function getNextStep(currentStep) {
  const index = STEPS.indexOf(currentStep)
  if (index === -1 || index === STEPS.length - 1) return currentStep
  return STEPS[index + 1]
}

export function getInitialBotMessage(codeTitle, condition) {
  if (condition === 'free') {
    return {
      role: 'bot',
      content: `「${codeTitle}」について、自由に質問してください。処理の目的、入力と出力、繰り返しや条件分岐の動き、値の変化、終了条件など、気になるところから聞いてもらえれば説明します。`,
      step: 'free',
      timestamp: new Date().toISOString(),
    }
  }

  if (condition === 'opportunistic') {
    return {
      role: 'bot',
      content: `「${codeTitle}」のコードリーディングを始めましょう。\nまず、このコード全体は何をするためのものに見えますか？気になった行や変数があれば、途中で自由に言及してもらっても構いません。`,
      step: 'opportunistic',
      timestamp: new Date().toISOString(),
    }
  }

  return {
    role: 'bot',
    content: `「${codeTitle}」のコードリーディングを始めましょう。\nまず、このコード全体は何をするためのものに見えますか？関数名や最後の数行を手がかりに、自分の言葉で書いてみてください。`,
    step: 'purpose',
    timestamp: new Date().toISOString(),
  }
}

// opportunistic条件用の初期状態。
// mentalModel: why/howの集約理解度。 openQuestions: 局所的な問いの保留キュー。
// trapStates: activeCode.traps ごとの状態（id は t1, t2, ... = サーバー側 buildTrapList と同じ並び・同じ上限）。
// phase: 'reading'（読解中）| 'done'（完了後）。
const MAX_TRAPS = 5

export function getInitialMentalState(activeCode) {
  const traps = Array.isArray(activeCode?.traps) ? activeCode.traps.slice(0, MAX_TRAPS) : []
  return {
    mentalModel: { why: 'unresolved', how: 'unresolved' },
    openQuestions: [],
    trapStates: traps.map((_, i) => ({ id: `t${i + 1}`, status: 'untouched' })),
    phase: 'reading',
  }
}

// 「理解できた」ボタンで読解を終えたときに、チャットに追加する固定メッセージ（AIを呼ばない）。
export function getUserDeclaredDoneMessage() {
  return {
    role: 'bot',
    content: '了解しました。ここで読解は完了とします。このあとも質問は自由にできます。',
    step: 'opportunistic',
    timestamp: new Date().toLocaleString('ja-JP', { timeZone: 'Asia/Tokyo' }),
  }
}

// サーバーレス関数はリクエスト間で状態を共有できないため、会話履歴(history)は
// クライアント側(messages state)で保持し、毎回のリクエストに含めて送る。
// history は [{role:'user'|'bot', content:string}, ...] の形（今回送るuserMessage自体は含めない）。
export async function sendToGemini({ sessionId, activeCode, currentStep, userMessage, history, condition }) {
  const response = await fetch(`${API_BASE}/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ sessionId, activeCode, currentStep, userMessage, history, condition }),
  })

  if (!response.ok) {
    const err = await response.json().catch(() => ({}))
    throw new Error(err.error ?? `サーバーエラー (${response.status})`)
  }

  const data = await response.json()

  // free条件にはステップ進行の概念が無いため常に 'free' に留める。
  // guided条件は advance: true のときだけ次のステップへ、false なら現在のステップに留まる。
  const nextStep = condition === 'free'
    ? 'free'
    : (data.advance ? getNextStep(currentStep) : currentStep)

  return {
    content: data.reply,
    nextStep,
    // 呼び出し側で「summary完了の瞬間」を検知するために必要
    // （currentStepがすでに最後のステップの場合、nextStepだけではadvanceの有無を区別できないため）
    advance: data.advance === true,
  }
}

// opportunistic条件専用の送信関数。
// stepの代わりに mentalModel / openQuestions / trapStates / phase を毎回送受信する（サーバーレスなので状態はクライアント側が持つ）。
export async function sendToGeminiOpportunistic({ sessionId, activeCode, mentalModel, openQuestions, trapStates, phase, userMessage, history }) {
  const response = await fetch(`${API_BASE}/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      sessionId,
      activeCode,
      userMessage,
      history,
      condition: 'opportunistic',
      mentalModel,
      openQuestions,
      trapStates,
      phase,
    }),
  })

  if (!response.ok) {
    const err = await response.json().catch(() => ({}))
    throw new Error(err.error ?? `サーバーエラー (${response.status})`)
  }

  const data = await response.json()

  return {
    content: data.reply,
    mentalModel: data.mentalModel ?? mentalModel,
    openQuestions: Array.isArray(data.openQuestions) ? data.openQuestions : openQuestions,
    trapStates: Array.isArray(data.trapStates) ? data.trapStates : trapStates,
    phase: data.phase === 'done' ? 'done' : 'reading',
  }
}
