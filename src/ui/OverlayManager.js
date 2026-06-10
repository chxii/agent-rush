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
          <p class="overlay-copy">Find on-chain opportunities, allocate Gas, set contingencies, and let Executor run the semi-closed loop.</p>
          <div class="start-progress">
            <div>
              <strong>Current Role</strong>
              <div class="start-chip-list"><span>${role ? `${role.name} Lv.${gameState.roleLevel}` : 'Choose at run start'}</span></div>
            </div>
            <div>
              <strong>Seen Bots</strong>
              <span>${seenBotCount} / ${Object.keys(BOT_GUIDE).length}</span>
            </div>
          </div>
          <div class="start-actions">
            <button id="start-game" class="primary-button" type="button">Start Game</button>
            <button id="start-codex" class="secondary-button" type="button">Codex</button>
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
            <button id="welcome-skip" class="secondary-button" type="button">Skip</button>
            <span>${pageIndex + 1} / ${RULES_PAGES.length}</span>
            <div class="guide-pager-actions">
              <button id="welcome-prev" class="secondary-button" type="button" ${pageIndex === 0 ? 'disabled' : ''}>Prev</button>
              <button id="welcome-next" class="primary-button" type="button">
                ${pageIndex === RULES_PAGES.length - 1 ? 'Start' : 'Next'}
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
      `New Bot: ${bot.name}`,
      `
        <div class="guide-entry bot-intro">
          <p><strong>Layers</strong><span>${bot.layers}</span></p>
          <p><strong>Threat</strong><span class="threat-text">${bot.threat}</span></p>
          <p><strong>Style</strong><span>${bot.style}</span></p>
        </div>
        <button id="bot-intro-confirm" class="primary-button" type="button">Got it</button>
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
            <span>Scam rate ${(scene.scamRate * 100).toFixed(0)}%</span>
            <span>Bot bias ${scene.botPreference ?? 'none'}</span>
          </button>
        `
      })
      .join('')

    const panel = showOverlay('Choose Scene', `<div class="choice-grid">${body}</div>`)
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

    const panel = showOverlay('Choose Starting Role', `<div class="choice-grid">${body}</div>`)
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
      'Boss Reward',
      `
        <p class="overlay-copy">${role?.name ?? 'Role'} upgraded to Lv.${roleLevel}.</p>
        <p class="overlay-copy">${role?.buffSummary ?? 'Your role buff has been strengthened.'}</p>
        <button id="boss-reward-confirm" class="primary-button" type="button">Continue</button>
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
        'Codex',
        `
          <div class="guide-tabs">
            <button data-guide-tab="rules" class="${activeTab === 'rules' ? 'active' : ''}" type="button">Rules</button>
            <button data-guide-tab="agents" class="${activeTab === 'agents' ? 'active' : ''}" type="button">Roles</button>
            <button data-guide-tab="bots" class="${activeTab === 'bots' ? 'active' : ''}" type="button">Bots</button>
          </div>
          <div class="guide-content">${formatCodexTab(activeTab)}</div>
          <button id="codex-close" class="primary-button" type="button">Close</button>
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
      'Game Over',
      `
        <p class="overlay-copy">Loss pressure crossed the failure line. Start a new run to choose a role again.</p>
        ${formatFinalStats(stats)}
        <button id="restart-game" class="primary-button" type="button">Restart</button>
      `,
    )
    panel.querySelector('#restart-game').addEventListener('click', onRestart)
  },

  showVictory(stats, onRestart) {
    const panel = showOverlay(
      'Victory',
      `
        <p class="overlay-copy">Layer 20 cleared with total profit ${Number(stats.cumulativeProfit ?? 0).toFixed(2)} ETH.</p>
        ${formatFinalStats(stats)}
        <button id="restart-game" class="primary-button" type="button">Restart</button>
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
      <p><strong>Role</strong><span>${agent.role}</span></p>
      <p><strong>Effect</strong><span>${agent.summary}</span></p>
      <p><strong>Without it</strong><span>${agent.withoutIt}</span></p>
      <p><strong>How to use</strong><span>${agent.howToUse}</span></p>
    </section>
  `
}

function formatBotEntry(bot) {
  return `
    <section class="guide-entry">
      <h3>${bot.name}</h3>
      <p><strong>Layers</strong><span>${bot.layers}</span></p>
      <p><strong>Threat</strong><span class="threat-text">${bot.threat}</span></p>
      <p><strong>Style</strong><span>${bot.style}</span></p>
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
