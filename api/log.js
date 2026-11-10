import { insertLog } from './_lib/supabase.js'
import { evaluateCompletion } from './_lib/tutorState.js'

function sanitizeStudyContext(value) {
  const cleanToken = token => {
    const text = String(token ?? '').trim()
    return /^[A-Za-z0-9_-]{1,32}$/.test(text) ? text : null
  }
  const roundValue = String(value?.round ?? '')
  const orderValue = Number(value?.problemOrder)
  return {
    schemaVersion: 'study-log-v1',
    participantId: cleanToken(value?.participantId),
    round: ['1', '2', 'pre', 'post'].includes(roundValue) ? roundValue : null,
    problemSetId: cleanToken(value?.problemSetId),
    problemOrder: Number.isInteger(orderValue) && orderValue > 0 ? orderValue : null,
    isTest: value?.isTest === true,
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
    const event = req.body ?? {}
    event.studyContext = sanitizeStudyContext(event.studyContext)

    // クライアントが送る session_complete は「理解できた」ボタンによる終了。
    // 問題ごとの確認ポイントが残っていれば closed_with_gaps として理由を記録する。
    // この運用判定は研究成果の評価とは区別する。
    // （システムによる終了は api/chat.js が reason:'system' で記録する）
    if (event.eventType === 'session_complete') {
      const { ok, gaps } = evaluateCompletion(event)
      event.reason = ok ? 'user_declared' : 'closed_with_gaps'
      event.gaps = gaps
    }

    const saved = await insertLog(event)
    if (!saved && event.studyContext?.participantId) {
      return res.status(503).json({ error: '研究ログを保存できませんでした。通信状態を確認してください。' })
    }
    return res.status(200).json({ ok: true })
  } catch (error) {
    console.error('[api/log error]', error)
    return res.status(500).json({ error: error.message })
  }
}
