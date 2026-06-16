/**
 * App.jsx — ルートコンポーネント
 *
 * レイアウト: Header + [CodePanel | ChatPanel]
 * 状態はすべてカスタムフックに委譲し、コンポーネントは表示のみ担当
 *
 * 将来の拡張ポイント:
 *  - React Router でページ分割（課題一覧 / セッション / ログビューア）
 *  - Context または Zustand でグローバル状態管理
 *  - ドラッグ可能なスプリッターでペイン幅を調整
 */

import { useState, useEffect } from 'react'
import { Header }     from './components/Header'
import { CodePanel }  from './components/CodePanel'
import { ChatPanel }  from './components/ChatPanel'
import { useChat }         from './hooks/useChat'
import { useCodeContext }  from './hooks/useCodeContext'
import { generateSessionId, logEvent } from './utils/logger'
import './styles/layout.css'

// セッションIDはアプリ起動時に1度だけ生成
const SESSION_ID = generateSessionId()

export default function App() {
  const [settings, setSettings] = useState({ level: 'beginner' })

  const codeCtx = useCodeContext(SESSION_ID)

  const { messages, isLoading, error, sendMessage, resetChat } = useChat({
    sessionId: SESSION_ID,
    codeContext: codeCtx,
    settings,
  })

  // セッション開始ログ
  useEffect(() => {
    logEvent(SESSION_ID, 'session_start')
  }, [])

  return (
    <div className="app-shell">
      <Header
        settings={settings}
        onSettingsChange={setSettings}
        onCodeLoad={codeCtx.loadCode}
      />

      <div className="app-body">
        {/* 左: コードビューア */}
        <div className="pane pane--code">
          <CodePanel
            code={codeCtx.code}
            language={codeCtx.language}
            onCodeChange={codeCtx.loadCode}
            onLanguageChange={codeCtx.setLanguage}
            onSelection={codeCtx.handleSelection}
          />
        </div>

        {/* 仕切り（将来: ドラッグリサイズ） */}
        <div className="pane-divider" role="separator" aria-orientation="vertical" />

        {/* 右: チャット */}
        <div className="pane pane--chat">
          <ChatPanel
            messages={messages}
            isLoading={isLoading}
            error={error}
            selectedText={codeCtx.selectedText}
            onSend={sendMessage}
            onReset={resetChat}
          />
        </div>
      </div>
    </div>
  )
}
