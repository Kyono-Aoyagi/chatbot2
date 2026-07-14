import { GoogleGenerativeAI } from '@google/generative-ai'

const GEMINI_API_KEY = process.env.GEMINI_API_KEY
// const MODEL_NAME = 'gemini-2.5-flash'
// const MODEL_NAME = 'gemini-3-flash-preview'
// const MODEL_NAME = 'gemini-3.5-flash'
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

function buildSystemPrompt({ activeCode, currentStep }) {
  // コード固有の stepFocus が定義されていれば優先し、なければ汎用の STEP_FOCUS にフォールバックする。
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

// sessionId -> { chat, currentStep }
// 同じステップの間はchatインスタンスを使い回す。
// これによりsystemInstruction（ルール文＋コード全文）の再送信と
// 履歴(history)のクライアントからの送信が不要になる。
const sessions = new Map()

function getOrCreateChat({ sessionId, activeCode, currentStep }) {
  const existing = sessions.get(sessionId)
  // ステップが同じでも、対象コード（activeCode.id）が変わっていたら必ずChatを作り直す。
  // （同一 sessionId で別のコードに切り替えた際に、古いコードの systemInstruction を
  //   保持したままの chat が使い回される事故を防ぐ）
  if (existing && existing.currentStep === currentStep && existing.codeId === activeCode.id) {
    return existing.chat
  }

  // 新規セッション、ステップが変わった場合、または対象コードが変わった場合はchatを作り直す。
  // ステップが変わるとTUTOR_RULES内の「着目観点」が変わるため、
  // systemInstructionも更新が必要。
  const genAI = new GoogleGenerativeAI(GEMINI_API_KEY)
  const model = genAI.getGenerativeModel({
    model: MODEL_NAME,
    systemInstruction: buildSystemPrompt({ activeCode, currentStep }),
  })
  const chat = model.startChat()

  sessions.set(sessionId, { chat, currentStep, codeId: activeCode.id })
  return chat
}

export function clearSession(sessionId) {
  sessions.delete(sessionId)
}

export async function askGemini({ sessionId, activeCode, currentStep, userMessage }) {
  if (!GEMINI_API_KEY) {
    throw new Error('GEMINI_API_KEY が設定されていません。.env を確認してください。')
  }
  if (!sessionId) {
    throw new Error('sessionId は必須です。')
  }

  const t0 = Date.now()
  const chat = getOrCreateChat({ sessionId, activeCode, currentStep })
  const chatReadyMs = Date.now() - t0

  const apiT0 = Date.now()
  const result = await chat.sendMessage(userMessage)
  const apiCallMs = Date.now() - apiT0

  const raw = result.response.text()

  // JSON部分だけ抽出してパース（AIがマークダウンで囲んだ場合も対応）
  const jsonMatch = raw.match(/\{[\s\S]*"reply"[\s\S]*"advance"[\s\S]*\}/)
  if (!jsonMatch) {
    // パース失敗時はadvance: falseで返答をそのまま使う
    console.warn('[gemini] JSON形式で返答されませんでした。raw:', raw)
    return { reply: raw.trim(), advance: false, chatReadyMs, apiCallMs }
  }

  try {
    const parsed = JSON.parse(jsonMatch[0])
    return {
      reply: String(parsed.reply ?? '').trim(),
      advance: parsed.advance === true,
      chatReadyMs,
      apiCallMs,
    }
  } catch (e) {
    console.warn('[gemini] JSONパース失敗:', e.message, 'raw:', raw)
    return { reply: raw.trim(), advance: false, chatReadyMs, apiCallMs }
  }
}
