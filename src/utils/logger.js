const API_BASE = '/api'

export function generateSessionId() {
  return `sess_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`
}

// 研究用の任意メタデータ。URLには匿名IDのみを指定し、氏名などの個人情報は入れない。
// 例: ?participantId=P01&round=1&setId=A&order=1&isTest=1
export function readStudyContext(search = window.location.search) {
  const params = new URLSearchParams(search)
  const cleanToken = (value, maxLength = 32) => {
    const token = String(value ?? '').trim()
    return /^[A-Za-z0-9_-]+$/.test(token) && token.length <= maxLength ? token : null
  }
  const roundValue = params.get('round')
  const round = ['1', '2', 'pre', 'post'].includes(roundValue) ? roundValue : null
  const orderValue = params.get('order')
  const parsedOrder = /^\d{1,2}$/.test(orderValue ?? '') ? Number(orderValue) : null
  const order = parsedOrder > 0 ? parsedOrder : null

  return {
    schemaVersion: 'study-log-v1',
    participantId: cleanToken(params.get('participantId')),
    round,
    problemSetId: cleanToken(params.get('setId')),
    problemOrder: order,
    isTest: params.get('isTest') === '1',
  }
}

export async function logEvent(event) {
  try {
    const response = await fetch(`${API_BASE}/log`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(event),
    })
    return response.ok
  } catch (error) {
    console.warn('ログ保存に失敗しました', error)
    return false
  }
}

export async function evaluateStudyResponses({ sessionId, codeId, studyContext, snapshots }) {
  const response = await fetch(`${API_BASE}/study-evaluation`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ sessionId, codeId, studyContext, snapshots }),
  })
  if (!response.ok) {
    const error = await response.json().catch(() => ({}))
    throw new Error(error.error ?? `自動採点に失敗しました (${response.status})`)
  }
  return response.json()
}
