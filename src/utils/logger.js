const API_BASE = '/api'

export function generateSessionId() {
  const rand = Math.random().toString(36).slice(2, 8)
  return `sess_${Date.now()}_${rand}`
}

export async function logEvent(sessionId, eventType, payload = {}) {
  try {
    await fetch(`${API_BASE}/log`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        sessionId,
        eventType,
        payload,
      }),
    })
  } catch (error) {
    console.warn('ログ送信に失敗しました', error)
  }
}
