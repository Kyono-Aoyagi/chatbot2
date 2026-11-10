import { createHash } from 'node:crypto'
import { GoogleGenerativeAI } from '@google/generative-ai'
import { PRESET_CODES } from '../src/data/codeLibrary.js'
import { insertLog } from './_lib/supabase.js'

const MODEL = 'gemini-3.1-flash-lite'
const RUBRIC_VERSION = 'study-rubric-v1'
const codeById = new Map(PRESET_CODES.map(code => [code.id, code]))

function sanitizeContext(value = {}) {
  const token = input => {
    const text = String(input ?? '').trim()
    return /^[A-Za-z0-9_-]{1,32}$/.test(text) ? text : null
  }
  return {
    schemaVersion: 'study-log-v1',
    participantId: token(value.participantId),
    round: ['1', '2', 'pre', 'post'].includes(String(value.round)) ? String(value.round) : null,
    problemSetId: token(value.problemSetId),
    problemOrder: Number.isInteger(value.problemOrder) && value.problemOrder > 0 ? value.problemOrder : null,
    isTest: value.isTest === true,
  }
}

function buildPrompt(code, criteria, snapshots) {
  return [
    'コード説明の独立した採点補助者として、学習者の発言だけを採点してください。',
    'チューターの状態判定やmoveは見ず、採点根拠に使わないでください。コード、期待文、一般知識で学習者の発言を補わないでください。',
    '網羅性: 0=触れていない、1=一部だけ、2=必要な説明を含む。正確性: 0=誤り/矛盾、1=一部正しい/曖昧、2=コードと整合して正しい。未言及なら両方0。',
    'evidenceは学習者発言からの短い逐語引用。根拠がない場合は空文字。JSONのみで出力してください。',
    '形式: {"snapshots":[{"id":"...","criteria":[{"criterionId":"e1","coverage":0,"accuracy":0,"evidence":"","note":""}],"overall":""}]}',
    `コードID: ${code.id}`,
    `コード本文:\n${code.code}`,
    `採点基準:\n${JSON.stringify(criteria)}`,
    `採点対象:\n${JSON.stringify(snapshots)}`,
    '各スナップショットの全基準を採点してください。',
  ].join('\n\n')
}

function parseJson(raw) {
  return JSON.parse(raw.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, ''))
}

const squash = text => String(text ?? '').replace(/\s+/g, '')

function validateResults(candidate, snapshots, criteria) {
  const bySnapshot = new Map((candidate?.snapshots ?? []).map(item => [item.id, item]))
  return snapshots.map(snapshot => {
    const rawSnapshot = bySnapshot.get(snapshot.id)
    const byCriterion = new Map((rawSnapshot?.criteria ?? []).map(item => [item.criterionId, item]))
    const results = criteria.map(criterion => {
      const raw = byCriterion.get(criterion.id) ?? {}
      const coverage = [0, 1, 2].includes(raw.coverage) ? raw.coverage : null
      const accuracy = [0, 1, 2].includes(raw.accuracy) ? raw.accuracy : null
      const proposedEvidence = typeof raw.evidence === 'string' ? raw.evidence : ''
      const evidenceValid = !proposedEvidence || squash(snapshot.learnerText).includes(squash(proposedEvidence))
      return {
        ...criterion,
        coverage,
        accuracy,
        evidence: evidenceValid ? proposedEvidence : '',
        evidenceValid,
        note: String(raw.note ?? '').slice(0, 160),
        needsReview: coverage === null || accuracy === null || !evidenceValid,
      }
    })
    const valid = results.filter(item => item.coverage !== null && item.accuracy !== null)
    const average = key => valid.length
      ? Number((valid.reduce((sum, item) => sum + item[key], 0) / valid.length).toFixed(2))
      : null
    return {
      id: snapshot.id,
      criteria: results,
      overall: String(rawSnapshot?.overall ?? '').slice(0, 240),
      summary: { coverageMean: average('coverage'), accuracyMean: average('accuracy'), criteriaScored: valid.length },
    }
  })
}

function recommendHumanAudit(sessionId, context, codeId) {
  const key = `${context.participantId}|${context.round}|${codeId}|${sessionId}`
  return createHash('sha256').update(key).digest()[0] % 5 === 0
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type')
  if (req.method === 'OPTIONS') return res.status(204).end()
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method Not Allowed' })

  const { sessionId, codeId, snapshots: inputSnapshots } = req.body ?? {}
  const code = codeById.get(codeId)
  const snapshots = Array.isArray(inputSnapshots) ? inputSnapshots : []
  if (!sessionId || !code || !code.expectations?.length || snapshots.length < 1 || snapshots.length > 3) {
    return res.status(400).json({ error: '採点に必要な情報が不足しています。' })
  }
  const normalizedSnapshots = snapshots.map((item, index) => ({
    id: String(item?.id ?? `response_${index + 1}`).slice(0, 48),
    learnerText: String(item?.learnerText ?? '').slice(0, 8000),
  }))
  if (normalizedSnapshots.some(item => !item.learnerText.trim())) {
    return res.status(400).json({ error: '空の回答は採点できません。' })
  }
  if (!process.env.GEMINI_API_KEY) return res.status(503).json({ error: '自動採点を利用できません。' })

  const context = sanitizeContext(req.body?.studyContext)
  const criteria = code.expectations.map((item, index) => ({
    id: `e${index + 1}`, dimension: item.dimension, criterion: item.text,
  }))

  try {
    const model = new GoogleGenerativeAI(process.env.GEMINI_API_KEY).getGenerativeModel({
      model: MODEL,
      generationConfig: { temperature: 0, responseMimeType: 'application/json' },
    })
    const response = await model.generateContent(buildPrompt(code, criteria, normalizedSnapshots))
    const evaluation = {
      rubricVersion: RUBRIC_VERSION,
      judgeModel: MODEL,
      temperature: 0,
      auditRecommended: recommendHumanAudit(sessionId, context, codeId),
      usageMetadata: response.response.usageMetadata ?? null,
      snapshots: validateResults(parseJson(response.response.text()), normalizedSnapshots, criteria),
    }
    const saved = await insertLog({
      sessionId,
      eventType: 'study_evaluation',
      codeId,
      studyContext: context,
      evaluation,
    })
    if (!saved) return res.status(503).json({ error: '採点結果を研究ログに保存できませんでした。もう一度お試しください。' })
    return res.status(200).json({ evaluation })
  } catch (error) {
    console.error('[study-evaluation error]', error)
    return res.status(502).json({ error: '採点に失敗しました。回答ログは保存済みです。もう一度お試しください。' })
  }
}
