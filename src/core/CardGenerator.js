import { CARD_TYPES, COMPETITION_BY_RARITY, RARITY } from '../config/cards.js'
import { SCENES } from '../config/scenes.js'

let forceScamNextHand = false

export function generateHand(scene, activeAgents, agentLevels) {
  const activeAgentSet = new Set(activeAgents)
  let cards = runSearcher(scene, agentLevels.searcher ?? 1)

  if (forceScamNextHand) {
    cards = [createScamCard(scene), ...cards.slice(1)]
    forceScamNextHand = false
  }

  return activeAgentSet.has('riskAnalyzer')
    ? cards.map((card) => runRiskAnalyzer(card, agentLevels.riskAnalyzer ?? 1))
    : cards
}

export function injectScamCardNextHand() {
  forceScamNextHand = true
}

export function runSearcher(scene, level) {
  const sceneConfig = SCENES[scene] ?? SCENES.dex_arb
  const cardCount = clampInt(2 + level, 3, 5)

  return Array.from({ length: cardCount }, () => createCard(sceneConfig))
}

export function runRiskAnalyzer(card, level) {
  const analyzedCard = { ...card }

  if (analyzedCard.isScam) {
    const minRisk = level >= 2 ? 0.9 : 0.85
    analyzedCard.displayedRisk = round(randomFloat(minRisk, 0.98))
    analyzedCard.riskReason = 'RiskAnalyzer 识别到骗局特征：收益异常、交易对浅、对手盘可疑'
    return analyzedCard
  }

  analyzedCard.displayedRisk = analyzedCard.trueRisk
  analyzedCard.riskReason = riskReasonForType(analyzedCard.type)
  return analyzedCard
}

export function runStrategist(cards, gasPool, activeBotType) {
  const pressure = activeBotType === 'Phantom' || activeBotType === 'Phantom+' ? 0.75 : 1
  const scoredCards = cards.map((card) => {
    const botWeight = card.type === 'nft_snipe' ? pressure : 1
    const score = ((card.expectedProfit * (1 - card.displayedRisk)) / Math.max(card.gasCost, 1)) * botWeight
    const affordable = gasPool <= 0 || card.gasCost <= gasPool
    return { card, score: affordable ? score : score * 0.2 }
  })

  const recommendedIds = scoredCards
    .sort((a, b) => b.score - a.score)
    .slice(0, Math.min(3, scoredCards.length))
    .map(({ card }) => card.id)

  return {
    recommendedIds,
    reason:
      activeBotType === 'Phantom' || activeBotType === 'Phantom+'
        ? 'Phantom 系 bot 偏好 NFT，已降低 nft_snipe 推荐权重'
        : '按收益、风险和 Gas 成本计算 EV 排序',
  }
}

function createCard(sceneConfig) {
  const rarity = weightedPick(sceneConfig.rarityWeights)
  const type = randomItem(CARD_TYPES)
  const isScam = Math.random() < sceneConfig.scamRate
  const rarityConfig = RARITY[rarity]
  const trueRisk = isScam ? randomFloat(0.82, 0.97) : randomFloat(...rarityConfig.riskRange)
  const displayedRisk = isScam ? randomFloat(0.03, 0.25) : trueRisk
  const baseProfit = randomFloat(...rarityConfig.profitRange)
  const expectedProfit = isScam ? baseProfit * randomFloat(1.5, 2.5) : baseProfit

  return {
    id: `${type}_${Math.random().toString(36).slice(2, 10)}`,
    type,
    rarity,
    isScam,
    expectedProfit: round(expectedProfit),
    displayedRisk: round(displayedRisk),
    trueRisk: round(trueRisk),
    gasCost: Math.round(randomFloat(...rarityConfig.gasRange)),
    timeWindowSec: Math.round(randomFloat(10, 50)),
    competitionLevel: Math.round(randomFloat(...COMPETITION_BY_RARITY[rarity])),
    riskReason: isScam ? '低流动性伪装成高收益机会' : riskReasonForType(type),
    status: 'pending',
    actualProfit: 0,
  }
}

function createScamCard(scene) {
  const sceneConfig = SCENES[scene] ?? SCENES.dex_arb
  const card = createCard({ ...sceneConfig, scamRate: 1 })
  return {
    ...card,
    id: `scam_${Math.random().toString(36).slice(2, 10)}`,
    isScam: true,
    expectedProfit: Math.max(card.expectedProfit, 2.4),
    displayedRisk: 0.08,
    trueRisk: 0.94,
    riskReason: '低流动性伪装成高收益机会',
  }
}

function weightedPick(weights) {
  const entries = Object.entries(weights)
  const total = entries.reduce((sum, [, weight]) => sum + weight, 0)
  let roll = Math.random() * total

  for (const [key, weight] of entries) {
    roll -= weight
    if (roll <= 0) return key
  }

  return entries[entries.length - 1][0]
}

function randomItem(items) {
  return items[Math.floor(Math.random() * items.length)]
}

function randomFloat(min, max) {
  return min + Math.random() * (max - min)
}

function clampInt(value, min, max) {
  return Math.max(min, Math.min(max, Math.round(value)))
}

function round(value) {
  return Math.round(value * 100) / 100
}

function riskReasonForType(type) {
  const reasons = {
    arbitrage: '跨池价差稳定，主要风险来自滑点',
    sandwich: '交易窗口短，Gas 竞争会放大失败率',
    nft_snipe: '稀有度判断依赖市场深度，波动较高',
    front_run: '优先级费用敏感，容易被更高出价覆盖',
    liquidation: '清算窗口明确，但状态刷新可能滞后',
  }

  return reasons[type] ?? '机会参数正常'
}
