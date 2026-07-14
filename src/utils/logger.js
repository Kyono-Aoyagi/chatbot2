const API_BASE = '/api'
import { getStoredAccessCode } from './accessCode'

export function generateSessionId() {
  return `sess_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`
}

export async function logEvent(event) {
  try {
    await fetch(`${API_BASE}/log`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...event, accessCode: getStoredAccessCode() }),
    })
  } catch (error) {
    console.warn('ログ保存に失敗しました', error)
  }
}
