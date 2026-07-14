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
}

export function getNextStep(currentStep) {
  const index = STEPS.indexOf(currentStep)
  if (index === -1 || index === STEPS.length - 1) return currentStep
  return STEPS[index + 1]
}

export function getInitialBotMessage(codeTitle) {
  return {
    role: 'bot',
    content: `「${codeTitle}」のコードリーディングを始めましょう。\nまず、このコード全体は何をするためのものに見えますか？関数名や最後の数行を手がかりに、自分の言葉で書いてみてください。`,
    step: 'purpose',
    timestamp: new Date().toISOString(),
  }
}

// サーバーレス関数はリクエスト間で状態を共有できないため、会話履歴(history)は
// クライアント側(messages state)で保持し、毎回のリクエストに含めて送る。
// history は [{role:'user'|'bot', content:string}, ...] の形（今回送るuserMessage自体は含めない）。
export async function sendToGemini({ sessionId, activeCode, currentStep, userMessage, history }) {
  const response = await fetch(`${API_BASE}/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ sessionId, activeCode, currentStep, userMessage, history }),
  })

  if (!response.ok) {
    const err = await response.json().catch(() => ({}))
    throw new Error(err.error ?? `サーバーエラー (${response.status})`)
  }

  const data = await response.json()

  // advance: true のときだけ次のステップへ、false なら現在のステップに留まる
  const nextStep = data.advance ? getNextStep(currentStep) : currentStep

  return {
    content: data.reply,
    nextStep,
  }
}
