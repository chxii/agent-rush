export const RULES_PAGES = [
  {
    title: '欢迎来到 Agent Rush',
    body: [
      '你是一支 MEV 团队的指挥官。MEV 指在区块链交易打包前，从交易顺序中抢到的利润。',
      '每一关，系统会从链上的“交易池（mempool）”里扫描出一批“机会牌”。你的任务：在有限的 Gas 预算和时间内，挑出能赚钱的机会去执行，并击退抢同一笔利润的敌方机器人。',
      '目标：一路打到第 20 层，把累计收益做到正数。连续亏损会被淘汰。',
    ],
  },
  {
    title: '一局怎么玩：四个阶段',
    body: [
      '① 扫描：你的 Agent 自动扫描机会，生成一手牌。',
      '② 选牌：在倒计时内点选你要执行的牌（受 Gas 预算限制），然后点 Play。',
      '③ 执行：选中的牌开始执行，敌方 Bot 可能来抢。解锁 Executor 后，它会实时调度、遇袭时修复。',
      '④ 结算：展示每张牌的盈亏，推进到下一层。',
    ],
  },
  {
    title: '怎么读一张机会牌',
    body: [
      '收益（ETH）：成功后赚多少。',
      'Gas：执行要花的成本，受本关 Gas 预算总量限制。',
      'Risk 风险：失败概率。注意——有“骗局牌”会把风险伪装得很低，解锁 RiskAnalyzer 后才能识破。',
      'Window 时间窗口：这个机会还能存活几秒，过期就作废。',
      '稀有度（common→legendary）：越稀有，收益越高、但 Gas 和风险也越高。',
    ],
  },
  {
    title: 'Agent 战队 与 对手 Bot',
    body: [
      'Agent 是你的队员，每过几关解锁一个新的，能力各不相同。最关键的是第 8 层解锁的 Executor——它让执行从“按固定脚本跑”升级为“实时思考、遇袭修复”。',
      '对手 Bot 会和你抢同一笔机会，越往后越强（从几乎抢不到，到大概率抢走）。每个 Bot 风格不同。',
      '随时点右上角的「图鉴」按钮，可以查看所有 Agent 和 Bot 的详细说明。',
    ],
  },
]

export const AGENT_GUIDE = {
  searcher: {
    name: 'Searcher',
    role: '信息 · 扫描阶段',
    order: 1,
    summary: '扫描交易池，发现套利、夹击、NFT 等机会，生成你的手牌。',
    withoutIt: '没有它就没有手牌——它是整局的起点，初始即拥有。',
    howToUse: '等级越高，每轮扫描出的机会牌越多（1→3张，2→4张，3→5张）。',
  },
  riskAnalyzer: {
    name: 'Risk Analyzer',
    role: '信息 · 扫描阶段',
    order: 2,
    summary: '评估每张牌的真实风险，识别伪装成高收益的“骗局牌”。',
    withoutIt: '没有它，骗局牌会显示成低风险高收益，很容易踩雷血亏。',
    howToUse: '解锁后骗局牌的风险会被标红揭穿。等级越高，识别越准。第 4 层 Boss 后解锁。',
  },
  executor: {
    name: 'Executor',
    role: '执行 · 执行阶段（核心）',
    order: 3,
    summary: '由真实 AI 驱动的执行官。把“执行这几张牌”实时拆解成子任务、多步规划、调用工具，遇到对手抢占时迭代修复。',
    withoutIt: '没有它是“刚体模式”：牌按固定顺序、固定 Gas 执行，被抢了也没法补救。',
    howToUse: '解锁并上阵后进入“自适应模式”，执行过程会在右侧思维链面板逐字展示。这是游戏的核心看点。第 8 层 Boss 后解锁。',
  },
  strategist: {
    name: 'Strategist',
    role: '信息 · 扫描阶段',
    order: 4,
    summary: '综合收益、风险、Gas 成本，推荐最优出牌组合，并提示敌方可能的策略。',
    withoutIt: '没有它，最优组合要你自己判断。',
    howToUse: '解锁后会高亮推荐牌。面对 Phantom 系对手时会调整 NFT 类机会的推荐权重。第 13 层 Boss 后解锁。',
  },
}

export const BOT_GUIDE = {
  'Bot-404': {
    name: 'Bot-404',
    layers: '第 1-3 层',
    order: 1,
    threat: '极低（基础抢夺率约 5%）',
    style: '新手陪练。几乎抢不走你的机会，放心练手。',
  },
  Shadow: {
    name: 'Shadow',
    layers: '第 4-7 层',
    order: 2,
    threat: '低（基础抢夺率约 15%）',
    style: '潜伏在新币发射台，偏好高风险的新币机会。',
  },
  Phantom: {
    name: 'Phantom',
    layers: '第 8-12 层',
    order: 3,
    threat: '中（基础抢夺率约 35%）',
    style: '盯紧 NFT 市场，会和你抢同一笔 NFT 抢购。Executor 的修复能力从这里开始变得关键。',
  },
  'Phantom+': {
    name: 'Phantom+',
    layers: '第 13-17 层',
    order: 4,
    threat: '高（基础抢夺率约 50%）',
    style: 'Phantom 的强化版，多场景施压，一半机会会被它抢走。',
  },
  Genesis: {
    name: 'Genesis',
    layers: '第 18-20 层',
    order: 5,
    threat: '极高（基础抢夺率约 65%）',
    style: '会“学习”你的套路：如果你连续两轮用相同开局，它下一轮会针对性提高 20% 抢夺率。要主动变招、反预判。',
  },
}
