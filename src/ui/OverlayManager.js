import { SCENES } from '../config/scenes.js'
import { AGENT_GUIDE, BOT_GUIDE, RULES_PAGES } from '../config/guideContent.js'

export const OverlayManager = {
  showStartMenu(gameState, onStart) {
    const agentRows = gameState.unlockedAgents
      .map((agentId) => {
        const guide = AGENT_GUIDE[agentId]
        return `<span>${guide?.name ?? agentId} Lv.${gameState.agentLevels[agentId] ?? 1}</span>`
      })
      .join('')
    const seenBotCount = gameState.seenBots.length

    const panel = showOverlay(
      'Agent Rush',
      `
        <div class="start-menu">
          <p class="overlay-copy">指挥一支 MEV Agent 战队，在 20 层链上战场中发现机会、分配 Gas、击退对手 Bot。</p>
          <div class="start-progress">
            <div>
              <strong>已解锁 Agent</strong>
              <div class="start-chip-list">${agentRows || '<span>Searcher Lv.1</span>'}</div>
            </div>
            <div>
              <strong>已遭遇对手</strong>
              <span>${seenBotCount} / ${Object.keys(BOT_GUIDE).length}</span>
            </div>
          </div>
          <div class="start-actions">
            <button id="start-game" class="primary-button" type="button">开始游戏</button>
            <button id="start-codex" class="secondary-button" type="button">图鉴</button>
          </div>
        </div>
      `,
    )

    panel.querySelector('#start-game').addEventListener('click', () => {
      this.hideAll()
      onStart()
    })
    panel.querySelector('#start-codex').addEventListener('click', () => {
      this.showCodex(() => this.showStartMenu(gameState, onStart))
    })
  },

  showWelcome(onDone) {
    let pageIndex = 0

    const render = () => {
      const page = RULES_PAGES[pageIndex]
      const panel = showOverlay(
        page.title,
        `
          <div class="guide-copy">${formatParagraphs(page.body)}</div>
          <div class="guide-pager">
            <button id="welcome-skip" class="secondary-button" type="button">跳过</button>
            <span>${pageIndex + 1} / ${RULES_PAGES.length}</span>
            <div class="guide-pager-actions">
              <button id="welcome-prev" class="secondary-button" type="button" ${pageIndex === 0 ? 'disabled' : ''}>上一页</button>
              <button id="welcome-next" class="primary-button" type="button">
                ${pageIndex === RULES_PAGES.length - 1 ? '开始游戏' : '下一页'}
              </button>
            </div>
          </div>
        `,
      )

      panel.querySelector('#welcome-skip').addEventListener('click', () => finish(onDone))
      panel.querySelector('#welcome-prev').addEventListener('click', () => {
        pageIndex = Math.max(0, pageIndex - 1)
        render()
      })
      panel.querySelector('#welcome-next').addEventListener('click', () => {
        if (pageIndex >= RULES_PAGES.length - 1) {
          finish(onDone)
          return
        }

        pageIndex += 1
        render()
      })
    }

    render()
  },

  showBotIntro(botId, onDone) {
    const bot = BOT_GUIDE[botId]
    if (!bot) {
      onDone()
      return
    }

    const panel = showOverlay(
      `新对手出现：${bot.name}`,
      `
        <div class="guide-entry bot-intro">
          <p><strong>出现层数</strong><span>${bot.layers}</span></p>
          <p><strong>威胁等级</strong><span class="threat-text">${bot.threat}</span></p>
          <p><strong>风格</strong><span>${bot.style}</span></p>
        </div>
        <button id="bot-intro-confirm" class="primary-button" type="button">知道了</button>
      `,
    )

    panel.querySelector('#bot-intro-confirm').addEventListener('click', () => finish(onDone))
  },

  showSceneSelect(availableScenes, onSelect) {
    const body = availableScenes
      .map((sceneId) => {
        const scene = SCENES[sceneId]
        return `
          <button class="choice-card" data-scene-id="${sceneId}" type="button">
            <strong>${scene.name}</strong>
            <span>骗局率 ${(scene.scamRate * 100).toFixed(0)}%</span>
            <span>偏好 Bot ${scene.botPreference ?? '低'}</span>
          </button>
        `
      })
      .join('')

    const panel = showOverlay('选择场景', `<div class="choice-grid">${body}</div>`)
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

    const panel = showOverlay('Agent 阵容', body)
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
    const panel = showOverlay('Boss 奖励', body)
    panel.querySelectorAll('[data-upgrade-id]').forEach((button) => {
      button.addEventListener('click', () => {
        this.hideAll()
        onUpgrade(button.dataset.upgradeId)
      })
    })
  },

  showAgentUnlock(agentId, onConfirm) {
    const agent = AGENT_GUIDE[agentId]
    const panel = showOverlay(
      `${agent?.name ?? agentLabel(agentId)} 已解锁`,
      `
        ${agent ? formatAgentEntry(agent) : `<p class="overlay-copy">${agentLabel(agentId)} 加入了阵容。</p>`}
        <button id="unlock-confirm" class="primary-button" type="button">继续</button>
      `,
    )
    panel.querySelector('#unlock-confirm').addEventListener('click', () => {
      this.hideAll()
      onConfirm()
    })
  },

  showCodex(onClose = () => {}) {
    let activeTab = 'rules'

    const render = () => {
      const panel = showCodexOverlay(
        '图鉴',
        `
          <div class="guide-tabs">
            <button data-guide-tab="rules" class="${activeTab === 'rules' ? 'active' : ''}" type="button">规则</button>
            <button data-guide-tab="agents" class="${activeTab === 'agents' ? 'active' : ''}" type="button">Agents</button>
            <button data-guide-tab="bots" class="${activeTab === 'bots' ? 'active' : ''}" type="button">对手</button>
          </div>
          <div class="guide-content">${formatCodexTab(activeTab)}</div>
          <button id="codex-close" class="primary-button" type="button">关闭</button>
        `,
      )

      panel.querySelectorAll('[data-guide-tab]').forEach((button) => {
        button.addEventListener('click', () => {
          activeTab = button.dataset.guideTab
          render()
        })
      })
      panel.querySelector('#codex-close').addEventListener('click', () => {
        this.hideCodex()
        onClose()
      })
    }

    render()
  },

  showGameOver(stats, onRestart) {
    const panel = showOverlay(
      '游戏结束',
      `
        <p class="overlay-copy">连续亏损或累计亏损过高，本轮模拟结束。已解锁 Agent 会保留。</p>
        ${formatFinalStats(stats)}
        <button id="restart-game" class="primary-button" type="button">重新开始</button>
      `,
    )
    panel.querySelector('#restart-game').addEventListener('click', onRestart)
  },

  showVictory(stats, onRestart) {
    const panel = showOverlay(
      '胜利',
      `
        <p class="overlay-copy">通关完成。累计收益 ${Number(stats.cumulativeProfit ?? 0).toFixed(2)} ETH。</p>
        ${formatFinalStats(stats)}
        <button id="restart-game" class="primary-button" type="button">重新开始</button>
      `,
    )
    panel.querySelector('#restart-game').addEventListener('click', onRestart)
  },

  hideAll() {
    document.querySelectorAll('.overlay-layer.visible').forEach((panel) => panel.classList.remove('visible'))
  },

  hideCodex() {
    document.querySelectorAll('.codex-layer.visible').forEach((panel) => panel.classList.remove('visible'))
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

function showCodexOverlay(title, body) {
  const panel = getCodexOverlay()
  panel.innerHTML = `
    <div class="overlay-dialog codex-dialog">
      <h2>${title}</h2>
      ${body}
    </div>
  `
  panel.classList.add('visible')
  return panel
}

function finish(callback) {
  OverlayManager.hideAll()
  callback()
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

function getCodexOverlay() {
  let panel = document.querySelector('#codex-layer')
  if (!panel) {
    panel = document.createElement('section')
    panel.id = 'codex-layer'
    panel.className = 'codex-layer'
    document.body.append(panel)
  }
  return panel
}

function formatCodexTab(tab) {
  if (tab === 'rules') {
    return RULES_PAGES.map((page) => `<section class="guide-section"><h3>${page.title}</h3>${formatParagraphs(page.body)}</section>`).join('')
  }

  if (tab === 'agents') {
    return Object.values(AGENT_GUIDE)
      .sort((a, b) => a.order - b.order)
      .map(formatAgentEntry)
      .join('')
  }

  return Object.values(BOT_GUIDE)
    .sort((a, b) => a.order - b.order)
    .map(formatBotEntry)
    .join('')
}

function formatAgentEntry(agent) {
  return `
    <section class="guide-entry">
      <h3>${agent.name}</h3>
      <p><strong>职责</strong><span>${agent.role}</span></p>
      <p><strong>作用</strong><span>${agent.summary}</span></p>
      <p><strong>没有它会怎样</strong><span>${agent.withoutIt}</span></p>
      <p><strong>怎么用</strong><span>${agent.howToUse}</span></p>
    </section>
  `
}

function formatBotEntry(bot) {
  return `
    <section class="guide-entry">
      <h3>${bot.name}</h3>
      <p><strong>出现层数</strong><span>${bot.layers}</span></p>
      <p><strong>威胁等级</strong><span class="threat-text">${bot.threat}</span></p>
      <p><strong>风格</strong><span>${bot.style}</span></p>
    </section>
  `
}

function formatParagraphs(lines) {
  return lines.map((line) => `<p class="overlay-copy">${line}</p>`).join('')
}

function formatFinalStats(stats = {}) {
  return `
    <div class="final-stats">
      <div>
        <strong>Final Layer</strong>
        <span>${stats.currentLayer ?? 1}</span>
      </div>
      <div>
        <strong>Total Profit</strong>
        <span>${formatSignedEth(stats.cumulativeProfit)}</span>
      </div>
      <div>
        <strong>Loss Streak</strong>
        <span>${Math.max(0, Math.round(Number(stats.consecutiveLoss) || 0))}</span>
      </div>
    </div>
  `
}

function formatSignedEth(value) {
  const number = Number(value) || 0
  return `${number >= 0 ? '+' : ''}${number.toFixed(3)} ETH`
}

function agentLabel(agentId) {
  return AGENT_GUIDE[agentId]?.name ?? agentId
}
