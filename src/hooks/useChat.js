import { useCallback, useState } from 'react'
import { buildSystemPrompt } from '../utils/systemPrompt'
import { logEvent } from '../utils/logger'

const API_BASE = '/api'

const INITIAL_MESSAGE = {
  role: 'assistant',
  content: 'まず、このコード全体は何をするためのものに見えますか？根拠になりそうな行を1つ探してみましょう。',
}

export function useChat({ sessionId, codeContext, settings }) {
  const [messages, setMessages] = useState([INITIAL_MESSAGE])
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState(null)

  const sendMessage = useCallback(async (userText) => {
    const trimmed = userText.trim()
    if (!trimmed || isLoading) return

    const nextMessages = [...messages, { role: 'user', content: trimmed }]
    setMessages(nextMessages)
    setIsLoading(true)
    setError(null)

    try {
      const systemPrompt = buildSystemPrompt({
        language: codeContext.language,
        level: settings.level,
        mode: settings.mode,
      })

      const apiMessages = nextMessages
        .filter((message, index) => index !== 0 && (message.role === 'user' || message.role === 'assistant'))
        .map(message => ({
          role: message.role,
          content: message.content,
        }))

      const response = await fetch(`${API_BASE}/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          messages: apiMessages,
          systemPrompt,
          sessionId,
          codeContext: {
            code: codeContext.code,
            language: codeContext.language,
            selectedText: codeContext.selectedText,
          },
          settings,
        }),
      })

      const data = await response.json()
      if (!response.ok) {
        throw new Error(data.error || `HTTP ${response.status}`)
      }

      setMessages(prev => [...prev, { role: 'assistant', content: data.reply }])
    } catch (err) {
      setError(err.message)
      logEvent(sessionId, 'chat_error', { message: err.message })
    } finally {
      setIsLoading(false)
    }
  }, [codeContext, isLoading, messages, sessionId, settings])

  const resetChat = useCallback(() => {
    setMessages([INITIAL_MESSAGE])
    setError(null)
    logEvent(sessionId, 'chat_reset')
  }, [sessionId])

  return {
    messages,
    isLoading,
    error,
    sendMessage,
    resetChat,
  }
}
