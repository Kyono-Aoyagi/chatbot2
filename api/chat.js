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
    const { activeCode, currentStep, userMessage, history, sessionId } = req.body ?? {}

    if (!activeCode?.code || !userMessage) {
      return res.status(400).json({ error: 'activeCode.code と userMessage は必須です。' })
    }

    const t0 = Date.now()
    const { reply, advance, chatReadyMs, apiCallMs } = await askGemini({
      activeCode,
      currentStep,
      userMessage,
      history,
    })
    const totalMs = Date.now() - t0

    // チャットの往復をSupabaseに保存（本番ではVercel Logsではなくこちらを一次ソースにする）
    await insertLog({
      sessionId,
      eventType: 'chat',
      currentStep,
      userMessage,
      reply,
      advance,
      totalMs,
      chatReadyMs,
      apiCallMs,
    })

    return res.status(200).json({ reply, advance })
  } catch (error) {
    console.error('[api/chat error]', error)
    return res.status(500).json({ error: error.message })
  }
}
