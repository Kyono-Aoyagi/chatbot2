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
    const { activeCode, currentStep, userMessage, history, condition, tutorState } = req.body ?? {}

    if (!activeCode?.code || !userMessage) {
      return res.status(400).json({ error: 'activeCode.code と userMessage は必須です。' })
    }

    const t0 = Date.now()
    const result = await askGemini({ activeCode, currentStep, userMessage, history, condition, tutorState })
    const totalMs = Date.now() - t0
    const { reply, advance, tutorState: nextState, phaseEvent } = result

    const context = buildLogContext(req.body)

    // チャットの往復をSupabaseに保存（本番ではVercel Logsではなくこちらを一次ソースにする）。
    // opportunistic条件では期待・why/how の理解状態と根拠発話・罠・支援段階のスナップショット（返答後）を保存する。
    // guidedのステップ遷移は currentStep（送信時点）と advance から導出できるので、step_change は別に残さない。
    await insertLog({
      ...context,
      eventType: 'chat',
      userMessage,
      reply,
      advance,
      userAct: result.userAct,
      move: result.move,
      note: result.note,
      parseFailed: result.parseFailed,
      retries: result.retries,
      ...(condition === 'opportunistic' ? {
        mentalModel: nextState.mentalModel,
        mentalModelEvidence: nextState.mentalModelEvidence,
      } : {}),
      expectationStates: nextState.expectationStates,
      trapStates: nextState.trapStates,
      focus: nextState.focus,
      phase: nextState.phase,
      pendingWrapUp: nextState.pendingWrapUp,
      phaseEvent,
      forcedWrapUp: result.forcedWrapUp,
      completionRejected: result.completionRejected,
      downgraded: result.downgraded,
      totalMs,
      apiCallMs: result.apiCallMs,
    })

    // 読解の終了・再開は、後から「何ターンで終わったか」を集計できるよう独立したイベントにも残す。
    // （ユーザーが「理解できた」ボタンで終えた場合は、クライアントが /api/log 経由で session_complete を送る）
    if (phaseEvent === 'complete') {
      await insertLog({
        ...context,
        eventType: 'session_complete',
        reason: 'system',
        gaps: [],
        forcedWrapUp: result.forcedWrapUp,
        mentalModel: nextState.mentalModel,
        mentalModelEvidence: nextState.mentalModelEvidence,
        expectationStates: nextState.expectationStates,
        trapStates: nextState.trapStates,
      })
    } else if (phaseEvent === 'reopen') {
      await insertLog({
        ...context,
        eventType: 'session_reopen',
        mentalModel: nextState.mentalModel,
        mentalModelEvidence: nextState.mentalModelEvidence,
        expectationStates: nextState.expectationStates,
        trapStates: nextState.trapStates,
      })
    }

    return res.status(200).json({ reply, advance, tutorState: nextState })
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
