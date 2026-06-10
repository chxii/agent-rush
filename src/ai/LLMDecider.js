import { DECIDER_ACTIONS, INCIDENT_TYPES, normalizeIncidentDecision, normalizeInitialPlan } from '../core/IDecider.js'

export class LLMDecider {
  constructor(executorAI, options = {}) {
    this.executorAI = executorAI
    this.onChunk = options.onChunk ?? (() => {})
    this.onCallStart = options.onCallStart ?? (() => {})
    this.onCallEnd = options.onCallEnd ?? (() => {})
  }

  async planInitial(input = {}) {
    const response = await this.callStreaming(
      'InitialPlanning',
      {
        cards: input.cards,
        totalGasPool: input.totalGasPool,
        scene: input.scene,
        remainingTimeWindowSec: input.remainingTimeWindowSec,
        battlePlan: input.battlePlan,
      },
      'reasoning',
    )

    return normalizeInitialPlan(response, input.cards ?? [])
  }

  async decideOnIncident(snapshot = {}) {
    if (snapshot.event === INCIDENT_TYPES.PLAYER_INTERVENTION) {
      return this.decideOnPlayerIntervention(snapshot)
    }

    const response = await this.callStreaming(
      'IncidentResponse',
      snapshot,
      'reasoning',
      snapshot.affectedCardId,
    )

    return normalizeIncidentDecision(mapIncidentResponse(response, snapshot), {
      action: DECIDER_ACTIONS.CONTINUE,
      targetCardId: snapshot.affectedCardId,
    })
  }

  async summarize(input = {}) {
    return this.callStreaming(
      'SettlementReport',
      input,
      'summary',
    )
  }

  async decideOnPlayerIntervention(snapshot = {}) {
    const response = await this.callStreaming(
      'PlayerIntervention',
      {
        playerInstruction: snapshot.playerInstruction ?? '',
        currentExecutionState: {
          remainingGasPool: snapshot.remainingGasPool ?? 0,
          allCardStatuses: snapshot.allCardStatuses ?? [],
        },
      },
      'reasoning',
      snapshot.affectedCardId,
    )

    return normalizeIncidentDecision(
      {
        action: response.updatedGasAllocations?.length ? DECIDER_ACTIONS.REALLOCATE_GAS : DECIDER_ACTIONS.CONTINUE,
        targetCardId: snapshot.affectedCardId,
        gasAllocations: response.updatedGasAllocations,
        updatedExecutionOrder: response.updatedExecutionOrder,
        reasoning: response.interpretedIntent
          ? `${response.interpretedIntent}：${response.reasoning ?? ''}`
          : response.reasoning,
      },
      {
        action: DECIDER_ACTIONS.CONTINUE,
        targetCardId: snapshot.affectedCardId,
      },
    )
  }

  async callStreaming(callType, input, streamField, cardId = null) {
    this.onCallStart({ callType, cardId })
    try {
      return await this.executorAI.callStreaming(
        callType,
        input,
        (chunk) => this.onChunk({ callType, cardId, chunk }),
        streamField,
      )
    } finally {
      this.onCallEnd({ callType, cardId })
    }
  }
}

function mapIncidentResponse(response = {}, snapshot = {}) {
  if (response.action) return response

  const selected = response.candidatePlans?.find((plan) => plan.planId === response.selectedPlanId)
  const planId = response.selectedPlanId ?? selected?.planId
  const action = actionForPlanId(planId)

  return {
    action,
    targetCardId: snapshot.affectedCardId,
    gas: selected?.gas ?? selected?.gasAllocations?.find((item) => item.cardId === snapshot.affectedCardId)?.gas,
    gasAllocations: selected?.gasAllocations,
    reasoning: response.reasoning ?? selected?.description,
  }
}

function actionForPlanId(planId) {
  const normalized = String(planId ?? '').toLowerCase()
  if (normalized.includes('abandon')) return DECIDER_ACTIONS.ABANDON_CARD
  if (normalized.includes('replace') || normalized.includes('raise') || normalized.includes('fight')) return DECIDER_ACTIONS.REPLACE_TX
  if (normalized.includes('reallocate')) return DECIDER_ACTIONS.REALLOCATE_GAS
  if (normalized.includes('retry')) return DECIDER_ACTIONS.RETRY_BROADCAST
  return DECIDER_ACTIONS.CONTINUE
}
