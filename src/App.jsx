import { useRef, useState } from 'react'
import { PRESET_CODES, createUserCode } from './data/codeLibrary'
import { STEP_LABELS, getInitialBotMessage, sendToGemini } from './bot/geminiBot'
import { generateSessionId, logEvent } from './utils/logger'
import './styles/global.css'

// セッションIDはアプリ起動時に1度だけ生成
const sessionId = generateSessionId()

// ---- SelectionPhase ----

function SelectionPhase({ onStart }) {
  const [tab, setTab] = useState('preset') // 'preset' | 'paste'
  const [pasteCode, setPasteCode] = useState('')
  const [pasteLanguage, setPasteLanguage] = useState('python')
  const [pasteTitle, setPasteTitle] = useState('')
  const [pasteError, setPasteError] = useState('')

  const handlePresetSelect = (codeObj) => {
    onStart(codeObj)
  }

  const handlePasteStart = () => {
    if (!pasteCode.trim()) {
      setPasteError('コードを貼り付けてください。')
      return
    }
    setPasteError('')
    onStart(createUserCode({ code: pasteCode, language: pasteLanguage, title: pasteTitle }))
  }

  return (
    <div className="app">
      <header className="header">
        <div>
          <h1>コードリーディング練習</h1>
          <p>取り組むコードを選んでください</p>
        </div>
      </header>

      <main className="selection-main">
        <div className="tab-bar">
          <button
            type="button"
            className={`tab-button ${tab === 'preset' ? 'tab-button--active' : ''}`}
            onClick={() => setTab('preset')}
          >
            サンプルから選ぶ
          </button>
          <button
            type="button"
            className={`tab-button ${tab === 'paste' ? 'tab-button--active' : ''}`}
            onClick={() => setTab('paste')}
          >
            コードを貼り付ける
          </button>
        </div>

        {tab === 'preset' && (
          <div className="preset-list">
            {PRESET_CODES.map(code => (
              <button
                key={code.id}
                type="button"
                className="preset-card"
                onClick={() => handlePresetSelect(code)}
              >
                <span className="preset-card__title">{code.title}</span>
                <span className="preset-card__meta">{code.language} · {code.filename}</span>
              </button>
            ))}
          </div>
        )}

        {tab === 'paste' && (
          <div className="paste-form">
            <div className="paste-form__row">
              <label className="paste-form__label">
                タイトル（任意）
                <input
                  type="text"
                  className="paste-form__input"
                  placeholder="例：二分探索"
                  value={pasteTitle}
                  onChange={e => setPasteTitle(e.target.value)}
                />
              </label>
              <label className="paste-form__label">
                言語
                <select
                  className="paste-form__input"
                  value={pasteLanguage}
                  onChange={e => setPasteLanguage(e.target.value)}
                >
                  <option value="python">Python</option>
                  <option value="javascript">JavaScript</option>
                  <option value="typescript">TypeScript</option>
                  <option value="ruby">Ruby</option>
                  <option value="java">Java</option>
                  <option value="go">Go</option>
                  <option value="rust">Rust</option>
                  <option value="c">C</option>
                  <option value="cpp">C++</option>
                </select>
              </label>
            </div>
            <textarea
              className="paste-form__textarea"
              placeholder="ここにコードを貼り付けてください"
              value={pasteCode}
              onChange={e => { setPasteCode(e.target.value); setPasteError('') }}
              spellCheck={false}
            />
            {pasteError && <p className="paste-form__error">{pasteError}</p>}
            <button type="button" className="primary-button" onClick={handlePasteStart}>
              練習を始める
            </button>
          </div>
        )}
      </main>
    </div>
  )
}

// ---- ChattingPhase ----

function ChattingPhase({ activeCode, onChangeCode }) {
  const [messages, setMessages] = useState(() => [getInitialBotMessage(activeCode.title)])
  const [input, setInput] = useState('')
  const [step, setStep] = useState('purpose')
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState('')
  const messagesEndRef = useRef(null)

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }

  const sendMessage = async () => {
    const text = input.trim()
    if (!text || isLoading) return

    const userMessage = {
      role: 'user',
      content: text,
      step,
      timestamp: new Date().toISOString(),
    }

    setMessages(prev => [...prev, userMessage])
    setInput('')
    setIsLoading(true)
    setError('')

    try {
      const botReply = await sendToGemini({
        sessionId,
        activeCode,
        currentStep: step,
        messages: [...messages, userMessage],
        userMessage: text,
      })

      const botMessage = {
        role: 'bot',
        content: botReply.content,
        step: botReply.nextStep,
        timestamp: new Date().toISOString(),
      }

      setMessages(prev => [...prev, botMessage])
      setStep(botReply.nextStep)

      logEvent({ sessionId, eventType: 'step_change', from: step, to: botReply.nextStep })
    } catch (err) {
      setError(err.message)
    } finally {
      setIsLoading(false)
      setTimeout(scrollToBottom, 50)
    }
  }

  const handleKeyDown = (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      sendMessage()
    }
  }

  return (
    <div className="app">
      <header className="header">
        <div>
          <h1>{activeCode.title}</h1>
          <p>{activeCode.filename}</p>
        </div>
        <button type="button" className="secondary-button" onClick={onChangeCode}>
          コードを変える
        </button>
      </header>

      <main className="main">
        {/* コードペイン */}
        <section className="code-pane" aria-label="コード">
          <div className="pane-title">
            <span>{activeCode.filename}</span>
            <span>{activeCode.language}</span>
          </div>
          <pre className="code-block">
            <code>{activeCode.code}</code>
          </pre>
        </section>

        {/* チャットペイン */}
        <section className="chat-pane" aria-label="チャット">
          <div className="pane-title">
            <span>チャット</span>
            <span>ステップ: {STEP_LABELS[step] ?? step}</span>
          </div>

          <div className="messages">
            {messages.map((message, index) => (
              <article
                key={`${message.role}-${index}`}
                className={`message message--${message.role}`}
              >
                <div className="message-label">
                  {message.role === 'user' ? 'あなた' : 'AI'}
                </div>
                <div className="message-body">{message.content}</div>
              </article>
            ))}

            {isLoading && (
              <article className="message message--bot">
                <div className="message-label">AI</div>
                <div className="message-body message-body--loading">考えています…</div>
              </article>
            )}

            {error && (
              <p className="chat-error">⚠️ {error}</p>
            )}

            <div ref={messagesEndRef} />
          </div>

          <div className="input-area">
            <textarea
              value={input}
              onChange={e => setInput(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="考えたことを書いてください（Shift+Enterで改行）"
              rows={3}
              disabled={isLoading}
            />
            <button
              type="button"
              onClick={sendMessage}
              disabled={!input.trim() || isLoading}
            >
              送信
            </button>
          </div>
        </section>
      </main>
    </div>
  )
}

// ---- App（フェーズ管理） ----

export default function App() {
  const [phase, setPhase] = useState('selecting') // 'selecting' | 'chatting'
  const [activeCode, setActiveCode] = useState(null)

  const handleStart = (codeObj) => {
    setActiveCode(codeObj)
    setPhase('chatting')
    logEvent({ sessionId, eventType: 'session_start', codeId: codeObj.id, source: codeObj.source })
  }

  const handleChangeCode = () => {
    setPhase('selecting')
    setActiveCode(null)
  }

  if (phase === 'selecting') {
    return <SelectionPhase onStart={handleStart} />
  }

  return <ChattingPhase activeCode={activeCode} onChangeCode={handleChangeCode} />
}
