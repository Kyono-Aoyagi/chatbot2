/**
 * グローバルヘッダー
 * 将来: コース選択・ユーザー情報・設定へのナビゲーション
 */

import { LEVEL_LABELS } from '../utils/systemPrompt'
import './Header.css'

export function Header({ settings, onSettingsChange, onCodeLoad }) {
  const handleFileOpen = (e) => {
    const file = e.target.files?.[0]
    if (!file) return
    const reader = new FileReader()
    reader.onload = (ev) => {
      const ext = file.name.split('.').pop().toLowerCase()
      const langMap = { py: 'python', js: 'javascript', ts: 'typescript', java: 'java', c: 'c', cpp: 'cpp', go: 'go', rs: 'rust' }
      onCodeLoad(ev.target.result, langMap[ext] ?? 'other')
    }
    reader.readAsText(file)
    e.target.value = ''
  }

  return (
    <header className="app-header">
      <div className="app-header__brand">
        <span className="app-header__logo">◈</span>
        <span className="app-header__name">コードリーディング支援</span>
      </div>

      <div className="app-header__controls">
        {/* ファイル読み込み */}
        <label className="header-btn" title="ファイルを開く">
          📂 ファイルを開く
          <input type="file" hidden accept=".py,.js,.ts,.java,.c,.cpp,.go,.rs,.txt" onChange={handleFileOpen} />
        </label>

        {/* 難易度選択 */}
        <select
          className="header-select"
          value={settings.level}
          onChange={e => onSettingsChange({ ...settings, level: e.target.value })}
          aria-label="学習レベル"
        >
          {Object.entries(LEVEL_LABELS).map(([val, label]) => (
            <option key={val} value={val}>{label}</option>
          ))}
        </select>
      </div>
    </header>
  )
}
