/**
 * 左ペイン: コード表示パネル
 *
 * 将来の拡張:
 *  - Monaco Editor 統合（シンタックスハイライト強化・行番号クリック）
 *  - 行単位のコメント/アノテーション
 *  - ファイルドロップ対応
 */

import { useRef, useEffect, useState } from 'react'
import './CodePanel.css'

const LANGUAGES = ['python', 'javascript', 'typescript', 'java', 'c', 'cpp', 'go', 'rust', 'other']

export function CodePanel({ code, language, onCodeChange, onLanguageChange, onSelection }) {
  const textareaRef = useRef(null)
  const [isEditing, setIsEditing] = useState(false)

  // テキスト選択を親に通知
  const handleMouseUp = () => {
    const sel = window.getSelection()?.toString().trim()
    if (sel) onSelection(sel)
  }

  // コードが外部から変わった時にスクロールをトップへ
  useEffect(() => {
    if (textareaRef.current && !isEditing) {
      textareaRef.current.scrollTop = 0
    }
  }, [code, isEditing])

  return (
    <section className="code-panel" aria-label="コードビューア">
      {/* ツールバー */}
      <div className="code-toolbar">
        <span className="code-toolbar__title">コード</span>

        <select
          className="code-toolbar__lang"
          value={language}
          onChange={e => onLanguageChange(e.target.value)}
          aria-label="言語選択"
        >
          {LANGUAGES.map(l => (
            <option key={l} value={l}>{l}</option>
          ))}
        </select>

        <button
          className={`code-toolbar__btn ${isEditing ? 'code-toolbar__btn--active' : ''}`}
          onClick={() => setIsEditing(v => !v)}
          title={isEditing ? '表示モードに切替' : '編集モードに切替'}
        >
          {isEditing ? '✓ 完了' : '✎ 編集'}
        </button>
      </div>

      {/* コードエリア */}
      <div className="code-body" onMouseUp={handleMouseUp}>
        {isEditing ? (
          <textarea
            ref={textareaRef}
            className="code-editor"
            value={code}
            onChange={e => onCodeChange(e.target.value)}
            spellCheck={false}
            aria-label="コード編集エリア"
          />
        ) : (
          <pre className="code-display">
            <code>{code}</code>
          </pre>
        )}
      </div>

      {/* 選択テキストのヒント */}
      <div className="code-hint">
        コードを選択してチャットに送ると、その部分について質問できます
      </div>
    </section>
  )
}
