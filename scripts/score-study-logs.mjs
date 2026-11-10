import { readFile, writeFile } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { GoogleGenerativeAI } from '@google/generative-ai'
import { PRESET_CODES } from '../src/data/codeLibrary.js'

const JUDGE_MODEL = 'gemini-3.1-flash-lite'
const RUBRIC_VERSION = 'study-rubric-v1'

function parseRows(raw) {
  try {
    const parsed = JSON.parse(raw)
    if (Array.isArray(parsed)) return parsed
    if (Array.isArray(parsed?.rows)) return parsed.rows
    if (Array.isArray(parsed?.data)) return parsed.data
    throw new Error('JSONのトップレベルに配列、rows、またはdata配列が必要です。')
  } catch (jsonError) {
    try { return raw.split(/\r?\n/).filter(Boolean).map(line => JSON.parse(line)) }
    catch { throw jsonError }
  }
}

function payloadOf(row) {
  const value = row?.payload ?? row?.event ?? row
  if (typeof value === 'string') {
    try { return JSON.parse(value) } catch { return {} }
  }
  return value && typeof value === 'object' ? value : {}
}

function collectCandidates(rows) {
  const sessions = new Map()
  const candidates = []
  for (const row of rows) {
    const p = payloadOf(row)
    const type = row?.event_type ?? row?.eventType ?? p.eventType
    const sessionId = row?.session_id ?? row?.sessionId ?? p.sessionId ?? null
    if (type === 'assessment_response') {
      candidates.push({
        sessionId, codeId: p.codeId, studyContext: p.studyContext ?? {},
        source: 'standalone_response', createdAt: row?.created_at ?? null,
        texts: [{ id: 'response', learnerText: String(p.responseText ?? '') }],
      })
      continue
    }
    if (!sessionId || !['session_start', 'chat'].includes(type)) continue
    if (!sessions.has(sessionId)) sessions.set(sessionId, { id: sessionId, start: null, turns: [] })
    const session = sessions.get(sessionId)
    if (type === 'session_start') session.start = { ...p, createdAt: row?.created_at ?? null }
    if (type === 'chat') session.turns.push({ ...p, createdAt: row?.created_at ?? null })
  }

  for (const session of sessions.values()) {
    session.turns.sort((a, b) => (a.turn ?? 0) - (b.turn ?? 0))
    if (!session.turns.length) continue
    const first = session.turns[0]
    const utterances = session.turns.map(turn => String(turn.userMessage ?? '')).filter(Boolean)
    candidates.push({
      sessionId: session.id,
      codeId: session.start?.codeId ?? first.codeId,
      studyContext: session.start?.studyContext ?? first.studyContext ?? {},
      source: 'chat_session',
      createdAt: session.start?.createdAt ?? first.createdAt ?? null,
      tutorPromptVersions: [...new Set(session.turns.map(turn => turn.promptVersion).filter(Boolean))],
      tutorModels: [...new Set(session.turns.map(turn => turn.model).filter(Boolean))],
      deployedCommitIds: [...new Set(session.turns.map(turn => turn.deployedCommitId).filter(Boolean))],
      texts: [
        { id: 'first_response', learnerText: String(first.userMessage ?? '') },
        { id: 'cumulative_learner_explanations', learnerText: utterances.join('\n') },
      ],
    })
  }
  return candidates
}

function promptFor(code, criteria, texts) {
  return [
    'あなたはコード説明の独立した採点補助者です。入力された学習者の発言だけを採点してください。',
    '既存のチューター状態、AIのwhy/how判定、moveラベルは参照しません。',
    '網羅性: 0=触れていない、1=一部だけ、2=必要な説明を含む。',
    '正確性: 0=誤り/矛盾、1=一部正しい/曖昧、2=コードと整合して正しい。未言及なら両方0。',
    '各項目のevidenceは学習者発言からの短い逐語引用。根拠がなければ空文字。推測で不足を補わない。',
    '必ずJSONのみで出力: {"snapshots":[{"id":"...","criteria":[{"criterionId":"e1","coverage":0,"accuracy":0,"evidence":"","note":""}],"overall":""}]}',
    `コードID: ${code.id}`,
    `コード本文:\n${code.code}`,
    `採点基準:\n${JSON.stringify(criteria)}`,
    `採点対象:\n${JSON.stringify(texts)}`,
    'すべてのスナップショットと基準を出力してください。',
  ].join('\n\n')
}

function parseJudgement(raw) {
  const text = raw.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '')
  return JSON.parse(text)
}

const squash = text => String(text ?? '').replace(/\s+/g, '')

function recommendHumanAudit(candidate) {
  const key = [candidate.studyContext?.participantId, candidate.studyContext?.round, candidate.codeId, candidate.sessionId].join('|')
  const bucket = createHash('sha256').update(key).digest()[0] % 5
  return bucket === 0
}

function validateSnapshots(judgement, texts, criteria) {
  const snapshots = new Map((judgement?.snapshots ?? []).map(item => [item.id, item]))
  return texts.map(text => {
    const judged = snapshots.get(text.id)
    const scores = new Map((judged?.criteria ?? []).map(item => [item.criterionId, item]))
    const results = criteria.map(criterion => {
      const item = scores.get(criterion.id) ?? {}
      const coverage = [0, 1, 2].includes(item.coverage) ? item.coverage : null
      const accuracy = [0, 1, 2].includes(item.accuracy) ? item.accuracy : null
      const evidence = typeof item.evidence === 'string' ? item.evidence : ''
      const evidenceVerified = !evidence || squash(text.learnerText).includes(squash(evidence))
      return { ...criterion, coverage, accuracy, evidence: evidenceVerified ? evidence : '', evidenceVerified,
        note: String(item.note ?? '').slice(0, 160), needsReview: coverage === null || accuracy === null || !evidenceVerified }
    })
    const valid = results.filter(item => item.coverage !== null && item.accuracy !== null)
    const mean = key => valid.length ? Number((valid.reduce((sum, item) => sum + item[key], 0) / valid.length).toFixed(2)) : null
    return { id: text.id, learnerText: text.learnerText, criteria: results, overall: String(judged?.overall ?? ''),
      summary: { coverageMean: mean('coverage'), accuracyMean: mean('accuracy'), criteriaScored: valid.length } }
  })
}

async function main() {
  const [, , inputPath, outputPath] = process.argv
  if (!inputPath || !outputPath) throw new Error('使い方: node scripts/score-study-logs.mjs <Supabase JSON/JSONL> <output.json>')
  if (!process.env.GEMINI_API_KEY) throw new Error('GEMINI_API_KEY が設定されていません。')

  const rows = parseRows(await readFile(inputPath, 'utf8'))
  const codes = new Map(PRESET_CODES.map(code => [code.id, code]))
  const candidates = collectCandidates(rows)
  const model = new GoogleGenerativeAI(process.env.GEMINI_API_KEY).getGenerativeModel({
    model: JUDGE_MODEL,
    generationConfig: { temperature: 0, responseMimeType: 'application/json' },
  })
  const results = []

  for (const candidate of candidates) {
    const code = codes.get(candidate.codeId)
    if (!code?.expectations?.length || candidate.texts.some(item => !item.learnerText.trim())) {
      results.push({ ...candidate, status: 'not_scored', reason: !code ? 'unknown_code' : !code.expectations?.length ? 'no_rubric' : 'empty_response' })
      continue
    }
    const criteria = code.expectations.map((item, index) => ({ id: `e${index + 1}`, dimension: item.dimension, criterion: item.text }))
    try {
      const response = await model.generateContent(promptFor(code, criteria, candidate.texts))
      const snapshots = validateSnapshots(parseJudgement(response.response.text()), candidate.texts, criteria)
      results.push({ ...candidate, status: 'scored', evaluation: {
        rubricVersion: RUBRIC_VERSION, judgeModel: JUDGE_MODEL, temperature: 0,
        auditRecommended: recommendHumanAudit(candidate),
        usageMetadata: response.response.usageMetadata ?? null, snapshots,
      } })
    } catch (error) {
      results.push({ ...candidate, status: 'evaluation_error', error: String(error?.message ?? error).slice(0, 300) })
    }
  }

  const output = { schemaVersion: 'study-evaluation-v1', rubricVersion: RUBRIC_VERSION, judgeModel: JUDGE_MODEL,
    sourceRows: rows.length, candidates: results.length, scored: results.filter(item => item.status === 'scored').length, results }
  await writeFile(outputPath, `${JSON.stringify(output, null, 2)}\n`, 'utf8')
  console.log(`採点結果: ${output.scored}/${output.candidates}件を採点しました。`)
}

main().catch(error => { console.error(error.message); process.exitCode = 1 })
