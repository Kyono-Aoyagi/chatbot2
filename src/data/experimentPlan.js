import { PRESET_CODES } from './codeLibrary'

// 試作用の仮設定。研究計画確定後に、この3セットと順序を置き換える。
const SETS = {
  A: ['sum_list', 'max_value', 'bubble_sort'],
  B: ['multiples_label', 'recursion_calc', 'gcd_euclid'],
  POST: ['sum_list', 'multiples_label', 'recursion_calc'],
}

const codeById = new Map(PRESET_CODES.map(code => [code.id, code]))

function stableParity(text) {
  return [...String(text)].reduce((sum, char) => sum + char.charCodeAt(0), 0) % 2
}

export function buildExperimentPlan(participantId) {
  const firstSet = stableParity(participantId) === 0 ? 'A' : 'B'
  const secondSet = firstSet === 'A' ? 'B' : 'A'
  const tasks = []

  for (const [round, setId] of [['1', firstSet], ['2', secondSet]]) {
    SETS[setId].forEach((codeId, index) => tasks.push({
      type: 'chat', round, setId, order: index + 1, code: codeById.get(codeId),
    }))
  }
  SETS.POST.forEach((codeId, index) => tasks.push({
    type: 'assessment', round: 'post', setId: 'POST', order: index + 1, code: codeById.get(codeId),
  }))
  tasks.push({ type: 'survey', round: 'post', setId: 'SURVEY', order: null, code: null })
  return { version: 'provisional-v1', firstSet, secondSet, tasks }
}

export function buildTaskStudyContext(participantId, task, isTest = false) {
  return {
    schemaVersion: 'study-log-v1',
    participantId,
    round: task.round,
    problemSetId: task.setId,
    problemOrder: task.order,
    isTest,
  }
}
