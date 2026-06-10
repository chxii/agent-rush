import { INTERVENTION_SHORTCUTS } from '../config/execution.js'

const SHORTCUT_IDS = new Set(Object.values(INTERVENTION_SHORTCUTS).map((item) => item.id))

export function createInterventionState() {
  return {
    interventionUsed: false,
    pendingInstruction: null,
    lastResult: null,
  }
}

export function requestPlayerIntervention(state, input = {}) {
  if (!state) return rejected('干预状态不可用。')
  if (state.interventionUsed) return rejected('本回合已经用过干预。')

  const instruction = normalizeInterventionInput(input)
  if (!instruction.valid) return rejected(instruction.message)

  state.interventionUsed = true
  state.pendingInstruction = instruction
  state.lastResult = {
    accepted: true,
    instruction,
    message: '干预已排队，将在下一个 Executor 检查点生效。',
  }
  return state.lastResult
}

export function consumePendingIntervention(state) {
  if (!state?.pendingInstruction) return null

  const instruction = state.pendingInstruction
  state.pendingInstruction = null
  return instruction
}

export function parsePlayerInstruction(instruction) {
  if (!instruction) return { mode: 'none', text: '' }
  if (instruction.mode === 'shortcut') return instruction
  if (instruction.mode === 'natural') return instruction
  return normalizeInterventionInput(instruction)
}

export function normalizeInterventionInput(input = {}) {
  if (typeof input === 'string') return normalizeNatural(input)

  const type = input.type ?? input.mode
  if (type === 'shortcut') {
    const shortcutId = String(input.shortcutId ?? input.id ?? '').trim()
    if (!SHORTCUT_IDS.has(shortcutId)) return { valid: false, message: '未知干预快捷指令。' }
    return {
      valid: true,
      mode: 'shortcut',
      shortcutId,
      targetCardId: input.targetCardId ?? null,
      text: `shortcut:${shortcutId}${input.targetCardId ? `:${input.targetCardId}` : ''}`,
    }
  }

  return normalizeNatural(input.text ?? input.instruction ?? '')
}

export function isShortcutInstruction(instruction) {
  return parsePlayerInstruction(instruction).mode === 'shortcut'
}

function normalizeNatural(text) {
  const trimmed = String(text ?? '').trim()
  if (!trimmed) return { valid: false, message: '干预指令不能为空。' }

  if (trimmed.startsWith('shortcut:')) {
    const [, shortcutId, targetCardId] = trimmed.split(':')
    if (!SHORTCUT_IDS.has(shortcutId)) return { valid: false, message: '未知干预快捷指令。' }
    return {
      valid: true,
      mode: 'shortcut',
      shortcutId,
      targetCardId: targetCardId || null,
      text: trimmed,
    }
  }

  return {
    valid: true,
    mode: 'natural',
    text: trimmed,
  }
}

function rejected(message) {
  return {
    accepted: false,
    message,
  }
}
