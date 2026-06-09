const CALL_DELAY_MIN_MS = 300
const CALL_DELAY_MAX_MS = 800
const STREAM_DELAY_MIN_MS = 20
const STREAM_DELAY_MAX_MS = 30

export const ExecutorMock = {
  async call(callType, input = {}) {
    await delay(randomInt(CALL_DELAY_MIN_MS, CALL_DELAY_MAX_MS))
    return getFallbackPlan(callType, input)
  },

  async callStreaming(callType, input = {}, onChunk = () => {}) {
    const response = await this.call(callType, input)
    await streamText(response.reasoning ?? response.summary ?? '', onChunk)
    return response
  },
}

export function getFallbackPlan(callType, input = {}) {
  if (callType === 'InitialPlanning') return buildInitialPlanning(input)
  if (callType === 'SingleCardPlan') return buildSingleCardPlan(input)
  if (callType === 'IncidentResponse') return buildIncidentResponse(input)
  if (callType === 'SettlementReport') return buildSettlementReport(input)
  if (callType === 'PlayerIntervention') return buildPlayerIntervention(input)

  return { reasoning: '未识别的执行请求，使用保底策略继续。' }
}

function buildInitialPlanning(input) {
  const cards = [...(input.cards ?? [])]
  const executionOrder = cards.sort((a, b) => b.expectedProfit - a.expectedProfit).map((card) => card.id)
  const gasAllocations = allocateGasEvenly(executionOrder, input.totalGasPool ?? 0)

  return {
    reasoning: '分析牌组的利润和时间窗口。高收益目标先执行，剩余Gas按牌数均等分配。',
    executionOrder,
    gasAllocations,
  }
}

function buildSingleCardPlan(input) {
  const card = input.card ?? {}
  const stepsByType = {
    arbitrage: [
      ['fetch_prices', '抓取两个DEX价格差'],
      ['broadcast_tx', '提交套利交易'],
    ],
    sandwich: [
      ['monitor_mempool', '监听目标交易排序'],
      ['broadcast_tx', '提交前置交易'],
      ['replace_tx', '根据区块排序调整出价'],
    ],
    nft_snipe: [
      ['fetch_prices', '刷新NFT挂单价格'],
      ['monitor_mempool', '确认竞争者报价'],
      ['broadcast_tx', '提交购买交易'],
    ],
    front_run: [
      ['monitor_mempool', '锁定可抢跑交易'],
      ['broadcast_tx', '提交更高Gas交易'],
    ],
    liquidation: [
      ['fetch_prices', '读取抵押率和清算价'],
      ['broadcast_tx', '提交清算交易'],
    ],
  }

  const templates = stepsByType[card.type] ?? stepsByType.arbitrage
  const steps = templates.map(([action, description], index) => ({
    stepIndex: index + 1,
    action,
    description,
    params: { cardId: card.id, gas: input.allocatedGas ?? card.gasBudget ?? 0 },
  }))

  return {
    reasoning: `开始执行 ${card.type ?? 'target'}，预期利润 ${formatEth(card.expectedProfit)}。先拆步骤，再逐步确认链上反馈。`,
    steps,
  }
}

function buildIncidentResponse(input) {
  const cardId = input.affectedCardId ?? input.card?.id ?? 'unknown'
  const remainingGasPool = input.remainingGasPool ?? 0
  const raiseGas = Math.max(1, Math.floor(remainingGasPool * 0.35))

  return {
    reasoning: 'Phantom出价超过我方。剩余Gas仍可支撑，选择提高出价压制；若失败则放弃该牌。',
    selectedPlanId: 'raise_gas',
    candidatePlans: [
      {
        planId: 'raise_gas',
        description: '提高Gas出价',
        gasAllocations: [{ cardId, gas: raiseGas }],
        expectedOutcome: '压制Phantom并继续执行',
        estimatedProfit: Number(input.card?.expectedProfit ?? 0),
        riskLevel: 0.4,
      },
      {
        planId: 'abandon',
        description: '放弃此牌',
        gasAllocations: [],
        expectedOutcome: '保存Gas给后续目标',
        estimatedProfit: 0,
        riskLevel: 0,
      },
    ],
  }
}

function buildSettlementReport(input) {
  const completedCards = input.completedCards ?? []
  const netProfit = roundEth(completedCards.reduce((sum, card) => sum + (Number(card.actualProfit) || 0), 0))

  return {
    reasoning: '本轮已闭环，统计每张牌的执行结果和修复动作。',
    summary: `本轮执行完成，净收益 ${formatSignedEth(netProfit)}。Executor完成排序、分步执行和异常修复。`,
    netProfit,
    decisionHighlights: [
      {
        momentLabel: 'task_decomposition',
        description: `把 ${completedCards.length} 张牌拆解为独立链上动作，按收益和窗口排序。`,
      },
      {
        momentLabel: 'iterative_repair',
        description: '目标被抢占时评估提高Gas与放弃两条路径，优先选择可挽回收益的方案。',
      },
    ],
  }
}

function buildPlayerIntervention(input) {
  const state = input.currentExecutionState ?? { allCardStatuses: [] }

  return {
    reasoning: '读取玩家指令后，保持当前执行队列并调整Gas分配。',
    interpretedIntent: input.playerInstruction ?? '继续执行',
    updatedGasAllocations: state.allCardStatuses.map((card) => ({
      cardId: card.id,
      gas: card.allocatedGas,
    })),
    updatedExecutionOrder: state.allCardStatuses.map((card) => card.id),
  }
}

function allocateGasEvenly(cardIds, totalGasPool) {
  if (cardIds.length === 0) return []
  const baseGas = Math.floor(totalGasPool / cardIds.length)
  let remainder = totalGasPool - baseGas * cardIds.length

  return cardIds.map((cardId) => {
    const extra = remainder > 0 ? 1 : 0
    remainder -= extra
    return { cardId, gas: baseGas + extra }
  })
}

async function streamText(text, onChunk) {
  for (const char of text) {
    onChunk(char)
    await delay(randomInt(STREAM_DELAY_MIN_MS, STREAM_DELAY_MAX_MS))
  }
}

function randomInt(min, max) {
  return Math.floor(min + Math.random() * (max - min + 1))
}

function delay(ms) {
  return new Promise((resolve) => {
    window.setTimeout(resolve, ms)
  })
}

function formatEth(value) {
  return `${Number(value ?? 0).toFixed(2)} ETH`
}

function formatSignedEth(value) {
  return `${value >= 0 ? '+' : ''}${Number(value).toFixed(3)} ETH`
}

function roundEth(value) {
  return Math.round(value * 1000) / 1000
}
