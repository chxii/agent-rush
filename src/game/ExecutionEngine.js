import { ExecutorAI } from '../ai/ExecutorAI.js'
import { LLMDecider } from '../ai/LLMDecider.js'
import { SEMI_LOOP_CONFIG } from '../config/execution.js'
import { RuleDecider } from '../core/RuleDecider.js'
import { runSemiLoopExecution } from '../core/SemiLoopExecutor.js'
import { createRandomSource } from '../core/rng.js'
import { ThoughtChainPanel } from '../ui/ThoughtChainPanel.js'
import { UIRenderer } from '../ui/UIRenderer.js'

export const ExecutionEngine = {
  async runSemiLoopMode(battlePlan, gameState, options = {}) {
    const streamWriters = new Map()
    const decider =
      options.decider ??
      (ExecutorAI._useMock
        ? RuleDecider
        : new LLMDecider(ExecutorAI, {
        onCallStart: ({ callType, cardId }) => {
          const streamCardId = cardScopedCallTypes.has(callType) ? cardId : null
          const writer = ThoughtChainPanel.appendStreaming(`[${callType}] `, null, {
            cardId: streamCardId,
            cardTitle: streamCardId,
          })
          streamWriters.set(streamKey(callType, cardId), writer)
        },
        onChunk: ({ callType, cardId, chunk }) => {
          streamWriters.get(streamKey(callType, cardId))?.write(chunk)
        },
        onCallEnd: ({ callType, cardId }) => {
          streamWriters.get(streamKey(callType, cardId))?.end()
          streamWriters.delete(streamKey(callType, cardId))
        },
      }))

    return runSemiLoopExecution(
      battlePlan,
      {
        gameState,
        gasPool: gameState.gasPool,
        layer: gameState.currentLayer,
        scene: gameState.currentScene,
      },
      {
        decider,
        rng: options.rng ?? createRandomSource(options.seed),
        seed: options.seed,
        maxReplans: options.maxReplans,
        config: options.config ?? SEMI_LOOP_CONFIG,
        toolConfig: options.toolConfig,
        interventionState: options.interventionState,
        forceSteal: options.forceSteal,
        delay: options.delay ?? ((ms) => delay(ms)),
        hooks: createUiHooks({
          gameState,
          onExecutionComplete: options.onExecutionComplete,
          pipeline: options.pipeline,
        }),
      },
    )
  },
}

const cardScopedCallTypes = new Set(['CardExecution'])

function createUiHooks(options = {}) {
  return {
    onCardStart({ card }) {
      options.pipeline?.start?.(card)
      ThoughtChainPanel.startCard(card)
    },

    onInitialPlan({ executionOrder, reasoning }) {
      options.pipeline?.reorder?.(executionOrder, reasoning)
    },

    onToolResult({ card, action, params, result }) {
      if (result?.remainingGasPool != null && options.gameState) {
        options.gameState.gasPool = Math.max(0, Math.round(Number(result.remainingGasPool) || 0))
        UIRenderer.renderHeader(options.gameState)
      }

      if (!card) return
      options.pipeline?.update?.(card)
      ThoughtChainPanel.appendCardEvent(card.id, {
        kind: 'tool',
        title: action,
        detail: result.message ?? action,
        meta: formatParams(params),
      })
    },

    onIncident({ card, snapshot }) {
      options.pipeline?.incident?.(card, snapshot)
      ThoughtChainPanel.appendCardEvent(card.id, {
        kind: 'incident',
        title: incidentTitle(snapshot.trigger.type),
        detail: incidentDetail(snapshot),
      })
    },

    onDecision({ card, snapshot, decision }) {
      options.pipeline?.decision?.(card, decision)
      ThoughtChainPanel.appendCardEvent(card.id, {
        kind: decision.fallback ? 'system' : 'repair',
        title: decision.fallback ? '规则保底' : 'Executor 重规划',
        detail: replanDetail(snapshot, decision),
      })
    },

    onFallback({ reason, snapshot, error }) {
      ThoughtChainPanel.appendLog({
        timestampMs: Date.now(),
        source: 'system',
        text: `[自动保底] ${fallbackReason(reason)}：${snapshot?.affectedCardId ?? ''}${error ? ` (${error.message})` : ''}`,
        isStreaming: false,
      })
    },
    onExecutionComplete(payload) {
      options.pipeline?.complete?.(payload?.result)
      options.onExecutionComplete?.(payload)
    },
  }
}

function streamKey(callType, cardId) {
  return `${callType}:${cardId ?? 'round'}`
}

function incidentTitle(type) {
  const titles = {
    target_stolen: '目标被抢占',
    tx_failed: '交易失败',
    gas_insufficient: 'Gas 不足',
    player_intervention: '玩家干预',
    target_invalid: '目标失效',
  }
  return titles[type] ?? type
}

function incidentDetail(snapshot = {}) {
  const trigger = snapshot.trigger ?? {}
  if (trigger.type === 'TARGET_STOLEN') {
    const bidder = trigger.rawResult?.competitor ?? '对手 Bot'
    const bid = trigger.competitorGasBid ? `${trigger.competitorGasBid} Gwei` : '更高 Gas'
    return `${bidder} 抢先打包了目标，出价 ${bid}。你的预案：${contingencyLabel(snapshot.playerContingency)}。${trigger.message ?? ''}`
  }

  if (trigger.type === 'PLAYER_INTERVENTION') {
    return `玩家指令：${snapshot.playerInstruction ?? '调整执行策略'}。Executor 将按现场状态重规划。`
  }

  return trigger.message ?? trigger.type ?? '现场状态发生变化。'
}

function replanDetail(snapshot = {}, decision = {}) {
  const target = decision.targetCardId ? `转向 ${decision.targetCardId}` : `处理 ${snapshot.affectedCardId ?? '当前机会'}`
  const action = decision.action ? `动作 ${decision.action}` : '调整执行顺序'
  const reason = decision.reasoning ?? '根据现场状态更新执行计划。'
  return `→ 重规划：${target}，${action}。${reason}`
}

function contingencyLabel(value) {
  const labels = {
    fight: '硬刚',
    abandon: '放弃',
    transfer: '转移',
  }
  return labels[value] ?? value ?? '未设置'
}

function fallbackReason(reason) {
  const labels = {
    replan_limit: '重规划次数达到上限，切换 RuleDecider',
    decider_error: 'LLM 决策异常，切换 RuleDecider',
  }
  return labels[reason] ?? reason
}

function formatParams(params) {
  const entries = Object.entries(params ?? {})
  if (!entries.length) return ''
  return entries.map(([key, value]) => `${key}=${value}`).join(' · ')
}

function delay(ms) {
  return new Promise((resolve) => {
    window.setTimeout(resolve, ms)
  })
}
