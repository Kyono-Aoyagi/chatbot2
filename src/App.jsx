import { useEffect, useMemo, useState } from 'react'
import { Header } from './components/Header'
import { CodePanel } from './components/CodePanel'
import { ChatPanel } from './components/ChatPanel'
import { useChat } from './hooks/useChat'
import { useCodeContext } from './hooks/useCodeContext'
import { generateSessionId, logEvent } from './utils/logger'
import './styles/layout.css'

const SESSION_ID = generateSessionId()

export default function App() {
  const [settings, setSettings] = useState({
    level: 'beginner',
    mode: 'socratic',
  })

  const codeContext = useCodeContext(SESSION_ID)
  const chat = useChat({
    sessionId: SESSION_ID,
    codeContext,
    settings,
  })

  const sessionLabel = useMemo(() => {
    const date = new Date()
    return date.toLocaleString('ja-JP', {
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
    })
  }, [])

  useEffect(() => {
    logEvent(SESSION_ID, 'session_start', {
      settings,
      language: codeContext.language,
    })
  }, [])

  return (
    <div className="app-shell">
      <Header
        settings={settings}
        sessionLabel={sessionLabel}
        onSettingsChange={setSettings}
        onCodeLoad={codeContext.loadCode}
      />

      <main className="app-body">
        <section className="pane pane--code" aria-label="コード表示">
          <CodePanel
            code={codeContext.code}
            language={codeContext.language}
            selectedText={codeContext.selectedText}
            onCodeChange={codeContext.loadCode}
            onLanguageChange={codeContext.setLanguage}
            onSelection={codeContext.handleSelection}
          />
        </section>

        <div className="pane-divider" role="separator" aria-orientation="vertical" />

        <section className="pane pane--chat" aria-label="対話支援">
          <ChatPanel
            messages={chat.messages}
            isLoading={chat.isLoading}
            error={chat.error}
            selectedText={codeContext.selectedText}
            onSend={chat.sendMessage}
            onReset={chat.resetChat}
          />
        </section>
      </main>
    </div>
  )
}
