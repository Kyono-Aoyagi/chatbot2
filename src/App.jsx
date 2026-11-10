import { useRef, useState } from 'react'
import { PRESET_CODES, createUserCode } from './data/codeLibrary'
import { STEP_LABELS, getInitialBotMessage, getInitialTutorState, getUserDeclaredDoneMessage, sendToGemini, sendToGeminiOpportunistic } from './bot/geminiBot'
import { evaluateStudyResponses, generateSessionId, logEvent, readStudyContext } from './utils/logger'
import { buildExperimentPlan, buildTaskStudyContext } from './data/experimentPlan'
import { resolveCondition, CONDITION_LABELS } from './utils/condition'
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

// ---- ドラッグで幅/高さを調整するリサイザー ----
// direction: 'horizontal'（左右の幅を調整、containerRefの横幅に対する比率で計算）
//            'vertical'（上下の高さを調整、containerRefの縦幅に対する比率で計算）
function Resizer({ direction, containerRef, ratio, setRatio, min = 0.2, max = 0.8 }) {
  const handlePointerDown = (e) => {
    e.preventDefault()

    const handleMove = (moveEvent) => {
      const rect = containerRef.current?.getBoundingClientRect()
      if (!rect) return

      let next
      if (direction === 'horizontal') {
        next = (moveEvent.clientX - rect.left) / rect.width
      } else {
        next = (moveEvent.clientY - rect.top) / rect.height
      }
      setRatio(Math.min(max, Math.max(min, next)))
    }

    const handleUp = () => {
      document.removeEventListener('mousemove', handleMove)
      document.removeEventListener('mouseup', handleUp)
    }

    document.addEventListener('mousemove', handleMove)
    document.addEventListener('mouseup', handleUp)
  }

  return (
    <div
      className={direction === 'horizontal' ? 'resizer resizer--h' : 'resizer resizer--v'}
      onMouseDown={handlePointerDown}
      role="separator"
      aria-orientation={direction === 'horizontal' ? 'vertical' : 'horizontal'}
    />
  )
}

// ---- SelectionPhase ----

function SelectionPhase({ onStart, onStartExperiment }) {
  const [tab, setTab] = useState('preset') // 'preset' | 'saved' | 'paste'
  const [section, setSection] = useState('practice')
  const [participantId, setParticipantId] = useState('')
  const [studyStartError, setStudyStartError] = useState('')
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
          <p>{section === 'experiment' ? '仮の実験手順で、順番に回答とログを記録します' : '取り組むコードを選んでください'}</p>
        </div>
      </header>

      <main className="selection-main">
        <div className="mode-switch">
          <button type="button" className={`tab-button ${section === 'practice' ? 'tab-button--active' : ''}`} onClick={() => setSection('practice')}>通常練習</button>
          <button type="button" className={`tab-button ${section === 'experiment' ? 'tab-button--active' : ''}`} onClick={() => setSection('experiment')}>実験モード</button>
        </div>

        {section === 'experiment' ? (
          <section className="experiment-card">
            <h2>実験を始める</h2>
            <p>匿名の参加者IDを入力してください。氏名など、個人を特定できる情報は入力しないでください。</p>
            <label className="paste-form__label">
              参加者ID
              <input className="paste-form__input" value={participantId} maxLength={32} onChange={event => { setParticipantId(event.target.value); setStudyStartError('') }} placeholder="例: P01" />
            </label>
            <div className="experiment-notice">
              <strong>試作用の仮設定</strong>
              <p>チャット課題6問、ボットなし課題3問、短い仮アンケートの順に進みます。問題セットは参加者IDでA→B / B→Aに仮割当します。問題と事後課題は後から変更できます。</p>
            </div>
            {studyStartError && <p className="paste-form__error">{studyStartError}</p>}
            <button type="button" className="primary-button" onClick={async () => {
              const id = participantId.trim()
              if (!/^[A-Za-z0-9_-]{1,32}$/.test(id)) {
                setStudyStartError('参加者IDは英数字、ハイフン、アンダースコアで入力してください。')
                return
              }
              const started = await onStartExperiment(id)
              if (!started) setStudyStartError('研究ログを保存できませんでした。接続を確認してもう一度お試しください。')
            }}>実験を開始</button>
          </section>
        ) : <>
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
        </>}
      </main>
    </div>
  )
}

function StudyAssessmentPhase({ task, sessionId, studyContext, progress, onComplete }) {
  const [answer, setAnswer] = useState('')
  const [isSaving, setIsSaving] = useState(false)
  const [answerLogged, setAnswerLogged] = useState(false)
  const [evaluationSaved, setEvaluationSaved] = useState(false)
  const [error, setError] = useState('')

  const submit = async () => {
    if (!answer.trim() || isSaving) return
    setIsSaving(true)
    setError('')
    try {
      if (!answerLogged) {
        const saved = await logEvent({
          sessionId,
          eventType: 'assessment_response',
          codeId: task.code.id,
          responseText: answer.trim(),
          studyContext,
        })
        if (!saved) throw new Error('回答ログを保存できませんでした。通信を確認して再送してください。')
        setAnswerLogged(true)
      }
      if (!evaluationSaved) {
        await evaluateStudyResponses({
          sessionId,
          codeId: task.code.id,
          studyContext,
          snapshots: [{ id: 'post_response', learnerText: answer.trim() }],
        })
        setEvaluationSaved(true)
      }
      await logEvent({ sessionId, eventType: 'assessment_complete', codeId: task.code.id, studyContext })
      const completed = await onComplete()
      if (!completed) throw new Error('次の課題を開始できませんでした。もう一度お試しください。')
    } catch (submitError) {
      setError(submitError.message)
    } finally {
      setIsSaving(false)
    }
  }

  return (
    <div className="app">
      <header className="header">
        <div><h1>ボットなし課題</h1><p>実験 {progress.current} / {progress.total} ・ 問題 {task.order}</p></div>
      </header>
      <main className="assessment-layout">
        <section className="assessment-code">
          <h2>{task.code.title}</h2>
          <CodeBlock code={task.code.code} />
        </section>
        <section className="assessment-form">
          <p>このコードが何をするか、どのように実現しているかを、自分の言葉で説明してください。</p>
          <textarea value={answer} onChange={event => setAnswer(event.target.value)} rows={10} disabled={isSaving || answerLogged} placeholder="説明を入力してください" />
          {error && <p className="paste-form__error">{error}</p>}
          <button type="button" className="primary-button" disabled={!answer.trim() || isSaving} onClick={submit}>
            {isSaving ? '保存・採点中...' : evaluationSaved ? '次の課題へ進む' : answerLogged ? '採点を再試行' : '回答を送信して次へ'}
          </button>
          <small>この課題は一時的な仮問題です。回答と採点結果は研究ログに保存されます。</small>
        </section>
      </main>
    </div>
  )
}

function StudySurveyPhase({ sessionId, studyContext, onComplete }) {
  const [usefulness, setUsefulness] = useState('')
  const [helpfulReply, setHelpfulReply] = useState('')
  const [difficultMoment, setDifficultMoment] = useState('')
  const [isSaving, setIsSaving] = useState(false)
  const [surveyLogged, setSurveyLogged] = useState(false)
  const [error, setError] = useState('')

  const submit = async () => {
    if (!usefulness || isSaving) return
    setIsSaving(true)
    setError('')
    try {
      if (!surveyLogged) {
        const saved = await logEvent({
          sessionId,
          eventType: 'study_survey',
          studyContext,
          responses: { usefulness: Number(usefulness), helpfulReply, difficultMoment },
        })
        if (!saved) throw new Error('アンケートを保存できませんでした。通信を確認して再送してください。')
        setSurveyLogged(true)
      }
      const completed = await onComplete()
      if (!completed) throw new Error('実験終了ログを保存できませんでした。もう一度お試しください。')
    } catch (submitError) {
      setError(submitError.message)
    } finally {
      setIsSaving(false)
    }
  }

  return (
    <div className="app">
      <header className="header"><div><h1>仮アンケート</h1><p>実験の最後の課題です</p></div></header>
      <main className="survey-form">
        <p className="experiment-notice">以下は画面とログ保存を確認するための仮質問です。研究用の質問項目は後から差し替えます。</p>
        <label className="paste-form__label">チャットボットはコード理解に役立ちましたか？
          <select className="paste-form__input" value={usefulness} disabled={surveyLogged} onChange={event => setUsefulness(event.target.value)}>
            <option value="">選択してください</option>
            {[1, 2, 3, 4, 5].map(value => <option key={value} value={value}>{value}</option>)}
          </select>
        </label>
        <label className="paste-form__label">役立った返答があれば記入してください
          <textarea value={helpfulReply} disabled={surveyLogged} onChange={event => setHelpfulReply(event.target.value)} rows={3} />
        </label>
        <label className="paste-form__label">困った場面があれば記入してください
          <textarea value={difficultMoment} disabled={surveyLogged} onChange={event => setDifficultMoment(event.target.value)} rows={3} />
        </label>
        {error && <p className="paste-form__error">{error}</p>}
        <button type="button" className="primary-button" disabled={!usefulness || isSaving} onClick={submit}>{isSaving ? '保存中...' : '回答を送信して終了'}</button>
      </main>
    </div>
  )
}

// ---- ChattingPhase ----

function ResultPanel({ expectedOutput, unlocked }) {
  if (!expectedOutput) return null

  return (
    <section className="result-panel" aria-label="実行結果">
      <div className="pane-title">
        <span>実行結果</span>
      </div>
      {unlocked ? (
        <pre className="result-panel__output">{expectedOutput}</pre>
      ) : (
        <div className="result-panel__locked">
          「まとめ」ステップを完了すると、ここに実行結果が表示されます。
        </div>
      )}
    </section>
  )
}

function ChattingPhase({ activeCode, sessionId, condition, studyContext, isStudy = false, studyProgress, onStudyNext, onChangeCode }) {
  const [messages, setMessages] = useState(() => [getInitialBotMessage(activeCode.title, condition)])
  const [input, setInput] = useState('')
  const [step, setStep] = useState(condition === 'free' ? 'free' : condition === 'opportunistic' ? 'opportunistic' : 'purpose')
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState('')
  const [isFinishingStudyTask, setIsFinishingStudyTask] = useState(false)
  const [studyEvaluationSaved, setStudyEvaluationSaved] = useState(false)
  // opportunistic条件専用の状態（期待・罠の到達状況、支援段階、phase など。api/_lib/tutorState.js 参照）。サーバーが返した値をそのまま保持して毎回送る。
  // 内部状態（why/how や期待の達成状況）を参加者に見せると、「confirmed なら終わり」のように行動が左右されるため、画面には出さない。
  const [tutorState, setTutorState] = useState(getInitialTutorState)
  const readingPhase = tutorState.phase
  // free/opportunistic条件は自己説明を強制する設計ではないので最初から解除。
  // guided条件は summaryステップがadvance:trueになった瞬間に解除する。
  const [resultUnlocked, setResultUnlocked] = useState(condition === 'free' || condition === 'opportunistic')
  const messagesEndRef = useRef(null)

  // レイアウト調整用
  const mainRef = useRef(null)
  const codePaneRef = useRef(null)
  const [paneRatio, setPaneRatio] = useState(0.6) // 左（コード）の幅の比率
  const [codeRatio, setCodeRatio] = useState(0.7) // コード部分（実行結果を除く）の高さの比率

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
      timestamp: new Date().toLocaleString('ja-JP', { timeZone: 'Asia/Tokyo' }),
    }

    setMessages(prev => [...prev, userMessage])
    setInput('')
    setIsLoading(true)
    setError('')

    try {
      // API送信用に、直前までの会話履歴を role/content の配列に変換する
      // （今回のuserMessageは含めない。userMessage引数として別送信するため）
      const history = messages.map(m => ({ role: m.role, content: m.content }))

      if (condition === 'opportunistic') {
        // opportunistic条件はstep進行ではなく、状態（tutorState）を毎回送受信して更新する。
        const botReply = await sendToGeminiOpportunistic({
          sessionId,
          studyContext,
          activeCode,
          tutorState,
          userMessage: text,
          history,
        })

        const botMessage = {
          role: 'bot',
          content: botReply.content,
          step: 'opportunistic',
          timestamp: new Date().toLocaleString('ja-JP', { timeZone: 'Asia/Tokyo' }),
        }

        setMessages(prev => [...prev, botMessage])
        setTutorState(botReply.tutorState)
        // 状態の推移や読解の終了・再開は、サーバーが chat / session_complete / session_reopen ログに残すので、ここでは別途ログしない。
      } else {
        const botReply = await sendToGemini({
          sessionId,
          studyContext,
          activeCode,
          currentStep: step,
          userMessage: text,
          history,
          condition,
        })

        const botMessage = {
          role: 'bot',
          content: botReply.content,
          step: botReply.nextStep,
          timestamp: new Date().toLocaleString('ja-JP', { timeZone: 'Asia/Tokyo' }),
        }

        setMessages(prev => [...prev, botMessage])

        // summaryステップがadvance:trueになった瞬間だけ実行結果を解除する
        // （summaryはSTEPSの最後なので nextStep だけでは advance の有無を区別できない）
        if (!resultUnlocked && step === 'summary' && botReply.advance) {
          setResultUnlocked(true)
          logEvent({ sessionId, eventType: 'result_shown', step, condition })
        }

        setStep(botReply.nextStep)
        // ステップ遷移は、chat ログの currentStep（送信時点）と advance から導出できるので別途ログしない。
      }
    } catch (err) {
      // 失敗した送信は履歴に残さず、入力欄に戻す。
      // （応答の無い user 発言が残ると、次回の history が user 連続の形になり、送信し直す際に重複もするため）
      setMessages(prev => prev.filter(m => m !== userMessage))
      setInput(current => current || text)
      setError(`${err.message} 入力した内容は残してあります。`)
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

  // 「理解できた」ボタン（opportunistic条件）。AIは呼ばず、読解を完了状態にして固定メッセージを追加する。
  // 完了後も質問は続けられる。終了条件を満たしていなかったかどうか（closed_with_gaps）は、api/log.js がスナップショットから判定して記録する。
  const userTurns = messages.filter(m => m.role === 'user').length
  const handleDeclareDone = () => {
    if (readingPhase !== 'reading' || isLoading || userTurns === 0) return Promise.resolve(false)
    setTutorState(current => ({ ...current, phase: 'done', pendingWrapUp: false, focus: null }))
    setMessages(prev => [...prev, getUserDeclaredDoneMessage()])
    return logEvent({
      sessionId,
      eventType: 'session_complete',
      condition,
      codeId: activeCode.id,
      turn: userTurns,
      mentalModel: tutorState.mentalModel,
      mentalModelEvidence: tutorState.mentalModelEvidence,
      expectationStates: tutorState.expectationStates,
      trapStates: tutorState.trapStates,
      studyContext,
    })
    setTimeout(scrollToBottom, 50)
  }

  const finishStudyTask = async () => {
    if (isLoading || isFinishingStudyTask || userTurns === 0) return
    setIsFinishingStudyTask(true)
    setError('')
    try {
      if (readingPhase === 'reading') {
        const completionSaved = await handleDeclareDone()
        if (!completionSaved) throw new Error('課題の終了状態を保存できませんでした。')
      }
      const learnerMessages = messages.filter(message => message.role === 'user').map(message => message.content).filter(Boolean)
      if (!studyEvaluationSaved) {
        await evaluateStudyResponses({
          sessionId,
          codeId: activeCode.id,
          studyContext,
          snapshots: [
            { id: 'first_response', learnerText: learnerMessages[0] ?? '' },
            { id: 'cumulative_learner_explanations', learnerText: learnerMessages.join('\n') },
          ],
        })
        setStudyEvaluationSaved(true)
      }
      const advanced = await onStudyNext()
      if (!advanced) throw new Error('次の課題を開始できませんでした。ログ保存を確認してください。')
    } catch (finishError) {
      setError(finishError.message)
    } finally {
      setIsFinishingStudyTask(false)
    }
  }

  return (
    <div className="app">
      <header className="header">
        <div>
          <h1>{activeCode.title}</h1>
          <p>{activeCode.filename} ・ {isStudy ? `実験モード ${studyProgress.current} / ${studyProgress.total}` : CONDITION_LABELS[condition] ?? condition}</p>
        </div>
        {!isStudy && <button type="button" className="secondary-button" onClick={onChangeCode}>コードを変更</button>}
      </header>

      <main className="main" ref={mainRef}>
        <section
          className="code-pane"
          aria-label="コード"
          ref={codePaneRef}
          style={{ flexBasis: `${paneRatio * 100}%` }}
        >
          <div
            className="code-pane__code-area"
            style={activeCode.expectedOutput ? { flexBasis: `${codeRatio * 100}%` } : { flex: 1 }}
          >
            <div className="pane-title">
              <span>{activeCode.filename}</span>
              <span>{activeCode.language}</span>
            </div>
            <CodeBlock code={activeCode.code} />
          </div>

          {activeCode.expectedOutput && (
            <>
              <Resizer
                direction="vertical"
                containerRef={codePaneRef}
                ratio={codeRatio}
                setRatio={setCodeRatio}
              />
              <ResultPanel expectedOutput={activeCode.expectedOutput} unlocked={resultUnlocked} />
            </>
          )}
        </section>

        <Resizer
          direction="horizontal"
          containerRef={mainRef}
          ratio={paneRatio}
          setRatio={setPaneRatio}
        />

        <section className="chat-pane" aria-label="チャット">
          <div className="pane-title">
            <span>チャット</span>
            <span>ステップ: {STEP_LABELS[step] ?? step}</span>
          </div>

          {condition === 'opportunistic' && (
            <div className="open-questions" aria-label="読解の状態">
              {isStudy ? (
                <button type="button" className="primary-button" onClick={finishStudyTask} disabled={isLoading || isFinishingStudyTask || userTurns === 0}>
                  {isFinishingStudyTask ? '保存・採点中...' : 'この問題を終えて次へ'}
                </button>
              ) : readingPhase === 'done' ? (
                <div className="open-questions__mental">✓ 読解完了（このあとも質問はできます）</div>
              ) : (
                <button
                  type="button"
                  className="secondary-button"
                  onClick={handleDeclareDone}
                  disabled={isLoading || userTurns === 0}
                >
                  理解できた
                </button>
              )}
            </div>
          )}

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
  const [phase, setPhase] = useState('selecting') // selecting | chatting | experiment | study-complete
  const [activeCode, setActiveCode] = useState(null)
  const [sessionId, setSessionId] = useState(null)
  const [experiment, setExperiment] = useState(null)
  const [studyTaskSessionId, setStudyTaskSessionId] = useState(null)
  const [studyContext] = useState(readStudyContext)
  // セッション中は条件が変わらないようにマウント時に1回だけ解決する
  const [condition] = useState(resolveCondition)

  const handleStart = (codeObj) => {
    const newSessionId = generateSessionId()
    setSessionId(newSessionId)
    setActiveCode(codeObj)
    setPhase('chatting')
    const initialMessage = getInitialBotMessage(codeObj.title, condition)
    logEvent({
      sessionId: newSessionId,
      eventType: 'session_start',
      codeId: codeObj.id,
      source: codeObj.source,
      // 問題別・難易度別にログを見るため。ユーザー貼付コードは difficulty/tags が無い（コード本文は保存しない）。
      title: codeObj.title,
      difficulty: codeObj.difficulty,
      tags: codeObj.tags,
      condition,
      studyContext,
      initialAssistantMessage: initialMessage.content,
    })
  }

  const beginStudyTask = async (study, index) => {
    const task = study.plan.tasks[index]
    const taskSessionId = task.type === 'survey' ? study.id : generateSessionId()
    setStudyTaskSessionId(taskSessionId)
    const context = buildTaskStudyContext(study.participantId, task, studyContext.isTest)
    if (task.type !== 'survey') {
      const conditionForTask = task.type === 'chat' ? 'opportunistic' : 'botless_assessment'
      const saved = await logEvent({
        sessionId: taskSessionId,
        eventType: 'session_start',
        experimentId: study.id,
        codeId: task.code.id,
        source: 'preset',
        title: task.code.title,
        difficulty: task.code.difficulty,
        tags: task.code.tags,
        condition: conditionForTask,
        studyContext: context,
        initialAssistantMessage: task.type === 'chat'
          ? getInitialBotMessage(task.code.title, 'opportunistic').content
          : 'ボットなしでコードの目的と処理の流れを説明してください。',
        experimentPlanVersion: study.plan.version,
      })
      return saved
    }
    return true
  }

  const handleStartExperiment = async (participantId) => {
    const plan = buildExperimentPlan(participantId)
    const study = { id: `study_${generateSessionId().slice(5)}`, participantId, plan, index: 0 }
    const context = buildTaskStudyContext(participantId, { round: null, setId: 'START', order: null }, studyContext.isTest)
    const studyStarted = await logEvent({
      sessionId: study.id,
      eventType: 'study_start',
      studyContext: context,
      experimentPlanVersion: plan.version,
      setOrder: [plan.firstSet, plan.secondSet],
      taskCount: plan.tasks.length,
    })
    if (!studyStarted) return false
    const taskStarted = await beginStudyTask(study, 0)
    if (!taskStarted) return false
    setExperiment(study)
    setPhase('experiment')
    return true
  }

  const handleNextStudyTask = async () => {
    if (!experiment) return false
    const nextIndex = experiment.index + 1
    if (nextIndex >= experiment.plan.tasks.length) {
      const context = buildTaskStudyContext(experiment.participantId, { round: 'post', setId: 'COMPLETE', order: null }, studyContext.isTest)
      const saved = await logEvent({ sessionId: experiment.id, eventType: 'study_complete', studyContext: context })
      if (!saved) return false
      setPhase('study-complete')
      return true
    }
    const nextStudy = { ...experiment, index: nextIndex }
    const started = await beginStudyTask(nextStudy, nextIndex)
    if (!started) return false
    setExperiment(nextStudy)
    return true
  }

  const handleChangeCode = () => {
    setPhase('selecting')
    setActiveCode(null)
    setSessionId(null)
  }

  if (phase === 'selecting') {
    return <SelectionPhase onStart={handleStart} onStartExperiment={handleStartExperiment} />
  }

  if (phase === 'experiment' && experiment) {
    const task = experiment.plan.tasks[experiment.index]
    const context = buildTaskStudyContext(experiment.participantId, task, studyContext.isTest)
    const progress = { current: experiment.index + 1, total: experiment.plan.tasks.length }
    if (task.type === 'assessment') {
      return <StudyAssessmentPhase key={studyTaskSessionId} task={task} sessionId={studyTaskSessionId} studyContext={context} progress={progress} onComplete={handleNextStudyTask} />
    }
    if (task.type === 'survey') {
      return <StudySurveyPhase key={studyTaskSessionId} sessionId={studyTaskSessionId} studyContext={context} onComplete={handleNextStudyTask} />
    }
    return <ChattingPhase
      key={studyTaskSessionId}
      activeCode={task.code}
      sessionId={studyTaskSessionId}
      condition="opportunistic"
      studyContext={context}
      isStudy
      studyProgress={progress}
      onStudyNext={handleNextStudyTask}
      onChangeCode={() => {}}
    />
  }

  if (phase === 'study-complete') {
    return <div className="app"><header className="header"><div><h1>実験完了</h1><p>回答と仮アンケートを記録しました。ご協力ありがとうございました。</p></div></header><main className="selection-main"><div className="experiment-notice"><strong>試作版の実験モード</strong><p>問題セット、事後課題、アンケートは仮設定です。</p></div><button type="button" className="secondary-button" onClick={() => { setExperiment(null); setPhase('selecting') }}>開始画面へ戻る</button></main></div>
  }

  return (
    <ChattingPhase
      activeCode={activeCode}
      sessionId={sessionId}
      condition={condition}
      studyContext={studyContext}
      onChangeCode={handleChangeCode}
    />
  )
}
