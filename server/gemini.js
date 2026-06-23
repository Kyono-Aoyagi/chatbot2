import { GoogleGenerativeAI } from '@google/generative-ai'

const GEMINI_API_KEY = process.env.GEMINI_API_KEY
const MODEL_NAME = 'gemini-3-flash-preview'

const HISTORY_LIMIT = 10

const STEP_FOCUS = {
  purpose:      'コード全体が何をするものか、関数名や最後の数行を手がかりに自分の言葉で表現させる。',
  input_output: '関数への入力（引数）と出力（返り値）が何かを分けて考えさせる。',
  loop:         '外側と内側のループがそれぞれ何をしているか、変数 i と j の役割に注目させる。',
  condition:    'if文の条件がTrueになる状況と、そのとき配列にどんな変化が起きるかを考えさせる。',
  state_change: 'swappedのような状態変数がいつTrueになるか、何を記録しているかを考えさせる。',
  early_stop:   'ループが早期終了する条件と、なぜ早く終わってよいのかの理由を考えさせる。',
  summary:      'コード全体の処理を「何を受け取り・何をして・何を返すか」の3点で自分の言葉でまとめさせる。',
}

const TUTOR_RULES = `
あなたはコードリーディングの練習を支援するチューターです。

## 絶対に守るルール
- コードの動作を自分から説明・解説しない
- 答えや正解を直接言わない
- 「〜ですね」と相槌だけで終わらない
- 返答は3文以内に収める
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

## 返答形式（厳守）
必ず以下のJSON形式だけで返答すること。前後に説明文やマークダウンを付けない。
{"reply":"ここに返答テキスト","advance":true}
または
{"reply":"ここに返答テキスト","advance":false}
`.trim()

function buildSystemPrompt({ activeCode, currentStep }) {
  const focus = STEP_FOCUS[currentStep] ?? STEP_FOCUS.summary
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

export async function askGemini({ activeCode, currentStep, history, userMessage }) {
  if (!GEMINI_API_KEY) {
    throw new Error('GEMINI_API_KEY が設定されていません。.env を確認してください。')
  }

  const genAI = new GoogleGenerativeAI(GEMINI_API_KEY)
  const model = genAI.getGenerativeModel({
    model: MODEL_NAME,
    systemInstruction: buildSystemPrompt({ activeCode, currentStep }),
  })

  const trimmedHistory = history.slice(-(HISTORY_LIMIT * 2))
  const chat = model.startChat({ history: trimmedHistory })
  const result = await chat.sendMessage(userMessage)
  const raw = result.response.text()

  // JSON部分だけ抽出してパース（AIがマークダウンで囲んだ場合も対応）
  const jsonMatch = raw.match(/\{[\s\S]*"reply"[\s\S]*"advance"[\s\S]*\}/)
  if (!jsonMatch) {
    // パース失敗時はadvance: falseで返答をそのまま使う
    console.warn('[gemini] JSON形式で返答されませんでした。raw:', raw)
    return { reply: raw.trim(), advance: false }
  }

  try {
    const parsed = JSON.parse(jsonMatch[0])
    return {
      reply: String(parsed.reply ?? '').trim(),
      advance: parsed.advance === true,
    }
  } catch (e) {
    console.warn('[gemini] JSONパース失敗:', e.message, 'raw:', raw)
    return { reply: raw.trim(), advance: false }
  }
}
