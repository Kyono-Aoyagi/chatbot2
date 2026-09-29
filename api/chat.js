import { askGemini } from './_lib/gemini.js'
import { insertLog } from './_lib/supabase.js'

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
    const { activeCode, currentStep, userMessage, history, sessionId, condition, mentalModel, openQuestions } = req.body ?? {}

    if (!activeCode?.code || !userMessage) {
      return res.status(400).json({ error: 'activeCode.code と userMessage は必須です。' })
    }

    const t0 = Date.now()
    const { reply, advance, move, note, retries, mentalModel: nextMentalModel, openQuestions: nextOpenQuestions, chatReadyMs, apiCallMs } = await askGemini({
      activeCode,
      currentStep,
      userMessage,
      history,
      condition,
      mentalModel,
      openQuestions,
    })
    const totalMs = Date.now() - t0

    // チャットの往復をSupabaseに保存（本番ではVercel Logsではなくこちらを一次ソースにする）
    // opportunistic条件ではmentalModel/openQuestionsのスナップショットも残し、
    // 保留→解決の推移や再訪の頻度を後からログだけで追えるようにする。
    await insertLog({
      sessionId,
      eventType: 'chat',
      condition,
      currentStep,
      userMessage,
      reply,
      advance,
      move,
      note,
      retries,
      mentalModel: nextMentalModel,
      openQuestions: nextOpenQuestions,
      totalMs,
      chatReadyMs,
      apiCallMs,
    })

    return res.status(200).json({ reply, advance, mentalModel: nextMentalModel, openQuestions: nextOpenQuestions })
  } catch (error) {
    console.error('[api/chat error]', error)

    // Gemini側の高負荷など一時的なエラーは、リトライ後も失敗した場合にここへ来る（gemini.js が transient を付ける）。
    // 利用者向けには短い案内文を返し、生のエラー文は返さない（ログには残す）。
    const busy = error?.transient === true
    try {
      const { sessionId, condition, currentStep, userMessage } = req.body ?? {}
      await insertLog({
        sessionId,
        eventType: 'chat_error',
        condition,
        currentStep,
        userMessage,
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
