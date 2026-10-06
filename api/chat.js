import { askGemini, MODEL_NAME, PROMPT_VERSION } from './_lib/gemini.js'
import { insertLog } from './_lib/supabase.js'

// chat / chat_error の両方に付ける共通のログ項目。
// codeId: どの問題か。turn: このセッションの何ターン目のユーザー発言か（history中のuser発言数+1）。
// promptVersion / model: どの版のプロンプト・モデルで取った会話かを後から区別するため。
function buildLogContext(body) {
  const { activeCode, currentStep, history, sessionId, condition } = body ?? {}
  const turn = Array.isArray(history) ? history.filter(m => m?.role === 'user').length + 1 : 1
  return {
    sessionId,
    condition,
    currentStep,
    codeId: activeCode?.id ?? null,
    turn,
    promptVersion: PROMPT_VERSION,
    model: MODEL_NAME,
  }
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type')

  if (req.method === 'OPTIONS') {
    return res.status(204).end()
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method Not Allowed' })
  }

  try {
    const {
      activeCode, currentStep, userMessage, history, condition,
      mentalModel, openQuestions, trapStates, phase,
    } = req.body ?? {}

    if (!activeCode?.code || !userMessage) {
      return res.status(400).json({ error: 'activeCode.code と userMessage は必須です。' })
    }

    const t0 = Date.now()
    const {
      reply, advance, move, note, retries, regenerated, parseFailed,
      mentalModel: nextMentalModel, openQuestions: nextOpenQuestions, trapStates: nextTrapStates,
      phase: nextPhase, phaseEvent, done, completionRejected, apiCallMs,
    } = await askGemini({
      activeCode,
      currentStep,
      userMessage,
      history,
      condition,
      mentalModel,
      openQuestions,
      trapStates,
      phase,
    })
    const totalMs = Date.now() - t0

    const context = buildLogContext(req.body)

    // チャットの往復をSupabaseに保存（本番ではVercel Logsではなくこちらを一次ソースにする）
    // opportunistic条件ではmentalModel/openQuestions/trapStatesのスナップショット（この返答の「後」の状態）も残し、
    // 保留→解決の推移や再訪の頻度を後からログだけで追えるようにする。
    // guidedのステップ遷移は currentStep（送信時点）と advance から導出できるので、step_change は別に残さない。
    await insertLog({
      ...context,
      eventType: 'chat',
      userMessage,
      reply,
      advance,
      move,
      note,
      parseFailed,
      retries,
      regenerated,
      mentalModel: nextMentalModel,
      openQuestions: nextOpenQuestions,
      trapStates: nextTrapStates,
      phase: nextPhase,
      phaseEvent,
      done,
      completionRejected,
      totalMs,
      apiCallMs,
    })

    // 読解の終了・再開は、後から「何ターンで終わったか」を集計できるよう独立したイベントにも残す。
    // （ユーザーが「理解できた」ボタンで終えた場合は、クライアントが /api/log 経由で session_complete を送る）
    if (phaseEvent === 'complete') {
      await insertLog({
        ...context,
        eventType: 'session_complete',
        reason: 'system',
        gaps: [],
        mentalModel: nextMentalModel,
        openQuestions: nextOpenQuestions,
        trapStates: nextTrapStates,
      })
    } else if (phaseEvent === 'reopen') {
      await insertLog({
        ...context,
        eventType: 'session_reopen',
        mentalModel: nextMentalModel,
        openQuestions: nextOpenQuestions,
        trapStates: nextTrapStates,
      })
    }

    return res.status(200).json({
      reply,
      advance,
      mentalModel: nextMentalModel,
      openQuestions: nextOpenQuestions,
      trapStates: nextTrapStates,
      phase: nextPhase,
    })
  } catch (error) {
    console.error('[api/chat error]', error)

    // Gemini側の高負荷など一時的なエラーは、リトライ後も失敗した場合にここへ来る（gemini.js が transient を付ける）。
    // 利用者向けには短い案内文を返し、生のエラー文は返さない（ログには残す）。
    const busy = error?.transient === true
    try {
      await insertLog({
        ...buildLogContext(req.body),
        eventType: 'chat_error',
        userMessage: req.body?.userMessage,
        transient: busy,
        retries: error?.retries ?? null,
        errorMessage: String(error?.message ?? error).slice(0, 500),
      })
    } catch (logError) {
      console.error('[api/chat error log failed]', logError)
    }

    if (busy) {
      return res.status(503).json({
        error: 'AIが混み合っています。少し待ってからもう一度送信してください。',
        code: 'model_busy',
      })
    }
    return res.status(500).json({ error: error.message })
  }
}
