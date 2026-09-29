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
    const { reply, advance, move, note, mentalModel: nextMentalModel, openQuestions: nextOpenQuestions, chatReadyMs, apiCallMs } = await askGemini({
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
      mentalModel: nextMentalModel,
      openQuestions: nextOpenQuestions,
      totalMs,
      chatReadyMs,
      apiCallMs,
    })

    return res.status(200).json({ reply, advance, mentalModel: nextMentalModel, openQuestions: nextOpenQuestions })
  } catch (error) {
    console.error('[api/chat error]', error)
    return res.status(500).json({ error: error.message })
  }
}
