import { useMemo, useState } from 'react'
import './CodePanel.css'

const LANGUAGES = [
  'python',
  'javascript',
  'typescript',
  'java',
  'c',
  'cpp',
  'go',
  'rust',
  'ruby',
  'php',
  'text',
  'unknown',
]

export function CodePanel({
  code,
  language,
  selectedText,
  onCodeChange,
  onLanguageChange,
  onSelection,
}) {
  const [isEditing, setIsEditing] = useState(false)

  const lineCount = useMemo(() => code.split('\n').length, [code])

  const handleSelection = () => {
    const selection = window.getSelection()?.toString() ?? ''
    onSelection(selection)
  }

  return (
    <div className="code-panel">
      <div className="code-toolbar">
        <div className="code-toolbar__meta">
          <span className="code-toolbar__title">Code</span>
          <span className="code-toolbar__count">{lineCount} lines</span>
        </div>

        <select
          className="code-toolbar__lang"
          value={language}
          onChange={event => onLanguageChange(event.target.value)}
          aria-label="言語"
        >
          {LANGUAGES.map(item => (
            <option key={item} value={item}>{item}</option>
          ))}
        </select>

        <button
          className={`code-toolbar__btn ${isEditing ? 'code-toolbar__btn--active' : ''}`}
          onClick={() => setIsEditing(value => !value)}
          type="button"
        >
          {isEditing ? '表示' : '編集'}
        </button>
      </div>

      <div className="code-body" onMouseUp={handleSelection} onKeyUp={handleSelection}>
        {isEditing ? (
          <textarea
            className="code-editor"
            value={code}
            onChange={event => onCodeChange(event.target.value, language)}
            spellCheck={false}
            aria-label="コード編集"
          />
        ) : (
          <pre className="code-display" tabIndex={0}>
            <code>{code}</code>
          </pre>
        )}
      </div>

      <div className="code-hint">
        {selectedText
          ? `選択中: ${selectedText.slice(0, 60)}${selectedText.length > 60 ? '...' : ''}`
          : '気になる行や式を選択すると、その範囲をもとに質問できます。'}
      </div>
    </div>
  )
}
