const STEPS = {
  purpose: {
    next: 'input_output',
    prompt: 'まず、このコード全体は何をするためのものに見えますか？関数名や最後の3行を手がかりに、自分の言葉で書いてみてください。',
  },
  input_output: {
    next: 'loop',
    prompt: 'よい観察です。次に、この関数に入ってくる値と、最後に返される値は何でしょうか？入力と出力を分けて考えてみましょう。',
  },
  loop: {
    next: 'condition',
    prompt: '次はループを見ます。外側のfor文と内側のfor文は、それぞれ何回くらい動きそうですか？iとjの役割に注目してみましょう。',
  },
  condition: {
    next: 'state_change',
    prompt: '今度はif文です。numbers[j] > numbers[j + 1] がTrueになるのは、どんな並びのときでしょうか？そのとき配列はどう変わりますか？',
  },
  state_change: {
    next: 'early_stop',
    prompt: 'swappedという変数に注目しましょう。この変数は、何が起きたことを記録しているのでしょうか？Trueになる場面を探してみてください。',
  },
  early_stop: {
    next: 'summary',
    prompt: 'if not swapped: break は、どんなときにループを早く終わらせていますか？なぜ早く終わってよいのかを考えてみましょう。',
  },
  summary: {
    next: 'summary',
    prompt: '最後に、この関数の処理を3文くらいで説明してみましょう。「何を受け取り、何を比べ、何を返すか」を入れると整理しやすいです。',
  },
}

export function getInitialBotMessage() {
  return {
    role: 'bot',
    content: STEPS.purpose.prompt,
    step: 'purpose',
    timestamp: new Date().toISOString(),
  }
}

export function getNextBotReply({ currentStep, userText }) {
  const step = STEPS[currentStep] ?? STEPS.purpose
  const nextStep = step.next
  const next = STEPS[nextStep] ?? STEPS.summary

  return {
    nextStep,
    content: buildReplyPrefix(userText) + next.prompt,
  }
}

function buildReplyPrefix(userText) {
  const normalized = userText.trim()
  if (normalized.length < 8) {
    return 'もう少し具体的に見るために、'
  }
  if (normalized.includes('わから') || normalized.includes('難しい')) {
    return '大丈夫です。読む場所を小さく区切りましょう。'
  }
  return 'その視点で進めましょう。'
}
