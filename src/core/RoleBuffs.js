import { ROLE_CONFIG } from '../config/roles.js'

export function isValidRole(role) {
  return Boolean(role && ROLE_CONFIG.roles[role])
}

export function clampRoleLevel(level, config = ROLE_CONFIG) {
  return Math.max(1, Math.min(config.maxRoleLevel, Math.round(Number(level) || 1)))
}

export function getRoleDefinition(role, config = ROLE_CONFIG) {
  return config.roles[role] ?? null
}

export function getRoleBuffs(role, level = 1, config = ROLE_CONFIG) {
  const roleDefinition = getRoleDefinition(role, config)
  const roleLevel = clampRoleLevel(level, config)
  const levelBuffs = roleDefinition?.levels?.[roleLevel] ?? {}

  return {
    scanCardCount: config.base.scanCardCount,
    maxScanCardCount: config.base.maxScanCardCount,
    scanCardBonus: 0,
    gasPoolMultiplier: config.base.gasPoolMultiplier,
    stealProbabilityMultiplier: config.base.stealProbabilityMultiplier,
    replaceRequiredBidMultiplier: config.base.replaceRequiredBidMultiplier,
    replaceSuppressProbabilityBonus: config.base.replaceSuppressProbabilityBonus,
    ...levelBuffs,
  }
}

export function nextRoleLevel(level, config = ROLE_CONFIG) {
  return Math.min(config.maxRoleLevel, clampRoleLevel(level, config) + 1)
}

export function getBaseGasPoolForLayer(layer, config = ROLE_CONFIG) {
  const normalizedLayer = Math.max(1, Math.round(Number(layer) || 1))
  const stage = config.base.gasPoolByStage.find((item) => normalizedLayer <= item.maxLayer)
  return stage?.gasPool ?? config.base.gasPoolByStage.at(-1)?.gasPool ?? 0
}
