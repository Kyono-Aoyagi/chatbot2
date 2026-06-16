/**
 * 右ペイン: チャットパネル
 *
 * 将来の拡張:
 *  - メッセージへのピン留め・引用機能
 *  - チャット履歴のエクスポート
 *  - 音声入力対応
 */

import { useRef, useEffect, useState } from 'react'
import './ChatPanel.css'

export function ChatPanel({ messages, isLoading, error, selectedText, onSend, onReset }) {
  const [input, setInput] = useState('')
  const bottomRef = useRef(null)
  const inputRef = useRef(null)

  // 新しいメッセージが来たら最下部へスクロール
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages, isLoading])

  const submit = () => {
    if (!input.trim()) return
    onSend(input.trim())
    setInput('')
  }

  const handleKeyDown = (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      submit()
    }
  }

  // 選択テキストをインプットに挿入
  const insertSelection = () => {
    if (!selectedText) return
    setInput(prev => prev ? `${prev}\n\n選択箇所: 「${selectedText}」` : `選択箇所: 「${selectedText}」`)
    inputRef.current?.focus()
  }

  return (
    <section className="chat-panel" aria-label="チャット">
      {/* ヘッダー */}
      <div className="chat-header">
        <span className="chat-header__title">チューター</span>
        <button className="chat-header__reset" onClick={onReset} title="会話をリセット">
          ↺ リセット
        </button>
      </div>

      {/* メッセージ一覧 */}
      <div className="chat-messages">
        {messages.length === 0 && (
          <div className="chat-empty">
            <p className="chat-empty__icon">🔍</p>
            <p className="chat-empty__text">
              左のコードを読んで、気になる点や疑問を入力してください。<br />
              チューターが質問を通じて思考を深めるサポートをします。
            </p>
          </div>
        )}

        {messages.map((msg, i) => (
          <div key={i} className={`chat-message chat-message--${msg.role}`}>
            <span className="chat-message__label">
              {msg.role === 'user' ? 'あなた' : 'チューター'}
            </span>
            <div className="chat-message__content">{msg.content}</div>
          </div>
        ))}

        {isLoading && (
          <div className="chat-message chat-message--assistant">
            <span className="chat-message__label">チューター</span>
            <div className="chat-loading">
              <span /><span /><span />
            </div>
          </div>
        )}

        {error && (
          <div className="chat-error">⚠ {error}</div>
        )}

        <div ref={bottomRef} />
      </div>

      {/* 選択テキスト挿入バー */}
      {selectedText && (
        <button className="chat-selection-bar" onClick={insertSelection}>
          <span className="chat-selection-bar__text">
            「{selectedText.slice(0, 40)}{selectedText.length > 40 ? '…' : ''}」を質問に追加
          </span>
          <span className="chat-selection-bar__icon">＋</span>
        </button>
      )}

      {/* 入力エリア */}
      <div className="chat-input-area">
        <textarea
          ref={inputRef}
          className="chat-input"
          value={input}
          onChange={e => setInput(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="質問や考えを入力（Enter で送信、Shift+Enter で改行）"
          rows={3}
          aria-label="メッセージ入力"
        />
        <button
          className="chat-send"
          onClick={submit}
          disabled={isLoading || !input.trim()}
          aria-label="送信"
        >
          送信
        </button>
      </div>
    </section>
  )
}
