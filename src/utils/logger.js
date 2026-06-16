/**
 * フロントエンド側のロガー
 * サーバーの /api/log エンドポイントにイベントを送信する
 *
 * 将来の拡張:
 *  - オフライン時のキューイング（localStorage → 再接続時に送信）
 *  - イベント種別の拡張（コードのスクロール位置、滞在時間など）
 */

const API_BASE = '/api'

export async function logEvent(sessionId, eventType, payload = {}) {
  try {
    await fetch(`${API_BASE}/log`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        sessionId,
        eventType,   // 'highlight' | 'code_load' | 'session_start' | ...
        ...payload,
      }),
    })
  } catch (err) {
    // ログ失敗はサイレントに（学習体験を妨げない）
    console.warn('ログ送信失敗:', err)
  }
}

/**
 * セッションIDを生成（UUIDライク）
 * 将来: 認証後はサーバー発行のIDに置き換え
 */
export function generateSessionId() {
  return `sess_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`
}
