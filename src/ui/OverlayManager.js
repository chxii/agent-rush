import { SCENES } from '../config/scenes.js'
import { AGENT_GUIDE, BOT_GUIDE, RULES_PAGES } from '../config/guideContent.js'
import { ROLE_CONFIG } from '../config/roles.js'

export const OverlayManager = {
  showStartMenu(gameState, onStart) {
    const role = ROLE_CONFIG.roles[gameState.role]
    const seenBotCount = gameState.seenBots.length

    const panel = showOverlay(
      'Agent Rush',
      `
        <div class="start-menu">
          <p class="overlay-copy">在链上机会中看牌、分配 Gas、设定预案，并让 Executor 运行半闭环执行。</p>
          <div class="start-progress">
            <div>
              <strong>当前角色</strong>
              <div class="start-chip-list"><span>${role ? `${role.name} Lv.${gameState.roleLevel}` : '开局选择'}</span></div>
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
            <span>Bot 偏好 ${scene.botPreference ?? '无'}</span>
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

  showRoleSelect(roles, onSelect) {
    const body = Object.values(roles)
      .map(
        (role) => `
          <button class="choice-card" data-role-id="${role.id}" type="button">
            <strong>${role.name}</strong>
            <span>${role.tagline}</span>
            <span>${role.buffSummary}</span>
            <small>${role.description}</small>
          </button>
        `,
      )
      .join('')

    const panel = showOverlay('选择起始角色', `<div class="choice-grid">${body}</div>`)
    panel.querySelectorAll('[data-role-id]').forEach((button) => {
      button.addEventListener('click', () => {
        this.hideAll()
        onSelect(button.dataset.roleId)
      })
    })
  },

  showBossReward(roleId, roleLevel, onConfirm) {
    const role = ROLE_CONFIG.roles[roleId]
    const panel = showOverlay(
      'Boss 奖励',
      `
        <p class="overlay-copy">${role?.name ?? '角色'} 已强化到 Lv.${roleLevel}。</p>
        <p class="overlay-copy">${role?.buffSummary ?? '当前角色 buff 已强化。'}</p>
        <button id="boss-reward-confirm" class="primary-button" type="button">继续</button>
      `,
    )
    panel.querySelector('#boss-reward-confirm').addEventListener('click', () => {
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
            <button data-guide-tab="agents" class="${activeTab === 'agents' ? 'active' : ''}" type="button">角色</button>
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
        <p class="overlay-copy">连亏压力已经触发失败线。重新开始后可以再次选择起始角色。</p>
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
        <p class="overlay-copy">已打通第 20 层，累计收益 ${Number(stats.cumulativeProfit ?? 0).toFixed(2)} ETH。</p>
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
      <p><strong>定位</strong><span>${agent.role}</span></p>
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
        <strong>最终层数</strong>
        <span>${stats.currentLayer ?? 1}</span>
      </div>
      <div>
        <strong>累计收益</strong>
        <span>${formatSignedEth(stats.cumulativeProfit)}</span>
      </div>
      <div>
        <strong>连亏次数</strong>
        <span>${Math.max(0, Math.round(Number(stats.consecutiveLoss) || 0))}</span>
      </div>
    </div>
  `
}

function formatSignedEth(value) {
  const number = Number(value) || 0
  return `${number >= 0 ? '+' : ''}${number.toFixed(3)} ETH`
}
