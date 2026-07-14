import { useEffect, useRef, useState } from 'react'
import { PRESET_CODES, createUserCode } from './data/codeLibrary'
import { STEP_LABELS, getInitialBotMessage, sendToGemini } from './bot/geminiBot'
import { generateSessionId, logEvent } from './utils/logger'
import { getStoredAccessCode, setStoredAccessCode, verifyAccessCode } from './utils/accessCode'
import './styles/global.css'

const USER_CODES_STORAGE_KEY = 'code-reading-tutor.user-codes'
const MAX_STORED_USER_CODES = 50
const INDENT_COLUMNS = 4

function loadStoredUserCodes() {
  try {
    const raw = window.localStorage.getItem(USER_CODES_STORAGE_KEY)
    const parsed = raw ? JSON.parse(raw) : []
    return Array.isArray(parsed) ? parsed : []
  } catch {
    return []
  }
}

function saveStoredUserCodes(codes) {
  window.localStorage.setItem(USER_CODES_STORAGE_KEY, JSON.stringify(codes))
}

function countIndentColumns(line) {
  let columns = 0

  for (const char of line) {
    if (char === ' ') {
      columns += 1
    } else if (char === '\t') {
      columns += INDENT_COLUMNS
    } else {
      break
    }
  }

  return columns
}

function CodeBlock({ code }) {
  const lines = code.split('\n')

  return (
    <div className="code-block">
      {lines.map((line, index) => {
        const indentLevel = Math.floor(countIndentColumns(line) / INDENT_COLUMNS)

        return (
          <div className="code-line" key={index}>
            <span className="line-number">{index + 1}</span>
            <span className="code-cell">
              {Array.from({ length: indentLevel }, (_, guideIndex) => (
                <span
                  aria-hidden="true"
                  className="indent-guide"
                  key={guideIndex}
                  style={{ '--guide-index': guideIndex }}
                />
              ))}
              <code>{line || ' '}</code>
            </span>
          </div>
        )
      })}
    </div>
  )
}

// ---- AccessGate ----

function AccessGate({ onPass }) {
  const [code, setCode] = useState('')
  const [error, setError] = useState('')
  const [isChecking, setIsChecking] = useState(false)

  const handleSubmit = async (e) => {
    e.preventDefault()
    if (!code.trim() || isChecking) return

    setIsChecking(true)
    setError('')

    try {
      const ok = await verifyAccessCode(code.trim())
      if (ok) {
        setStoredAccessCode(code.trim())
        onPass()
      } else {
        setError('合言葉が正しくありません。')
      }
    } catch {
      setError('確認中にエラーが発生しました。時間をおいて再度お試しください。')
    } finally {
      setIsChecking(false)
    }
  }

  return (
    <div className="app">
      <header className="header">
        <div>
          <h1>コードリーディング練習</h1>
          <p>合言葉を入力してください</p>
        </div>
      </header>
      <main className="selection-main">
        <form className="paste-form" onSubmit={handleSubmit}>
          <label className="paste-form__label">
            合言葉
            <input
              type="password"
              className="paste-form__input"
              value={code}
              onChange={e => { setCode(e.target.value); setError('') }}
              autoFocus
            />
          </label>
          {error && <p className="paste-form__error">{error}</p>}
          <button type="submit" className="primary-button" disabled={!code.trim() || isChecking}>
            {isChecking ? '確認中...' : '入室する'}
          </button>
        </form>
      </main>
    </div>
  )
}

// ---- SelectionPhase ----

function SelectionPhase({ onStart }) {
  const [tab, setTab] = useState('preset') // 'preset' | 'saved' | 'paste'
  const [savedCodes, setSavedCodes] = useState(loadStoredUserCodes)
  const [pasteCode, setPasteCode] = useState('')
  const [pasteLanguage, setPasteLanguage] = useState('python')
  const [pasteTitle, setPasteTitle] = useState('')
  const [pasteError, setPasteError] = useState('')

  const handleSelect = (codeObj) => {
    onStart(codeObj)
  }

  const handlePasteStart = () => {
    if (!pasteCode.trim()) {
      setPasteError('コードを貼り付けてください。')
      return
    }

    const userCode = createUserCode({
      code: pasteCode,
      language: pasteLanguage,
      title: pasteTitle,
    })

    setPasteError('')
    const nextSavedCodes = [userCode, ...savedCodes.filter(code => code.id !== userCode.id)]
      .slice(0, MAX_STORED_USER_CODES)
    saveStoredUserCodes(nextSavedCodes)
    setSavedCodes(nextSavedCodes)
    onStart(userCode)
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
            サンプル
          </button>
          <button
            type="button"
            className={`tab-button ${tab === 'saved' ? 'tab-button--active' : ''}`}
            onClick={() => setTab('saved')}
          >
            保存済み
          </button>
          <button
            type="button"
            className={`tab-button ${tab === 'paste' ? 'tab-button--active' : ''}`}
            onClick={() => setTab('paste')}
          >
            コードを追加
          </button>
        </div>

        {tab === 'preset' && (
          <div className="preset-list">
            {PRESET_CODES.map(code => (
              <button
                key={code.id}
                type="button"
                className="preset-card"
                onClick={() => handleSelect(code)}
              >
                <span className="preset-card__title">{code.title}</span>
                <span className="preset-card__meta">{code.language} / {code.filename}</span>
              </button>
            ))}
          </div>
        )}

        {tab === 'saved' && (
          <div className="preset-list">
            {savedCodes.length === 0 && (
              <p className="empty-state">まだ保存されたコードはありません。</p>
            )}
            {savedCodes.map(code => (
              <button
                key={code.id}
                type="button"
                className="preset-card"
                onClick={() => handleSelect(code)}
              >
                <span className="preset-card__title">{code.title}</span>
                <span className="preset-card__meta">{code.language} / {code.filename}</span>
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
                  placeholder="例: 二分探索"
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

function ChattingPhase({ activeCode, sessionId, onChangeCode }) {
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
      // API送信用に、直前までの会話履歴を role/content の配列に変換する
      // （今回のuserMessageは含めない。userMessage引数として別送信するため）
      const history = messages.map(m => ({ role: m.role, content: m.content }))

      const botReply = await sendToGemini({
        activeCode,
        currentStep: step,
        userMessage: text,
        history,
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
          コードを変更
        </button>
      </header>

      <main className="main">
        <section className="code-pane" aria-label="コード">
          <div className="pane-title">
            <span>{activeCode.filename}</span>
            <span>{activeCode.language}</span>
          </div>
          <CodeBlock code={activeCode.code} />
        </section>

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
                <div className="message-body message-body--loading">考えています...</div>
              </article>
            )}

            {error && (
              <p className="chat-error">エラー: {error}</p>
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

// ---- App ----

export default function App() {
  const [phase, setPhase] = useState('checking') // 'checking' | 'gate' | 'selecting' | 'chatting'
  const [activeCode, setActiveCode] = useState(null)
  const [sessionId, setSessionId] = useState(null)

  // 起動時に、以前保存した合言葉がまだ有効かをサーバーに確認し、
  // 有効ならゲートをスキップする。未保存・無効ならゲートを表示。
  useEffect(() => {
    const stored = getStoredAccessCode()
    if (!stored) {
      setPhase('gate')
      return
    }
    verifyAccessCode(stored).then(ok => {
      setPhase(ok ? 'selecting' : 'gate')
    })
  }, [])

  const handleStart = (codeObj) => {
    const newSessionId = generateSessionId()
    setSessionId(newSessionId)
    setActiveCode(codeObj)
    setPhase('chatting')
    logEvent({ sessionId: newSessionId, eventType: 'session_start', codeId: codeObj.id, source: codeObj.source })
  }

  const handleChangeCode = () => {
    setPhase('selecting')
    setActiveCode(null)
    setSessionId(null)
  }

  if (phase === 'checking') {
    return <div className="app" />
  }

  if (phase === 'gate') {
    return <AccessGate onPass={() => setPhase('selecting')} />
  }

  if (phase === 'selecting') {
    return <SelectionPhase onStart={handleStart} />
  }

  return <ChattingPhase activeCode={activeCode} sessionId={sessionId} onChangeCode={handleChangeCode} />
}
