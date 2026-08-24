import { GoogleGenerativeAI } from '@google/generative-ai'

const GEMINI_API_KEY = process.env.GEMINI_API_KEY
const MODEL_NAME = 'gemini-3.1-flash-lite'

// 汎用フォーカス（コード構造に依存しない書き方）。
// 特定コード専用の着目観点は codeLibrary.js 側の activeCode.stepFocus[step] で上書きできる。
// activeCode.stepFocus が無ければここのデフォルトが使われる。
const STEP_FOCUS = {
  purpose:      'コード全体が何を受け取り何をするものか、関数名や最後の数行を手がかりに自分の言葉で表現させる。',
  input_output: 'このコードへの入力（引数・受け取るデータ）と出力（返り値・副作用）を分けて考えさせる。',
  loop:         'このコードにおける繰り返し処理（forループ・whileループ・再帰いずれでもよい）が何を繰り返しているかに注目させる。繰り返し処理が存在しない場合はその旨を伝え、次のステップに進めてよい。',
  condition:    '分岐（if文・switch・三項演算子など）がある場合、その条件がどんなときに成立し、何が変わるかを考えさせる。分岐が存在しない場合はその旨を伝え、次のステップに進めてよい。',
  state_change: '処理の過程で値がどう変化していくか（変数の更新、データ構造の変形、フラグの切り替えなど）に注目させる。破壊的な状態変更が無ければ、データがどう変換されていくかという視点に切り替えてよい。存在しない概念を無理に聞かない。',
  early_stop:   '処理がどんな条件で終わる・打ち切られるかを考えさせる（早期return、break、再帰のbase case、ループ条件の終了など）。該当する仕組みが無ければその旨を伝え、次のステップに進めてよい。',
  summary:      'コード全体の処理を「何を受け取り・何をして・何を返すか」の3点で自分の言葉でまとめさせる。',
}

const TUTOR_RULES = `
あなたはコードリーディングの練習を支援するチューターです。

## 絶対に守るルール
- コードの動作を自分から説明・解説しない
- 答えや正解を直接言わない
- 「〜ですね」と相槌だけで終わらない
- 返答は最大で8文以内に収める
- 日本語で返答する


## やること
- ユーザーの発言の中に良い視点があれば1つ取り上げて短く認める
- 現在のステップの着目観点に沿った問いかけを1〜2文で返す
- ユーザーが明らかに誤解している場合は、答えを言わずヒントになる問いを返す
- ユーザーが「わからない」「難しい」と言ったときは、コードの中の見るべき場所を1箇所だけ具体的に指し示す（例：「関数名の bubble_sort を見てみましょう。この名前から何を想像しますか？」）


## ステップを進めるかどうかの判断基準
- advance を true にする：ユーザーが現在のステップの観点について、自分の言葉で何らかの理解や気づきを示したとき
- advance を false にする：以下のいずれかの場合
  - 「わからない」「難しい」「どこを見ればいい」など理解に詰まっている
  - 現在のステップと無関係な発言をしている
  - 一言・あいまいすぎて理解を確認できない（例：「はい」「そうです」「なるほど」だけ）
  - ユーザーの発言が現在のステップの観点に対して的外れな誤解をしている

## 現在のステップの概念がこのコードに存在しない場合
- まず対象コードを確認し、現在のステップ（例：ループ、分岐、状態変化、早期終了など）に対応する概念が実際に存在するかを判断する。
- 存在しないと判断した場合、ユーザーに質問を投げるのではなく、「このコードにはこの観点に相当する処理がないので次に進みます」と短く伝え、advance を true にしてよい。
- 存在しない概念について無理に質問し続けてユーザーを困らせないこと。

## 返答形式（厳守）
必ず以下のJSON形式だけで返答すること。前後に説明文やマークダウンを付けない。
{"reply":"ここに返答テキスト","advance":true}
または
{"reply":"ここに返答テキスト","advance":false}
`.trim()

// 対照群（free条件）用のルール。
// 比較実験の交絡変数を減らすため、guided条件と次の2点を揃えてある。
// 1) 扱う話題の範囲（目的・入出力・ループ・条件分岐・状態変化・終了条件・まとめ）をSTEP_FOCUSと同じにする
// 2) 1回の返答の長さ上限（8文）を揃える
// 違うのは「自分で考えさせるか、直接説明するか」という介入方法の部分だけ。
const TUTOR_RULES_FREE = `
あなたはコードリーディングを支援するAIチューターです。この条件では、ユーザーの質問に対して遠慮せず直接わかりやすく説明します。

## 対応方針
- ユーザーの質問には直接的に、わかりやすく答える（ヒントだけに留めず、必要なら答えそのものを説明してよい）
- 説明はコードの該当箇所（変数名・行の内容）に具体的に触れながら行う
- 「わからない」と言われたら、遠慮なく丁寧に解説する
- 質問があいまいなときは、簡潔に確認してよい
- 返答は最大で8文以内に収める
- 日本語で返答する

## 扱ってよい話題の範囲（このコードについてのみ、以下はguided条件と揃えてある）
- 全体の目的（何を受け取り、何をするものか）
- 入力と出力
- 繰り返し処理（ある場合）
- 条件分岐（ある場合）
- 値・状態の変化
- 処理の終了条件（ある場合）
- 全体のまとめ
上記に無関係な話題（このコードと関係のない一般的なプログラミング相談など）には簡潔に断り、このコードの話題に戻す。

## 返答形式（厳守）
必ず以下のJSON形式だけで返答すること。前後に説明文やマークダウンを付けない。
{"reply":"ここに返答テキスト"}
`.trim()

function buildSystemPrompt({ activeCode, currentStep, condition }) {
  if (condition === 'free') {
    return `
${TUTOR_RULES_FREE}

## 対象コード（${activeCode.filename ?? 'code'}）
言語: ${activeCode.language ?? '不明'}
\`\`\`
${activeCode.code}
\`\`\`
`.trim()
  }

  const focus = activeCode.stepFocus?.[currentStep] ?? STEP_FOCUS[currentStep] ?? STEP_FOCUS.summary
  const hints = activeCode.tutorHints
    ? `## このコードで特に注目させたいポイント\n${activeCode.tutorHints}`
    : '## 注意\nコードを自分で読み、適切な問いかけを考えてください。'

  return `
${TUTOR_RULES}

## 対象コード（${activeCode.filename ?? 'code'}）
言語: ${activeCode.language ?? '不明'}
\`\`\`
${activeCode.code}
\`\`\`

${hints}

## 現在のステップ
ステップ名: ${currentStep}
このステップでユーザーに気づかせたいこと: ${focus}
`.trim()
}

// クライアントから渡された履歴 [{role:'user'|'bot', content:string}, ...] を
// Gemini SDKが要求する形式 [{role:'user'|'model', parts:[{text}]}, ...] に変換する。
// サーバーレス関数はメモリを呼び出し間で共有しないため、履歴は毎回クライアントから
// 受け取り、chatインスタンスもリクエストごとに作り直す（＝ステートレス）。
function toGeminiHistory(history) {
  if (!Array.isArray(history)) return []

  // Gemini API の履歴は最初のメッセージが 'user' でなければならないため、
  // 最初の 'user' のメッセージが現れるインデックスを探します。
  const firstUserIdx = history.findIndex(m => m.role === 'user')

  // もし 'user' のメッセージが履歴に含まれない場合は、空の履歴（最初のターン）として扱います。
  if (firstUserIdx === -1) {
    return []
  }

  // 最初の 'user' メッセージ以降の履歴のみを対象とします。
  const slicedHistory = history.slice(firstUserIdx)

  return slicedHistory.map(m => ({
    role: m.role === 'user' ? 'user' : 'model',
    parts: [{ text: String(m.content ?? '') }],
  }))
}

export async function askGemini({ activeCode, currentStep, userMessage, history, condition }) {
  if (!GEMINI_API_KEY) {
    throw new Error('GEMINI_API_KEY が設定されていません。環境変数を確認してください。')
  }

  const t0 = Date.now()
  const genAI = new GoogleGenerativeAI(GEMINI_API_KEY)
  const model = genAI.getGenerativeModel({
    model: MODEL_NAME,
    systemInstruction: buildSystemPrompt({ activeCode, currentStep, condition }),
  })
  const chat = model.startChat({ history: toGeminiHistory(history) })
  const chatReadyMs = Date.now() - t0

  const apiT0 = Date.now()
  const result = await chat.sendMessage(userMessage)
  const apiCallMs = Date.now() - apiT0

  const raw = result.response.text()

  // free条件は {"reply":...} のみを返すため、"advance" の有無に依存しない形で抽出する。
  const jsonMatch = raw.match(/\{[\s\S]*"reply"[\s\S]*\}/)
  if (!jsonMatch) {
    console.warn('[gemini] JSON形式で返答されませんでした。raw:', raw)
    return { reply: raw.trim(), advance: false, chatReadyMs, apiCallMs }
  }

  try {
    const parsed = JSON.parse(jsonMatch[0])
    // free条件にはadvanceの概念が無いのでtrue固定としておく（フロント側では使用しない）。
    const advance = condition === 'free' ? true : parsed.advance === true
    return {
      reply: String(parsed.reply ?? '').trim(),
      advance,
      chatReadyMs,
      apiCallMs,
    }
  } catch (e) {
    console.warn('[gemini] JSONパース失敗:', e.message, 'raw:', raw)
    return { reply: raw.trim(), advance: false, chatReadyMs, apiCallMs }
  }
}
