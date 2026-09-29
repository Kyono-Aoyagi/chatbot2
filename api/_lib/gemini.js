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

// opportunistic条件用のルール（Letovsky, 1986 の日和見主義モデルを参考にした設計）。
// 固定ステップ順ではなく、
//   1. ユーザーの発言中の局所的な手がかり（ボトムアップ割り込み）
//   2. 保留中の問い(openQuestions)との関連（再訪）
//   3. 上記が無ければ mentalModel.why / how のうち手薄な方（トップダウン継続）
// の優先順位で次の一手を選ばせる。返答はreplyに加えてmentalModelとopenQuestionsの
// 「次の状態そのもの」をJSONで返させる（差分ではなく全体を返させることで、
// パース失敗時に直前の状態へフォールバックしやすくする）。
const MAX_OPEN_QUESTIONS = 5

const TUTOR_RULES_OPPORTUNISTIC = `
あなたはコードリーディングを支援するチューターです。日和見主義的な理解プロセス（Letovskyモデル）を模倣します。

## 状態の見方
- mentalModel.why: コード全体の意図についてのユーザーの理解度（unresolved/conjectured/confirmed）
- mentalModel.how: 実現方略（アルゴリズム・処理の流れ）についてのユーザーの理解度（同上）
- openQuestions: 保留中・進行中の局所的な問い。各要素は
  { "id": string, "level": "why"|"how"|"what", "target": string, "status": "open"|"deferred"|"resolved" }
  最大${MAX_OPEN_QUESTIONS}件までしか保持しない。

## 次の一手を選ぶ優先順位
1. ユーザーの発言が、コード中の具体的な変数・行・処理に自発的に言及している場合、
   たとえ今扱っている話題と違っても、その言及を捉えて短く深掘りする問いを返してよい。
   新しい着眼点なら openQuestions に status:"open" で追加する（levelは why/how/what から適切なものを選ぶ）。
2. ユーザーの発言が、openQuestions内の status:"deferred" な項目と関連しそうな場合、
   それを取り上げて「さっき保留にしていた〇〇、今の話とつながりそうです」のように再訪する。
   解決できたと判断したら該当項目の status を "resolved" にする。
3. 上記いずれにも該当しない場合のみ、mentalModel.why または how のうち unresolved な方について
   トップダウンに問いかける。両方 confirmed に近ければ、openQuestions の open な項目から選んでよい。
4. ユーザーが「わからない」「難しい」などで詰まった場合、今扱っている問いを status:"deferred" にする。
   そのうえで、次の中から最も軽い支援を選ぶ。
   a. 問いを絞る（move: narrow）：見るべき箇所を1つだけ指し、二択や短い穴埋めで答えられる形に言い換える。
   b. 小さな入力で追わせる（move: trace）：コード自体は変えず、入力を小さく（3要素程度）して、1手ずつ何が起きるかを追わせる。
   c. 別の観点へ移る（move: switch）：aやbでも進まない場合、または直前に同種の支援をすでに出している場合は、
      もう一方のwhy/howや他のopenQuestionsに移る。
   同じ問い・同じ言い回しを繰り返さない。別のコードを新しく作って示すことはしない。
5. openQuestionsがすでに${MAX_OPEN_QUESTIONS}件ある場合、新規追加より既存項目の解決・保留判断を優先する。
6. ユーザーがコードについて指摘や反論をした場合（例：「〇〇なんてなくない？」）、まずコードに照らして正しいかを確認する。
   正しければ認めたうえで問いを修正する（move: correct）。誤っていれば、コード上の該当箇所を引用して確認を促す。

## 行の指し方
- 行番号は使わない（ユーザーの画面の行番号と一致する保証がない）。変数名・式・関数名をそのまま引用して指す。

## mentalModelの更新基準
- unresolved → conjectured：ユーザーが自分の言葉で推測を述べた（正誤は問わない）。
  名前を繰り返しただけ（例：「バブルソート」とだけ言った）は conjectured 止まり。
- conjectured → confirmed：ユーザー自身の説明が、下に「参照情報」があればその要点と、無ければコードから自分で判断した内容と一致しており、
  かつコード上の根拠（変数・処理）への言及を伴うとき。
- 誤解が見つかったら confirmed や conjectured から戻してよい。
- 1回の発言で why と how を同時に confirmed にすることは避ける。

## 参照情報の扱い（対象コードの後に「参照情報」がある場合のみ）
- 参照情報はチューターだけが知る正解と手がかりである。ユーザーには絶対に言わない。文言をそのまま使わない。
- landmarks：ユーザーがその要素に自発的に触れたときに深掘りに使う。ユーザーが詰まっていないときは、こちらから先に名指ししない。
  詰まったときに「見るべき場所」を選ぶ候補としては使ってよい。
- traps：ユーザーの発言にそのつまずきの兆候が見えたときだけ、答えを言わずに気づかせる問いとして使う。

## moveとnote（ログ分析用。ユーザーには見せない）
- move は今回の返答でどの一手を選んだかを表す。
  bottom_up（優先順位1）/ revisit（2）/ top_down（3）/ narrow・trace・switch（4）/ correct（6）/ other
- note は、その一手を選んだ理由を40字以内で書く。

## 絶対に守るルール
- コードの動作を自分から説明・解説しない
- 答えや正解を直接言わない
- 「〜ですね」と相槌だけで終わらない
- 返答は最大で8文以内に収める
- 日本語で返答する

## 返答形式（厳守）
必ず以下のJSON形式だけで返答すること。前後に説明文やマークダウンを付けない。
{"reply":"ここに返答テキスト","move":"bottom_up|revisit|top_down|narrow|trace|switch|correct|other","note":"理由を40字以内で","mentalModel":{"why":"unresolved|conjectured|confirmed","how":"unresolved|conjectured|confirmed"},"openQuestions":[{"id":"q1","level":"why","target":"...","status":"open"}]}
`.trim()

// 問題側が持つ「チューターだけが知る情報」(reference / landmarks / traps)を、opportunistic用のプロンプト断片にする。
// どれも無い場合（ユーザー貼付コードなど）は空文字を返し、AIがコードから自力で判断する。
function buildReferenceBlock(activeCode) {
  const { reference, landmarks, traps } = activeCode ?? {}
  const lines = []
  if (reference?.why) lines.push(`- why（全体の意図）: ${reference.why}`)
  if (reference?.how) lines.push(`- how（実現方略）: ${reference.how}`)
  if (Array.isArray(landmarks) && landmarks.length) {
    lines.push('- landmarks（ユーザーが自発的に触れたら深掘りする手がかり）:')
    for (const l of landmarks.slice(0, 5)) {
      lines.push(typeof l === 'string' ? `  - ${l}` : `  - ${l?.target ?? ''}: ${l?.note ?? ''}`)
    }
  }
  if (Array.isArray(traps) && traps.length) {
    lines.push('- traps（つまずきやすい点）:')
    for (const t of traps.slice(0, 5)) lines.push(`  - ${t}`)
  }
  if (!lines.length) return ''
  return `## 参照情報（チューター専用。ユーザーに直接言わない）\n${lines.join('\n')}\n\n`
}

function buildSystemPrompt({ activeCode, currentStep, condition, mentalModel, openQuestions }) {
  if (condition === 'opportunistic') {
    return `
${TUTOR_RULES_OPPORTUNISTIC}

## 対象コード（${activeCode.filename ?? 'code'}）
言語: ${activeCode.language ?? '不明'}
\`\`\`
${activeCode.code}
\`\`\`

${buildReferenceBlock(activeCode)}## 現在の状態
mentalModel: ${JSON.stringify(mentalModel ?? { why: 'unresolved', how: 'unresolved' })}
openQuestions: ${JSON.stringify(openQuestions ?? [])}
`.trim()
  }

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

// opportunistic条件のmentalModelが不正/欠落していた場合のデフォルト値。
function defaultMentalModel() {
  return { why: 'unresolved', how: 'unresolved' }
}

const VALID_STATUS = new Set(['unresolved', 'conjectured', 'confirmed'])
const VALID_LEVEL = new Set(['why', 'how', 'what'])
const VALID_Q_STATUS = new Set(['open', 'deferred', 'resolved'])
const VALID_MOVE = new Set(['bottom_up', 'revisit', 'top_down', 'narrow', 'trace', 'switch', 'correct', 'other'])

// opportunistic条件のログ分析用タグ。不正値・未指定は null（guided/free条件でも null になる）。
function sanitizeMove(candidate) {
  return VALID_MOVE.has(candidate) ? candidate : null
}

// LLMが返したmentalModelを軽くサニタイズする。壊れていれば直前の状態にフォールバック。
function sanitizeMentalModel(candidate, fallback) {
  const base = fallback ?? defaultMentalModel()
  if (!candidate || typeof candidate !== 'object') return base
  const why = VALID_STATUS.has(candidate.why) ? candidate.why : base.why
  const how = VALID_STATUS.has(candidate.how) ? candidate.how : base.how
  return { why, how }
}

// LLMが返したopenQuestionsを軽くサニタイズする（不正要素は捨て、MAX_OPEN_QUESTIONS件に切り詰め）。
function sanitizeOpenQuestions(candidate, fallback) {
  if (!Array.isArray(candidate)) return Array.isArray(fallback) ? fallback : []
  const cleaned = candidate
    .filter(q => q && typeof q === 'object' && typeof q.id === 'string' && typeof q.target === 'string')
    .map(q => ({
      id: q.id,
      level: VALID_LEVEL.has(q.level) ? q.level : 'what',
      target: String(q.target).slice(0, 200),
      status: VALID_Q_STATUS.has(q.status) ? q.status : 'open',
    }))
  return cleaned.slice(0, MAX_OPEN_QUESTIONS)
}

export async function askGemini({ activeCode, currentStep, userMessage, history, condition, mentalModel, openQuestions }) {
  if (!GEMINI_API_KEY) {
    throw new Error('GEMINI_API_KEY が設定されていません。環境変数を確認してください。')
  }

  const t0 = Date.now()
  const genAI = new GoogleGenerativeAI(GEMINI_API_KEY)
  const model = genAI.getGenerativeModel({
    model: MODEL_NAME,
    systemInstruction: buildSystemPrompt({ activeCode, currentStep, condition, mentalModel, openQuestions }),
  })
  const chat = model.startChat({ history: toGeminiHistory(history) })
  const chatReadyMs = Date.now() - t0

  const apiT0 = Date.now()
  const result = await chat.sendMessage(userMessage)
  const apiCallMs = Date.now() - apiT0

  const raw = result.response.text()

  // free/opportunistic条件は "advance" を持たないため、"reply" の有無だけに依存する形で抽出する。
  const jsonMatch = raw.match(/\{[\s\S]*"reply"[\s\S]*\}/)
  if (!jsonMatch) {
    console.warn('[gemini] JSON形式で返答されませんでした。raw:', raw)
    return {
      reply: raw.trim(),
      advance: false,
      mentalModel: sanitizeMentalModel(null, mentalModel),
      openQuestions: sanitizeOpenQuestions(null, openQuestions),
      chatReadyMs,
      apiCallMs,
    }
  }

  try {
    const parsed = JSON.parse(jsonMatch[0])
    // free条件にはadvanceの概念が無いのでtrue固定としておく（フロント側では使用しない）。
    const advance = condition === 'free' ? true : parsed.advance === true
    return {
      reply: String(parsed.reply ?? '').trim(),
      advance,
      move: sanitizeMove(parsed.move),
      note: typeof parsed.note === 'string' ? parsed.note.trim().slice(0, 80) : null,
      // guided/free条件では常に空の状態を返すだけで、フロント側は無視して構わない。
      mentalModel: sanitizeMentalModel(parsed.mentalModel, mentalModel),
      openQuestions: sanitizeOpenQuestions(parsed.openQuestions, openQuestions),
      chatReadyMs,
      apiCallMs,
    }
  } catch (e) {
    console.warn('[gemini] JSONパース失敗:', e.message, 'raw:', raw)
    return {
      reply: raw.trim(),
      advance: false,
      mentalModel: sanitizeMentalModel(null, mentalModel),
      openQuestions: sanitizeOpenQuestions(null, openQuestions),
      chatReadyMs,
      apiCallMs,
    }
  }
}
