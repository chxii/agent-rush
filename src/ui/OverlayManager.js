import { SCENES } from '../config/scenes.js'
import { AGENT_GUIDE, BOT_GUIDE, RULES_PAGES } from '../config/guideContent.js'
import { ROLE_CONFIG } from '../config/roles.js'
import { ThoughtChainPanel } from './ThoughtChainPanel.js'

export const OverlayManager = {
  showStartMenu(gameState, onStart) {
    const panel = showOverlay(
      'Agent Rush',
      `
        <div class="start-menu">
          <p class="overlay-copy">你是一支 MEV 团队的指挥官。你制定战略：挑机会、分资源、定预案、临场改价；你的 AI Executor Agent 自主地、长程地把战略执行下去：它拆解任务、真实调用链上工具、观察结果，在被对手抢占或你改令时迭代修复，最终向你交付这一轮的战果。</p>
          <label class="display-id-field">
            <span class="label">显示用 ID</span>
            <input id="display-id-input" type="text" maxlength="16" pattern="[A-Za-z0-9_-]{1,16}" value="${escapeHtml(gameState.displayId ?? 'operator')}" placeholder="operator">
          </label>
          <div class="start-actions">
            <button id="start-game" class="primary-button" type="button">开始游戏</button>
            <button id="start-codex" class="secondary-button" type="button">游戏规则与图鉴</button>
          </div>
        </div>
      `,
      { closable: false, initialFocus: '#display-id-input' },
    )

    panel.querySelector('#start-game').addEventListener('click', () => {
      ThoughtChainPanel.setDisplayId(gameState.setDisplayId(panel.querySelector('#display-id-input')?.value))
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
            <button id="welcome-skip" class="secondary-button" type="button">关闭</button>
            <span>${pageIndex + 1} / ${RULES_PAGES.length}</span>
            <div class="guide-pager-actions">
              <button id="welcome-prev" class="secondary-button" type="button" ${pageIndex === 0 ? 'disabled' : ''}>上一页</button>
              <button id="welcome-next" class="primary-button" type="button">
                ${pageIndex === RULES_PAGES.length - 1 ? '开始游戏' : '下一页'}
              </button>
            </div>
          </div>
        `,
        { initialFocus: '#welcome-next', onClose: () => finish(onDone) },
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
        <div class="bot-intro">${formatBotEntry(bot)}</div>
        <button id="bot-intro-confirm" class="primary-button" type="button">知道了</button>
      `,
      { initialFocus: '#bot-intro-confirm', onClose: () => finish(onDone) },
    )

    panel.querySelector('#bot-intro-confirm').addEventListener('click', () => finish(onDone))
  },

  showSceneSelect(availableScenes, onSelect) {
    const intro = `
      <p class="overlay-copy">不同的“猎场”机会不一样：有的稳、骗局少；有的野、骗局多但大牌也多。还要留意每个场景常驻的对手是谁。挑一个你这一层想下的赌注。</p>
    `
    const body = availableScenes
      .map((sceneId) => {
        const scene = SCENES[sceneId]
        return `
          <button class="choice-card scene-${sceneId}" data-scene-id="${sceneId}" type="button">
            <strong>${scene.name}</strong>
            <span>${scene.styleHint}</span>
            <span>骗局率 ${(scene.scamRate * 100).toFixed(0)}%</span>
            <span>Bot 偏好 ${scene.botPreference ?? '无'}</span>
          </button>
        `
      })
      .join('')

    const panel = showOverlay('选择场景', `${intro}<div class="choice-grid">${body}</div>`, { closable: false })
    panel.querySelectorAll('[data-scene-id]').forEach((button) => {
      button.addEventListener('click', () => {
        this.hideAll()
        onSelect(button.dataset.sceneId)
      })
    })
  },

  showRoleSelect(roles, onSelect) {
    const intro = `
      <p class="overlay-copy">先定一个打法：多看牌的信息流、扛得住抢的硬派，或家底厚的资源派。整局都会跟着你，选一个合你胃口的开打。</p>
    `
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

    const panel = showOverlay('选择起始角色', `${intro}<div class="choice-grid">${body}</div>`, { closable: false })
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
        <section class="gentry guide-entry bot-intro" style="--accent2:${agentAccent(role ?? {})}">
          <div class="gh">
            <span class="gn">${role?.name ?? '角色强化'}</span>
            <span class="gtag">Lv.${roleLevel}</span>
          </div>
          <p class="buffline">${formatRoleUpgrade(role, roleLevel)}</p>
        </section>
        <button id="boss-reward-confirm" class="primary-button" type="button">继续</button>
      `,
      { closable: false, initialFocus: '#boss-reward-confirm' },
    )
    panel.querySelector('#boss-reward-confirm').addEventListener('click', () => {
      this.hideAll()
      onConfirm()
    })
  },

  showCodex(onClose = () => {}) {
    let activeTab = 'rules'
    let rulesPageIndex = 0

    const render = () => {
      const panel = showCodexOverlay(
        '游戏规则与图鉴',
        `
          <div class="guide-tabs">
            <button data-guide-tab="rules" class="${activeTab === 'rules' ? 'active' : ''}" type="button">规则</button>
            <button data-guide-tab="agents" class="${activeTab === 'agents' ? 'active' : ''}" type="button">角色</button>
            <button data-guide-tab="bots" class="${activeTab === 'bots' ? 'active' : ''}" type="button">对手</button>
          </div>
          <div class="guide-content">${formatCodexTab(activeTab, rulesPageIndex)}</div>
          <button id="codex-close" class="primary-button" type="button">关闭</button>
        `,
        {
          initialFocus: '#codex-close',
          onClose: () => {
            this.hideCodex()
            onClose()
          },
        },
      )

      panel.querySelectorAll('[data-guide-tab]').forEach((button) => {
        button.addEventListener('click', () => {
          activeTab = button.dataset.guideTab
          if (activeTab !== 'rules') rulesPageIndex = 0
          render()
        })
      })
      panel.querySelector('#codex-rules-prev')?.addEventListener('click', () => {
        rulesPageIndex = Math.max(0, rulesPageIndex - 1)
        render()
      })
      panel.querySelector('#codex-rules-next')?.addEventListener('click', () => {
        rulesPageIndex = Math.min(RULES_PAGES.length - 1, rulesPageIndex + 1)
        render()
      })
      panel.querySelectorAll('#codex-close, #codex-close-x').forEach((button) => button.addEventListener('click', () => {
        this.hideCodex()
        onClose()
      }))
    }

    render()
  },

  showGameOver(stats, onRestart) {
    const panel = showOverlay(
      '出局 💀',
      `
        <p class="overlay-copy">连亏压力顶到了头——<strong>连续亏损踩线、同时累计收益也跌破了失败线</strong>，两条线一起亮红，这局到此为止。别灰心，换个角色、换套打法，缝还在那儿。</p>
        ${formatFinalStats(stats)}
        <button id="restart-game" class="primary-button" type="button">再来一局</button>
      `,
      { closable: false, initialFocus: '#restart-game' },
    )
    panel.querySelector('#restart-game').addEventListener('click', onRestart)
  },

  showLayer20Fail(stats, onRestart) {
    const profit = Number(stats.cumulativeProfit ?? 0)
    const panel = showOverlay(
      '差一口气',
      `
        <p class="overlay-copy">你撑到了第 20 层，从 Bot-404 一路杀到 Genesis，但累计收益没能站上胜利线（需 &gt; 8.75 ETH，你只到了 <strong>${profit.toFixed(2)} ETH</strong>）。终局之战，差的不是勇气，是那几笔没抓住的肥肉。换套打法，再来一次。</p>
        ${formatFinalStats(stats)}
        <button id="restart-game" class="primary-button" type="button">再来一局</button>
      `,
      { closable: false, initialFocus: '#restart-game' },
    )
    panel.querySelector('#restart-game').addEventListener('click', onRestart)
  },

  showVictory(stats, onRestart) {
    const panel = showOverlay(
      '收网成功 🏆',
      `
        <p class="overlay-copy">你带着 Executor 一路杀穿 20 层，从 Bot-404 摸到 Genesis，累计净赚 <strong>${Number(stats.cumulativeProfit ?? 0).toFixed(2)} ETH</strong>，稳稳站上了胜利线。这条链上的缝，被你薅明白了。</p>
        ${formatFinalStats(stats)}
        <button id="restart-game" class="primary-button" type="button">再来一局</button>
      `,
      { closable: false, initialFocus: '#restart-game' },
    )
    panel.querySelector('#restart-game').addEventListener('click', onRestart)
  },

  hideAll() {
    document.querySelectorAll('.overlay-layer.visible').forEach((panel) => hidePanel(panel))
  },

  hideCodex() {
    document.querySelectorAll('.codex-layer.visible').forEach((panel) => hidePanel(panel))
  },
}

const FOCUSABLE_SELECTOR = [
  'a[href]',
  'button:not([disabled])',
  'input:not([disabled])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  '[tabindex]:not([tabindex="-1"])',
].join(',')
const focusTraps = new WeakMap()

function showOverlay(title, body, options = {}) {
  const panel = getOverlay()
  OverlayManager.hideAll()
  panel.innerHTML = `
    <div class="overlay-dialog">
      <h2>${title}</h2>
      ${body}
    </div>
  `
  panel.classList.add('visible')
  activateFocusTrap(panel, {
    closable: options.closable,
    initialFocus: options.initialFocus,
    onClose: options.onClose ?? (() => OverlayManager.hideAll()),
  })
  return panel
}

function showCodexOverlay(title, body, options = {}) {
  const panel = getCodexOverlay()
  panel.innerHTML = `
    <div class="overlay-dialog codex-dialog">
      <h2>${title}</h2>
      <button id="codex-close-x" class="codex-close-x" type="button" aria-label="关闭图鉴">×</button>
      ${body}
    </div>
  `
  panel.classList.add('visible')
  activateFocusTrap(panel, {
    closable: options.closable,
    initialFocus: options.initialFocus,
    onClose: options.onClose ?? (() => OverlayManager.hideCodex()),
  })
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

function hidePanel(panel) {
  panel.classList.remove('visible')
  deactivateFocusTrap(panel)
}

function activateFocusTrap(panel, options = {}) {
  const existing = focusTraps.get(panel)
  const previousActive = existing?.previousActive ?? document.activeElement
  if (existing?.onKeyDown) panel.removeEventListener('keydown', existing.onKeyDown)

  const trap = {
    previousActive,
    onKeyDown(event) {
      if (!panel.classList.contains('visible')) return

      if (event.key === 'Escape' && options.closable !== false) {
        event.preventDefault()
        options.onClose?.()
        return
      }

      if (event.key !== 'Tab') return
      const focusable = getFocusable(panel)
      if (focusable.length === 0) {
        event.preventDefault()
        panel.focus()
        return
      }

      const first = focusable[0]
      const last = focusable[focusable.length - 1]
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault()
        last.focus()
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault()
        first.focus()
      }
    },
  }

  panel.addEventListener('keydown', trap.onKeyDown)
  focusTraps.set(panel, trap)

  window.requestAnimationFrame(() => {
    const preferred = options.initialFocus ? panel.querySelector(options.initialFocus) : null
    const target = preferred ?? getFocusable(panel)[0] ?? panel.querySelector('.overlay-dialog') ?? panel
    if (!target.hasAttribute('tabindex') && !target.matches(FOCUSABLE_SELECTOR)) target.setAttribute('tabindex', '-1')
    target.focus({ preventScroll: true })
  })
}

function deactivateFocusTrap(panel) {
  const trap = focusTraps.get(panel)
  if (!trap) return
  panel.removeEventListener('keydown', trap.onKeyDown)
  focusTraps.delete(panel)

  if (trap.previousActive && typeof trap.previousActive.focus === 'function' && document.contains(trap.previousActive)) {
    trap.previousActive.focus({ preventScroll: true })
  }
}

function getFocusable(panel) {
  return [...panel.querySelectorAll(FOCUSABLE_SELECTOR)].filter((element) => {
    if (element.disabled || element.getAttribute('aria-hidden') === 'true') return false
    return Boolean(element.offsetParent || element.getClientRects().length)
  })
}

function formatCodexTab(tab, rulesPageIndex = 0) {
  if (tab === 'rules') {
    const pageIndex = Math.max(0, Math.min(RULES_PAGES.length - 1, rulesPageIndex))
    const page = RULES_PAGES[pageIndex]
    return `
      <section class="guide-section"><h3>${page.title}</h3>${formatParagraphs(page.body)}</section>
      <div class="guide-pager codex-rule-pager">
        <button id="codex-rules-prev" class="secondary-button" type="button" ${pageIndex === 0 ? 'disabled' : ''}>上一页</button>
        <span>${pageIndex + 1} / ${RULES_PAGES.length}</span>
        <button id="codex-rules-next" class="secondary-button" type="button" ${pageIndex === RULES_PAGES.length - 1 ? 'disabled' : ''}>下一页</button>
      </div>
    `
  }

  if (tab === 'agents') {
    const entries = Object.values(AGENT_GUIDE)
      .sort((a, b) => a.order - b.order)
      .map(formatAgentEntry)
      .join('')
    return `${entries}<p class="guide-footnote">角色 buff 整局生效，Boss 层通关还能升级。</p>`
  }

  const entries = Object.values(BOT_GUIDE)
    .sort((a, b) => a.order - b.order)
    .map(formatBotEntry)
    .join('')
  return `<p class="overlay-copy">和你抢机会的，是一群越来越强的对手 Bot。段位越靠后，它们越爱压价、越会抢同一笔机会。</p>${entries}`
}

function formatAgentEntry(agent) {
  const accent = agentAccent(agent)
  return `
    <section class="gentry guide-entry" style="--accent2:${accent}">
      <div class="gh">
        <span class="gn">${agent.name}</span>
        <span class="gtag">${agent.role}</span>
      </div>
      <p class="buffline">${agent.summary}</p>
      <p>${agent.howToUse}</p>
      <p>${agent.withoutIt}</p>
    </section>
  `
}

function formatBotEntry(bot) {
  const threat = threatLevel(bot.threat)
  return `
    <section class="gentry guide-entry" style="--accent2:${botAccent(threat)}">
      <div class="gh">
        <span class="gn">${bot.name}</span>
        <span class="gtag">${bot.layers}</span>
        <span class="gthreat threat-${threat}">威胁 ${bot.threat}</span>
      </div>
      <p>${bot.style}</p>
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
        <strong>连续亏损</strong>
        <span>${Math.max(0, Math.round(Number(stats.consecutiveLoss) || 0))}</span>
      </div>
    </div>
  `
}

function formatSignedEth(value) {
  const number = Number(value) || 0
  return `${number >= 0 ? '+' : ''}${number.toFixed(3)} ETH`
}

function formatRoleUpgrade(role, roleLevel) {
  if (!role) return `角色已强化到 Lv.${roleLevel}。`

  const level = role.levels?.[roleLevel] ?? {}
  if (role.id === 'scout') {
    return `${role.name} 升到 Lv.${roleLevel}：每轮现在多发 <strong>${level.scanCardBonus ?? 1}</strong> 张机会牌。`
  }

  if (role.id === 'resist') {
    const steal = Math.round((level.stealProbabilityMultiplier ?? 1) * 100)
    const bid = Math.round((level.replaceRequiredBidMultiplier ?? 1) * 100)
    const bonus = Math.round((level.replaceSuppressProbabilityBonus ?? 0) * 100)
    return `${role.name} 升到 Lv.${roleLevel}：被抢概率降到约 <strong>${steal}%</strong>，反抢出价约 <strong>${bid}%</strong>，成功率额外 +<strong>${bonus}%</strong>。`
  }

  if (role.id === 'efficiency') {
    const bonus = Math.round(((level.gasPoolMultiplier ?? 1) - 1) * 100)
    return `${role.name} 升到 Lv.${roleLevel}：Gas Pool 上限 +<strong>${bonus}%</strong>。`
  }

  return `${role.name} 已强化到 Lv.${roleLevel}。${role.buffSummary ?? ''}`
}

function agentAccent(agent) {
  if (agent.name.includes('侦察')) return '#2bd98a'
  if (agent.name.includes('抗压')) return '#4aa8ff'
  if (agent.name.includes('效率')) return '#ff9d3d'
  return '#b07cff'
}

function threatLevel(threat) {
  return {
    极低: 1,
    低: 2,
    中: 3,
    高: 4,
    极高: 5,
  }[threat] ?? 3
}

function botAccent(threat) {
  return ['#7fa39a', '#2bd98a', '#ffc14d', '#ff9d3d', '#ff5d8f'][threat - 1] ?? '#ffc14d'
}

function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}
