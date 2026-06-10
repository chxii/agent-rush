import { createMemoryStorage } from './storage.js'
import { WIN_LOSS_CONFIG } from '../config/winloss.js'
import { getBaseGasPoolForLayer, getRoleBuffs, isValidRole, nextRoleLevel } from './RoleBuffs.js'

const STORAGE_KEY = 'agent_rush_v1'
const SCHEMA_VERSION = 2
const LEGACY_UNLOCKED_KEY = `unlocked${'Agents'}`
const LEGACY_LEVELS_KEY = `agent${'Levels'}`
const LEGACY_ACTIVE_KEY = `active${'Agents'}`

const DEFAULT_STATE = {
  role: null,
  roleLevel: 1,
  currentLayer: 1,
  currentScene: 'dex_arb',
  gasPool: 150,
  gasPoolMax: 150,
  cumulativeProfit: 0,
  consecutiveLoss: 0,
  phase: 'idle',
  genesisHistory: { lastTwoRounds: [], boostedType: null },
  tutorialSeen: false,
  seenBots: [],
}

export const GameState = {
  storage: createMemoryStorage(),
  ...clone(DEFAULT_STATE),

  init(options = {}) {
    if (options.storage) this.setStorageAdapter(options.storage)
    resetState(this)

    const progress = this.loadProgress()
    if (progress) {
      this.tutorialSeen = progress.tutorialSeen
      this.seenBots = progress.seenBots
    }

    this.gasPoolMax = this.gasPoolMaxForStage(this.currentLayer)
    this.gasPool = Math.min(this.gasPool, this.gasPoolMax)
    return this
  },

  setStorageAdapter(storage) {
    this.storage = storage ?? createMemoryStorage()
  },

  saveProgress() {
    this.storage.setItem(
      STORAGE_KEY,
      JSON.stringify({
        schemaVersion: SCHEMA_VERSION,
        tutorialSeen: this.tutorialSeen,
        seenBots: this.seenBots,
      }),
    )
  },

  loadProgress() {
    try {
      const raw = this.storage.getItem(STORAGE_KEY)
      if (!raw) return null

      const parsed = JSON.parse(raw)
      if (parsed.schemaVersion !== SCHEMA_VERSION) return null
      if (parsed[LEGACY_UNLOCKED_KEY] || parsed[LEGACY_LEVELS_KEY] || parsed[LEGACY_ACTIVE_KEY]) return null

      return {
        tutorialSeen: parsed.tutorialSeen === true,
        seenBots: Array.isArray(parsed.seenBots) ? parsed.seenBots : [],
      }
    } catch (error) {
      console.warn('[GameState] Failed to load progress', error)
      return null
    }
  },

  setPhase(phase) {
    this.phase = phase
  },

  applyRoundResult(netProfit) {
    const normalizedProfit = Number(netProfit) || 0
    this.cumulativeProfit = roundEth(this.cumulativeProfit + normalizedProfit)
    this.consecutiveLoss = normalizedProfit < 0 ? this.consecutiveLoss + 1 : 0
    this.saveProgress()
  },

  checkFailure(config = WIN_LOSS_CONFIG) {
    return (
      this.consecutiveLoss >= config.failure.consecutiveLossThreshold &&
      this.cumulativeProfit < config.failure.cumulativeProfitBelow
    )
  },

  checkVictory(config = WIN_LOSS_CONFIG) {
    return (
      this.currentLayer === config.victory.targetLayer &&
      this.cumulativeProfit > config.victory.cumulativeProfitGreaterThan
    )
  },

  gasPoolMaxForStage(layer) {
    const baseGasPool = getBaseGasPoolForLayer(layer)
    const buffs = getRoleBuffs(this.role, this.roleLevel)
    return Math.round(baseGasPool * buffs.gasPoolMultiplier)
  },

  setRole(role) {
    if (!isValidRole(role)) return false
    this.role = role
    this.roleLevel = 1
    this.gasPoolMax = this.gasPoolMaxForStage(this.currentLayer)
    this.gasPool = this.gasPoolMax
    this.saveProgress()
    return true
  },

  upgradeRole() {
    this.roleLevel = nextRoleLevel(this.roleLevel)
    this.gasPoolMax = this.gasPoolMaxForStage(this.currentLayer)
    this.gasPool = Math.min(this.gasPool, this.gasPoolMax)
    this.saveProgress()
    return this.roleLevel
  },

  markTutorialSeen() {
    this.tutorialSeen = true
    this.saveProgress()
  },

  hasSeenBot(botName) {
    return this.seenBots.includes(botName)
  },

  markBotSeen(botName) {
    if (!this.seenBots.includes(botName)) {
      this.seenBots.push(botName)
      this.saveProgress()
    }
  },
}

function resetState(target) {
  const storage = target.storage
  Object.assign(target, clone(DEFAULT_STATE), { storage })
}

function clone(value) {
  return JSON.parse(JSON.stringify(value))
}

function roundEth(value) {
  return Math.round(value * 1000) / 1000
}
