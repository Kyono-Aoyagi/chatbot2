/**
 * チャット状態管理フック
 *
 * 将来の拡張:
 *  - メッセージ履歴の永続化（sessionStorage / IndexedDB）
 *  - ストリーミングレスポンス対応（SSE）
 *  - 会話リセット・分岐機能
 */

import { useState, useCallback } from 'react'
import { buildSystemPrompt } from '../utils/systemPrompt'
import { logEvent } from '../utils/logger'

const API_BASE = '/api'

export function useChat({ sessionId, codeContext, settings }) {
  const [messages, setMessages] = useState([])   // { role: 'user'|'assistant', content: string }[]
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState(null)

  const sendMessage = useCallback(async (userText) => {
    if (!userText.trim() || isLoading) return

    const newMessages = [...messages, { role: 'user', content: userText }]
    setMessages(newMessages)
    setIsLoading(true)
    setError(null)

    try {
      const systemPrompt = buildSystemPrompt({
        language: codeContext.language,
        level: settings.level,
      })

      const res = await fetch(`${API_BASE}/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          messages: newMessages,
          systemPrompt,
          sessionId,
          codeContext: {
            code: codeContext.code,
            selectedText: codeContext.selectedText,
          },
        }),
      })

      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const { reply } = await res.json()

      setMessages(prev => [...prev, { role: 'assistant', content: reply }])
    } catch (err) {
      setError(err.message)
    } finally {
      setIsLoading(false)
    }
  }, [messages, isLoading, sessionId, codeContext, settings])

  const resetChat = useCallback(() => {
    setMessages([])
    setError(null)
    logEvent(sessionId, 'chat_reset')
  }, [sessionId])

  return { messages, isLoading, error, sendMessage, resetChat }
}
