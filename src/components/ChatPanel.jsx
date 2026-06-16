import { useEffect, useRef, useState } from 'react'
import './ChatPanel.css'

export function ChatPanel({ messages, isLoading, error, selectedText, onSend, onReset }) {
  const [input, setInput] = useState('')
  const bottomRef = useRef(null)
  const inputRef = useRef(null)

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' })
  }, [messages, isLoading, error])

  const submit = () => {
    const text = input.trim()
    if (!text || isLoading) return
    onSend(text)
    setInput('')
  }

  const handleKeyDown = (event) => {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault()
      submit()
    }
  }

  const insertSelectedText = () => {
    if (!selectedText) return
    const quote = `選択範囲:\n${selectedText}`
    setInput(current => (current.trim() ? `${current}\n\n${quote}` : quote))
    inputRef.current?.focus()
  }

  return (
    <div className="chat-panel">
      <div className="chat-header">
        <div>
          <div className="chat-header__title">Tutor</div>
          <div className="chat-header__subtitle">説明より、読むための問いを返します</div>
        </div>
        <button className="chat-header__reset" onClick={onReset} type="button">
          リセット
        </button>
      </div>

      <div className="chat-messages">
        {messages.map((message, index) => (
          <article key={`${message.role}-${index}`} className={`chat-message chat-message--${message.role}`}>
            <span className="chat-message__label">
              {message.role === 'user' ? 'あなた' : 'チューター'}
            </span>
            <div className="chat-message__content">{message.content}</div>
          </article>
        ))}

        {isLoading && (
          <article className="chat-message chat-message--assistant">
            <span className="chat-message__label">チューター</span>
            <div className="chat-loading" aria-label="返信を生成中">
              <span />
              <span />
              <span />
            </div>
          </article>
        )}

        {error && (
          <div className="chat-error" role="alert">
            {error}
          </div>
        )}

        <div ref={bottomRef} />
      </div>

      {selectedText && (
        <button className="chat-selection-bar" onClick={insertSelectedText} type="button">
          <span className="chat-selection-bar__text">
            選択範囲を質問に追加: {selectedText.slice(0, 44)}{selectedText.length > 44 ? '...' : ''}
          </span>
          <span className="chat-selection-bar__icon" aria-hidden="true">+</span>
        </button>
      )}

      <div className="chat-input-area">
        <textarea
          ref={inputRef}
          className="chat-input"
          value={input}
          onChange={event => setInput(event.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="気づいたこと、迷っていることを書いてください"
          rows={3}
          aria-label="メッセージ"
        />
        <button
          className="chat-send"
          onClick={submit}
          disabled={isLoading || !input.trim()}
          type="button"
        >
          送信
        </button>
      </div>
    </div>
  )
}
