import { LEVEL_LABELS, MODE_LABELS } from '../utils/systemPrompt'
import './Header.css'

const LANGUAGE_BY_EXTENSION = {
  py: 'python',
  js: 'javascript',
  jsx: 'javascript',
  ts: 'typescript',
  tsx: 'typescript',
  java: 'java',
  c: 'c',
  h: 'c',
  cpp: 'cpp',
  hpp: 'cpp',
  go: 'go',
  rs: 'rust',
  rb: 'ruby',
  php: 'php',
  txt: 'text',
}

export function Header({ settings, sessionLabel, onSettingsChange, onCodeLoad }) {
  const handleFileOpen = (event) => {
    const file = event.target.files?.[0]
    if (!file) return

    const reader = new FileReader()
    reader.onload = (readerEvent) => {
      const text = String(readerEvent.target?.result ?? '')
      const ext = file.name.split('.').pop()?.toLowerCase()
      onCodeLoad(text, LANGUAGE_BY_EXTENSION[ext] ?? 'unknown')
    }
    reader.readAsText(file)
    event.target.value = ''
  }

  const updateSetting = (key, value) => {
    onSettingsChange({ ...settings, [key]: value })
  }

  return (
    <header className="app-header">
      <div className="app-header__brand">
        <span className="app-header__logo" aria-hidden="true">CR</span>
        <div>
          <div className="app-header__name">コードリーディング支援</div>
          <div className="app-header__session">Session {sessionLabel}</div>
        </div>
      </div>

      <div className="app-header__controls">
        <label className="header-btn">
          ファイルを開く
          <input
            type="file"
            hidden
            accept=".py,.js,.jsx,.ts,.tsx,.java,.c,.h,.cpp,.hpp,.go,.rs,.rb,.php,.txt"
            onChange={handleFileOpen}
          />
        </label>

        <select
          className="header-select"
          value={settings.level}
          onChange={event => updateSetting('level', event.target.value)}
          aria-label="学習レベル"
        >
          {Object.entries(LEVEL_LABELS).map(([value, label]) => (
            <option key={value} value={value}>{label}</option>
          ))}
        </select>

        <select
          className="header-select"
          value={settings.mode}
          onChange={event => updateSetting('mode', event.target.value)}
          aria-label="応答モード"
        >
          {Object.entries(MODE_LABELS).map(([value, label]) => (
            <option key={value} value={value}>{label}</option>
          ))}
        </select>
      </div>
    </header>
  )
}
