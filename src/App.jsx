import { useEffect, useMemo, useState } from 'react'
import { SAMPLE_PYTHON_CODE } from './data/samplePython'
import { getInitialBotMessage, getNextBotReply } from './bot/ruleBot'
import { generateSessionId, logEvent } from './utils/logger'
import './styles/global.css'

const sessionId = generateSessionId()

export default function App() {
  const [messages, setMessages] = useState(() => [getInitialBotMessage()])
  const [input, setInput] = useState('')
  const [step, setStep] = useState('purpose')

  const sessionStartedAt = useMemo(() => new Date().toISOString(), [])

  useEffect(() => {
    logEvent({
      sessionId,
      eventType: 'session_start',
      step: 'purpose',
      metadata: {
        codeId: 'sample_bubble_sort',
        language: 'python',
      },
    })
  }, [])

  const sendMessage = () => {
    const text = input.trim()
    if (!text) return

    const userMessage = {
      role: 'user',
      content: text,
      step,
      timestamp: new Date().toISOString(),
    }

    const botReply = getNextBotReply({ currentStep: step, userText: text })

    setMessages(current => [
      ...current,
      userMessage,
      {
        role: 'bot',
        content: botReply.content,
        step: botReply.nextStep,
        timestamp: new Date().toISOString(),
      },
    ])
    setStep(botReply.nextStep)
    setInput('')

    logEvent({
      sessionId,
      eventType: 'user_message',
      role: 'user',
      step,
      content: text,
    })
    logEvent({
      sessionId,
      eventType: 'bot_message',
      role: 'bot',
      step: botReply.nextStep,
      content: botReply.content,
    })
    if (botReply.nextStep !== step) {
      logEvent({
        sessionId,
        eventType: 'step_change',
        step: botReply.nextStep,
        metadata: {
          from: step,
          to: botReply.nextStep,
        },
      })
    }
  }

  const handleKeyDown = (event) => {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault()
      sendMessage()
    }
  }

  const resetSession = () => {
    const initialMessage = getInitialBotMessage()
    setMessages([initialMessage])
    setStep('purpose')
    setInput('')
    logEvent({
      sessionId,
      eventType: 'session_reset',
      step: 'purpose',
    })
  }

  return (
    <div className="app">
      <header className="header">
        <div>
          <h1>Pythonコードリーディング練習</h1>
          <p>APIなしのルールベースチャットボット</p>
        </div>
        <button className="secondary-button" type="button" onClick={resetSession}>
          リセット
        </button>
      </header>

      <main className="main">
        <section className="code-pane" aria-label="Pythonコード">
          <div className="pane-title">
            <span>sample_bubble_sort.py</span>
            <span>Python</span>
          </div>
          <pre className="code-block">
            <code>{SAMPLE_PYTHON_CODE}</code>
          </pre>
        </section>

        <section className="chat-pane" aria-label="チャット">
          <div className="pane-title">
            <span>チャット</span>
            <span>現在のステップ: {step}</span>
          </div>

          <div className="messages">
            {messages.map((message, index) => (
              <article key={`${message.role}-${index}`} className={`message message--${message.role}`}>
                <div className="message-label">
                  {message.role === 'user' ? 'あなた' : 'ボット'}
                </div>
                <div className="message-body">{message.content}</div>
              </article>
            ))}
          </div>

          <div className="input-area">
            <textarea
              value={input}
              onChange={event => setInput(event.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="考えたことを書いてください"
              rows={3}
            />
            <button type="button" onClick={sendMessage} disabled={!input.trim()}>
              送信
            </button>
          </div>
        </section>
      </main>

      <footer className="footer">
        セッションID: {sessionId} / 開始: {sessionStartedAt}
      </footer>
    </div>
  )
}
