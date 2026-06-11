export const RULES_PAGES = [
  {
    title: '🎯 你是谁',
    body: [
      '你是一名链上机会猎人，你只是新手？没关系！你手底下还带着一位伙伴，<strong>Executor</strong>。链上每分每秒都有交易在排队，缝里漏出来的钱，就是你要抢的。',
      '你不用自己敲交易。你干的是拍板的活：挑哪张机会牌、给它配多少 Gas、被对手缠上时是硬刚、收手还是换个目标。',
      '真正下场干活的是 <strong>Executor</strong>——一个 AI Agent 🤖。你给方向，它去调工具、看结果，碰上被抢或你临时改主意，它会当场重新盘算。',
      '<span class="guide-note">名词：<strong>MEV</strong> 后面第 3 页细讲，先记一句——“靠抢交易排序赚的钱”。</span>',
    ],
  },
  {
    title: '⛓️ 先花 30 秒搞懂区块链',
    body: [
      '把区块链想成一本<strong>公开的大账本</strong> 📒。谁想转账、买卖、借钱，都得把请求（一笔“<strong>交易</strong>”）排队交上去，不是说成交就成交。',
      '关键就一条：<strong>谁肯多付手续费（这笔费叫 Gas ⛽），谁就排得更靠前</strong>。账本每隔一小会儿把一批交易打包、盖章，盖完就改不了了。',
      '所以这是一场<strong>排队竞速</strong> 🏁：同一个赚钱机会好几号人都盯着，谁的交易先被打包谁吃到，慢一步就空手。你和对手抢的，就是这个“排队位置”。',
      '<span class="guide-note">名词：<strong>Gas</strong> = 交易手续费，也是你的插队费，付得多排得前。更准确说，真正决定排序的是你愿意多给的那部分小费 priority fee。本游戏里 Gas 是你每层最重要的资源。</span>',
    ],
  },
  {
    title: '🔍 什么是 MEV',
    body: [
      '<strong>MEV</strong> 说白了，就是“从交易排队的先后顺序里抠出来的钱” 💸。这钱不来自资产本身涨跌，而来自谁排前、谁夹中间、谁补价更快。',
      '你在游戏里的身份是 <strong>searcher</strong>（机会搜寻者）：找机会、抢着提交交易、跟别的 searcher 拼手速。所谓“被抢”，不是你的钱被偷了，而是对手比你先把同一个机会吃掉了。',
      '<span class="guide-note">名词：<strong>mempool</strong> = 交易的“公共候车区”。你发出的交易先进 mempool 排队、等着被打包进区块。游戏里 Executor 调 <code>monitor_mempool</code> 干的就是这事。</span>',
    ],
  },
  {
    title: '⚡ 一层怎么玩',
    body: [
      '<span class="guide-note">一层 = 一个回合，分四步走。</span>',
      '<strong>① 扫描</strong> 🔍：系统按当前场景翻出一手机会牌。每张牌面写着它能赚多少、要花多少 Gas、风险多大，还有一个<strong>时间窗口</strong>。',
      '<span class="guide-note">名词：<strong>时间窗口</strong> = 这个机会“还能撑多久”的示意。真实链上机会确实转瞬即逝，这里先作为氛围展示，暂未接入成功率计算。</span>',
      '<strong>② 决策</strong> 🎯：挑出你这回合<strong>要出的牌</strong>，给每张分配 Gas，再给每张设一个<strong>预案</strong>：硬刚 💪、放弃 🏳️、转移 🔀。',
      '<strong>③ 执行</strong> ⚙️：你点“执行”后就交给 Executor。它会按顺序逐张跑牌，调工具、看结果，撞上被抢、Gas 不足、交易回滚时当场重规划。',
      '<strong>④ 结算</strong> 🧾：每张牌给出结果，汇总这回合净收益，更新你的累计收益、Gas、连亏次数和层数。',
    ],
  },
  {
    title: '🃏 五种机会，各有脾气',
    body: [
      '<span class="rule-type type-arbitrage">套利</span>：同一样东西在 A 市场便宜、B 市场贵，你低买高卖赚差价。稳，但谁都看得见，抢的人多，利润很快被磨薄。',
      '<span class="rule-type type-sandwich">夹击</span>：看到有人要大买某币，你抢在他前面先买、等他买完价涨了你再卖。讲究“卡在他一前一后”，最吃交易的相邻排序。',
      '<span class="rule-type type-front-run">抢跑</span>：不玩花的，纯比谁出价高、排得前。给区块构建者的小费（priority fee）够高就成，是正面拼钱的打法。',
      '<span class="rule-type type-liquidation">清算</span>：有人抵押借的钱，抵押物跌破了线，你帮系统把这笔坏账平掉、领一份赏金。机会很抢手，被别人先清掉就没了。',
      '<span class="rule-type type-nft-snipe">NFT 抢购</span>：抢限量的稀缺名额，或者捡别人挂错的低价单。最刺激、回报最飘，也最容易扑空。',
    ],
  },
  {
    title: '🗺️ 猎场：你在哪里打',
    body: [
      '每一层都有一个<strong>场景</strong>，也就是你这层的“猎场”。不同猎场出的机会牌不一样、骗局多少不一样、常驻的对手也不一样。',
      '<span class="rule-type type-arbitrage">DEX 套利场</span>：稳。骗局少、收益平，适合摸清节奏。DEX = 去中心化交易所，链上自动撮合买卖的地方。',
      '<span class="rule-type type-front-run">新币发射台</span>：野。新币刚上线、价格剧烈波动，稀有大牌多，但<strong>骗局也最多</strong>。对手 👻 Shadow 爱在这儿蹲。',
      '<span class="rule-type type-nft-snipe">NFT 市场</span>：均衡。中等骗局、偏稀有，对手 😈 Phantom 的主场。',
      '<span class="rule-type type-liquidation">借贷清算场</span>：高收益。骗局少、稀有牌多，专出清算机会。',
      '<strong>骗局牌</strong> ⚠️：每个猎场都会按一定比例混进假机会（看着诱人、其实是坑）。越野的场骗局率越高。',
      '<span class="guide-note">名词：<strong>稀有度</strong> = 机会牌的成色（普通 / 稀有 / 史诗 / 传说）。越稀有通常收益越高，但也更招抢。</span>',
    ],
  },
  {
    title: '🤖 Executor 和你的干预',
    body: [
      '<strong>Executor</strong> 是一个 AI Agent，从第 1 层就一直跟着你。你定战略，它落地：拆任务、调用链上工具、看结果，被抢或你改令时临场重想。',
      '它干活靠一套<strong>工具（tools）</strong>：<code>fetch_prices</code> 查价 🔎、<code>monitor_mempool</code> 盯池 👀、<code>broadcast_tx</code> 广播 📡、<code>replace_tx</code> 反抢 💪、<code>scan_replacement</code> 找替代 🔀、<code>reallocate_gas</code> 调 Gas ⚖️、<code>abandon_card</code> 放弃 🏳️。',
      '执行途中的三种意外：<strong>被抢</strong>、<strong>Gas 不足</strong>、<strong>交易回滚</strong>。碰上意外，它会结合你的预案和现场情况重规划。',
      '每个回合你有 <strong>一次</strong> 主动插话机会 🗣️：点快捷指令，或者直接打字下令。用不用、什么时候用，你自己定。',
      '<span class="guide-note">真实性小注：本游戏建模的是公开 mempool 里逐笔出价竞争的经典形态。现实里很多 MEV 竞争已转向 PBS、私有订单流、区块构建者拍卖；这里做了简化，方便上手。</span>',
    ],
  },
  {
    title: '🦸 选个角色，定你的打法',
    body: [
      '开局先挑一个<strong>起始角色</strong>，它的 buff <strong>整局生效</strong>，定下你这一路的风格。',
      '🔭 <strong>侦察型</strong>：每轮多发机会牌，随等级递增——Lv1 多发 1 张、Lv2 多发 2 张、Lv3 多发 3 张。',
      '🛡️ <strong>抗压型</strong>：更扛抢，反抢更便宜更容易成。',
      '⚡ <strong>效率型</strong>：每层 Gas Pool 上限更高，家底厚。',
      '角色还能<strong>升级</strong>：每打通一个 <strong>Boss 层</strong>，你的角色就强化一级，最高 3 级。',
      '<span class="guide-note">名词：<strong>Boss 层</strong> = 每个对手段位的最后一关，难度更高、通关给奖励。全程一共 5 个 Boss 层（第 4、8、13、16、20 层），前 3 个把角色升到满级 Lv.3。</span>',
    ],
  },
  {
    title: '🏆 怎么赢，怎么输',
    body: [
      '<strong>赢</strong> 🏆：撑到第 20 层，并且累计收益高过<strong>胜利线</strong>。',
      '<strong>输</strong> 💀：连续亏损踩到阈值，<em>并且</em>累计收益跌破<strong>失败线</strong>——两个条件同时满足才算输。',
      '顶部控制台一直挂着这些数：当前层数、Gas Pool、累计收益、胜利线、失败线。盯着它们，在越来越凶的对手手底下活到终局，就赢了。',
    ],
  },
]

export const AGENT_GUIDE = {
  executor: {
    name: '🤖 Executor',
    role: 'AI 执行官',
    order: 1,
    summary: '你定战略，它负责落地：拆任务、调工具、看结果，被抢或你改令时临场重想。',
    withoutIt: 'Executor 从第 1 层固定在场，不需要解锁。',
    howToUse: '给它合法作战方案，然后在执行中需要改方向时使用每回合一次的干预机会。',
  },
  scout: {
    name: '🔭 侦察型',
    role: '信息流打法',
    order: 2,
    summary: '每轮多发机会牌，随等级递增：Lv1 多 1 张、Lv2 多 2 张、Lv3 多 3 张。',
    withoutIt: '非侦察型角色使用基础发牌数量。',
    howToUse: '适合“先把牌摊开看清楚再下手”的玩家。代价是要评估更多机会。',
  },
  resist: {
    name: '🛡️ 抗压型',
    role: '对抗韧性',
    order: 3,
    summary: '被抢概率降到约 70% / 55% / 45%，反抢出价约 84% / 76% / 68%，成功率 +8% / 13% / 18%。',
    withoutIt: '其他角色使用基础 mempool 抢占和反抢规则。',
    howToUse: '对手越凶越显价值。后期 Bot 抢得狠的时候，它能让你站得更稳。',
  },
  efficiency: {
    name: '⚡ 效率型',
    role: '资源派',
    order: 4,
    summary: '每层 Gas Pool 上限更高：Lv1 +20%、Lv2 +35%、Lv3 +50%。',
    withoutIt: '其他角色使用每层基础 Gas Pool 上限。',
    howToUse: '家底厚 = 能同时推更多机会、给每张牌多投 Gas。',
  },
}

export const BOT_GUIDE = {
  'Bot-404': {
    name: '🐣 Bot-404',
    layers: '第 1-3 层',
    order: 1,
    threat: '极低',
    style: '新手陪练，基本不跟你抢。让你先摸清怎么出牌、怎么分 Gas。',
  },
  Shadow: {
    name: '👻 Shadow',
    layers: '第 4-7 层',
    order: 2,
    threat: '低',
    style: '盯着新币机会（刚上线、价格暴涨暴跌的新代币），偶尔来抢一下。',
  },
  Phantom: {
    name: '😈 Phantom',
    layers: '第 8-12 层',
    order: 3,
    threat: '中',
    style: '盯紧 NFT 市场（买卖数字藏品/头像的链上市场），会实打实跟你抢同一批机会。',
  },
  'Phantom+': {
    name: '💢 Phantom+',
    layers: '第 13-17 层',
    order: 4,
    threat: '高',
    style: 'Phantom 的强化版，在多个场景持续施压，不给你喘气。',
  },
  Genesis: {
    name: '👑 Genesis',
    layers: '第 18-20 层',
    order: 5,
    threat: '极高',
    style: '最终 Boss。出价极凶，反抢要掏更多 Gas，而且永远压不死它。',
  },
}
