import { insertLog } from './_lib/supabase.js'
import { evaluateCompletion } from './_lib/tutorState.js'

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
    const event = req.body ?? {}

    // クライアントが送る session_complete は「理解できた」ボタンによる終了。
    // 終了条件（why/howがconfirmed、ユーザー由来の問いが解決済み、罠が未解消でない）を満たしていないのに
    // ユーザーが終えた場合は、reason を closed_with_gaps にして、残っていた理由を gaps に記録する。
    // （システムによる終了は api/chat.js が reason:'system' で記録する）
    if (event.eventType === 'session_complete') {
      const { ok, gaps } = evaluateCompletion(event)
      event.reason = ok ? 'user_declared' : 'closed_with_gaps'
      event.gaps = gaps
    }

    await insertLog(event)
    return res.status(200).json({ ok: true })
  } catch (error) {
    console.error('[api/log error]', error)
    return res.status(500).json({ error: error.message })
  }
}
