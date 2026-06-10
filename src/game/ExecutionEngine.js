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
          const writer = ThoughtChainPanel.appendStreaming(`[${callType}] `, null, {
            cardId,
            cardTitle: cardId,
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
        rng: options.rng ?? createRandomSource(),
        maxReplans: options.maxReplans,
        config: options.config ?? SEMI_LOOP_CONFIG,
        interventionState: options.interventionState,
        delay: (ms) => delay(ms),
        hooks: createUiHooks({
          gameState,
          onExecutionComplete: options.onExecutionComplete,
        }),
      },
    )
  },
}

function createUiHooks(options = {}) {
  return {
    onCardStart({ card }) {
      ThoughtChainPanel.startCard(card)
    },

    onToolResult({ card, action, params, result }) {
      if (result?.remainingGasPool != null && options.gameState) {
        options.gameState.gasPool = Math.max(0, Math.round(Number(result.remainingGasPool) || 0))
        UIRenderer.renderHeader(options.gameState)
      }

      if (!card) return
      ThoughtChainPanel.appendCardEvent(card.id, {
        kind: 'tool',
        title: action,
        detail: result.message ?? action,
        meta: formatParams(params),
      })
    },

    onIncident({ card, snapshot }) {
      ThoughtChainPanel.appendCardEvent(card.id, {
        kind: 'bot',
        title: incidentTitle(snapshot.trigger.type),
        detail: snapshot.trigger.message,
      })
    },

    onDecision({ card, decision }) {
      ThoughtChainPanel.appendCardEvent(card.id, {
        kind: decision.fallback ? 'system' : 'repair',
        title: decision.fallback ? '规则保底' : 'Executor 重规划',
        detail: decision.reasoning,
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
