import { CARD_TYPES, COMPETITION_BY_RARITY, RARITY } from '../config/cards.js'
import { SCENES } from '../config/scenes.js'
import { getRoleBuffs } from './RoleBuffs.js'
import { createRandomSource } from './rng.js'

let forceScamNextHand = false

export function generateHand(scene, role, roleLevel, options = {}) {
  const rng = options.rng ?? createRandomSource(options.seed)
  let cards = runSearcher(scene, role, roleLevel, rng)

  if (forceScamNextHand) {
    cards = [createScamCard(scene, rng), ...cards.slice(1)]
    forceScamNextHand = false
  }

  return cards
}

export function injectScamCardNextHand() {
  forceScamNextHand = true
}

export function runSearcher(scene, role, roleLevel, rng = createRandomSource()) {
  const sceneConfig = SCENES[scene] ?? SCENES.dex_arb
  const buffs = getRoleBuffs(role, roleLevel)
  const cardCount = clampInt(
    buffs.scanCardCount + buffs.scanCardBonus,
    buffs.scanCardCount,
    buffs.maxScanCardCount,
  )

  return Array.from({ length: cardCount }, () => createCard(sceneConfig, rng))
}

function createCard(sceneConfig, rng) {
  const rarity = weightedPick(sceneConfig.rarityWeights, rng)
  const type = randomItem(CARD_TYPES, rng)
  const isScam = rng() < sceneConfig.scamRate
  const rarityConfig = RARITY[rarity]
  const trueRisk = isScam ? randomFloat(0.82, 0.97, rng) : randomFloat(...rarityConfig.riskRange, rng)
  const displayedRisk = isScam ? randomFloat(0.03, 0.25, rng) : trueRisk
  const baseProfit = randomFloat(...rarityConfig.profitRange, rng)
  const expectedProfit = isScam ? baseProfit * randomFloat(1.5, 2.5, rng) : baseProfit

  return {
    id: `${type}_${rng().toString(36).slice(2, 10)}`,
    type,
    rarity,
    isScam,
    expectedProfit: round(expectedProfit),
    displayedRisk: round(displayedRisk),
    trueRisk: round(trueRisk),
    gasCost: Math.round(randomFloat(...rarityConfig.gasRange, rng)),
    timeWindowSec: Math.round(randomFloat(10, 50, rng)),
    competitionLevel: Math.round(randomFloat(...COMPETITION_BY_RARITY[rarity], rng)),
    riskReason: isScam ? 'Low-liquidity opportunity disguised as high return.' : riskReasonForType(type),
    status: 'pending',
    actualProfit: 0,
  }
}

function createScamCard(scene, rng) {
  const sceneConfig = SCENES[scene] ?? SCENES.dex_arb
  const card = createCard({ ...sceneConfig, scamRate: 1 }, rng)
  return {
    ...card,
    id: `scam_${rng().toString(36).slice(2, 10)}`,
    isScam: true,
    expectedProfit: Math.max(card.expectedProfit, 2.4),
    displayedRisk: 0.08,
    trueRisk: 0.94,
    riskReason: 'Low-liquidity opportunity disguised as high return.',
  }
}

function weightedPick(weights, rng) {
  const entries = Object.entries(weights)
  const total = entries.reduce((sum, [, weight]) => sum + weight, 0)
  let roll = rng() * total

  for (const [key, weight] of entries) {
    roll -= weight
    if (roll <= 0) return key
  }

  return entries[entries.length - 1][0]
}

function randomItem(items, rng) {
  return items[Math.floor(rng() * items.length)]
}

function randomFloat(min, max, rng) {
  return min + rng() * (max - min)
}

function clampInt(value, min, max) {
  return Math.max(min, Math.min(max, Math.round(value)))
}

function round(value) {
  return Math.round(value * 100) / 100
}

function riskReasonForType(type) {
  const reasons = {
    arbitrage: 'Cross-pool spread is stable; main risk is slippage.',
    sandwich: 'Short execution window; gas competition can amplify failure risk.',
    nft_snipe: 'Rarity judgement depends on market depth; volatility is higher.',
    front_run: 'Priority fee sensitive; can be displaced by a higher bid.',
    liquidation: 'Liquidation window is clear, but state refresh can lag.',
  }

  return reasons[type] ?? 'Opportunity parameters look normal.'
}
