import { SCENES } from '../config/scenes.js'

export const OverlayManager = {
  showSceneSelect(availableScenes, onSelect) {
    const body = availableScenes
      .map((sceneId) => {
        const scene = SCENES[sceneId]
        return `
          <button class="choice-card" data-scene-id="${sceneId}" type="button">
            <strong>${scene.name}</strong>
            <span>Scam ${(scene.scamRate * 100).toFixed(0)}%</span>
            <span>Bot ${scene.botPreference ?? 'low'}</span>
          </button>
        `
      })
      .join('')

    const panel = showOverlay('Select Scene', `<div class="choice-grid">${body}</div>`)
    panel.querySelectorAll('[data-scene-id]').forEach((button) => {
      button.addEventListener('click', () => {
        this.hideAll()
        onSelect(button.dataset.sceneId)
      })
    })
  },

  showAgentRoster(unlockedAgents, agentLevels, slots, onConfirm) {
    const selected = new Set(unlockedAgents.slice(0, slots))
    const body = `
      <div class="choice-grid">
        ${unlockedAgents
          .map(
            (agentId) => `
              <button class="choice-card" data-agent-id="${agentId}" type="button">
                <strong>${agentLabel(agentId)}</strong>
                <span>Lv.${agentLevels[agentId] ?? 1}</span>
              </button>
            `,
          )
          .join('')}
      </div>
      <button id="agent-roster-confirm" class="primary-button" type="button">确认阵容 (${slots})</button>
    `

    const panel = showOverlay('Agent Roster', body)
    panel.querySelectorAll('[data-agent-id]').forEach((button) => {
      button.classList.toggle('selected', selected.has(button.dataset.agentId))
      button.addEventListener('click', () => {
        const agentId = button.dataset.agentId
        if (selected.has(agentId)) {
          selected.delete(agentId)
        } else if (selected.size < slots) {
          selected.add(agentId)
        }
        button.classList.toggle('selected', selected.has(agentId))
      })
    })
    panel.querySelector('#agent-roster-confirm').addEventListener('click', () => {
      this.hideAll()
      onConfirm([...selected])
    })
  },

  showBossReward(unlockedAgents, agentLevels, onUpgrade) {
    const body = `
      <div class="choice-grid">
        ${unlockedAgents
          .map(
            (agentId) => `
              <button class="choice-card" data-upgrade-id="${agentId}" type="button">
                <strong>${agentLabel(agentId)}</strong>
                <span>Lv.${agentLevels[agentId] ?? 1} -> Lv.${Math.min((agentLevels[agentId] ?? 1) + 1, 3)}</span>
              </button>
            `,
          )
          .join('')}
      </div>
    `
    const panel = showOverlay('Boss Reward', body)
    panel.querySelectorAll('[data-upgrade-id]').forEach((button) => {
      button.addEventListener('click', () => {
        this.hideAll()
        onUpgrade(button.dataset.upgradeId)
      })
    })
  },

  showAgentUnlock(agentId, onConfirm) {
    const panel = showOverlay(
      'Agent Unlocked',
      `<p class="overlay-copy">${agentLabel(agentId)} joined the roster.</p><button id="unlock-confirm" class="primary-button" type="button">继续</button>`,
    )
    panel.querySelector('#unlock-confirm').addEventListener('click', () => {
      this.hideAll()
      onConfirm()
    })
  },

  showGameOver(onRestart) {
    const panel = showOverlay(
      'Game Over',
      '<p class="overlay-copy">连续亏损或累计亏损过高，本轮模拟结束。已解锁 Agent 会保留。</p><button id="restart-game" class="primary-button" type="button">重新开始</button>',
    )
    panel.querySelector('#restart-game').addEventListener('click', onRestart)
  },

  showVictory(stats, onRestart) {
    const panel = showOverlay(
      'Victory',
      `<p class="overlay-copy">通关完成。累计收益 ${stats.cumulativeProfit.toFixed(2)} ETH。</p><button id="restart-game" class="primary-button" type="button">重新开始</button>`,
    )
    panel.querySelector('#restart-game').addEventListener('click', onRestart)
  },

  hideAll() {
    document.querySelectorAll('.overlay-layer.visible').forEach((panel) => panel.classList.remove('visible'))
  },
}

function showOverlay(title, body) {
  const panel = getOverlay()
  OverlayManager.hideAll()
  panel.innerHTML = `
    <div class="overlay-dialog">
      <h2>${title}</h2>
      ${body}
    </div>
  `
  panel.classList.add('visible')
  return panel
}

function getOverlay() {
  let panel = document.querySelector('#overlay-layer')
  if (!panel) {
    panel = document.createElement('section')
    panel.id = 'overlay-layer'
    panel.className = 'overlay-layer'
    document.body.append(panel)
  }
  return panel
}

function agentLabel(agentId) {
  const labels = {
    searcher: 'Searcher',
    riskAnalyzer: 'Risk Analyzer',
    executor: 'Executor',
    strategist: 'Strategist',
  }
  return labels[agentId] ?? agentId
}
