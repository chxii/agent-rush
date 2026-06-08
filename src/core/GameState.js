const STORAGE_KEY = 'agent_rush_v1'
const SCHEMA_VERSION = 1

export const GameState = {
  unlockedAgents: ['searcher'],
  agentLevels: { searcher: 1, riskAnalyzer: 1, executor: 1, strategist: 1 },
  currentLayer: 1,
  currentScene: 'dex_arb',
  activeAgents: ['searcher'],
  gasPool: 150,
  gasPoolMax: 150,
  cumulativeProfit: 0,
  consecutiveLoss: 0,
  phase: 'idle',
  genesisHistory: { lastTwoRounds: [], boostedType: null },

  init() {
    const progress = this.loadProgress()

    if (progress) {
      this.unlockedAgents = mergeUnique(this.unlockedAgents, progress.unlockedAgents)
      this.agentLevels = { ...this.agentLevels, ...progress.agentLevels }
      this.activeAgents = this.activeAgents.filter((agentId) => this.unlockedAgents.includes(agentId))
    }

    this.gasPoolMax = this.gasPoolMaxForStage(this.currentLayer)
    this.gasPool = Math.min(this.gasPool, this.gasPoolMax)
    return this
  },

  saveProgress() {
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({
        schemaVersion: SCHEMA_VERSION,
        unlockedAgents: this.unlockedAgents,
        agentLevels: this.agentLevels,
      }),
    )
  },

  loadProgress() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY)
      if (!raw) return null

      const parsed = JSON.parse(raw)
      if (parsed.schemaVersion !== SCHEMA_VERSION) return null

      return {
        unlockedAgents: Array.isArray(parsed.unlockedAgents) ? parsed.unlockedAgents : [],
        agentLevels: isRecord(parsed.agentLevels) ? parsed.agentLevels : {},
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

  checkFailure() {
    return this.consecutiveLoss >= 2 && this.cumulativeProfit < -0.5
  },

  checkVictory() {
    return this.currentLayer === 20 && this.cumulativeProfit > 10
  },

  gasPoolMaxForStage(layer) {
    if (layer <= 4) return 150
    if (layer <= 7) return 200
    if (layer <= 12) return 250
    if (layer <= 17) return 300
    return 350
  },

  unlockAgent(agentId) {
    if (!this.unlockedAgents.includes(agentId)) {
      this.unlockedAgents.push(agentId)
    }
    this.saveProgress()
  },

  upgradeAgent(agentId) {
    const currentLevel = this.agentLevels[agentId] ?? 1
    this.agentLevels[agentId] = Math.min(3, currentLevel + 1)
    this.saveProgress()
  },
}

function mergeUnique(base, incoming) {
  return [...new Set([...base, ...(Array.isArray(incoming) ? incoming : [])])]
}

function isRecord(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function roundEth(value) {
  return Math.round(value * 1000) / 1000
}
