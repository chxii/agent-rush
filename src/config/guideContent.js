export const RULES_PAGES = [
  {
    title: '🎯 你是谁',
    body: [
      '你是一名链上机会猎人，也是一支 MEV 团队的指挥官。链上每一刻都有交易排队，缝隙里藏着能赚的钱。',
      '你的工作不是亲手敲每一步交易，而是做判断：选哪张机会牌，给多少 Gas，遇到对手时是硬刚、放弃，还是转移目标。',
      'Executor 会拿着你的方案去执行。它会调用工具、观察结果，并在被抢占或你临场改令时重新思考。',
    ],
  },
  {
    title: '⚙️ 30 秒搞懂区块链',
    body: [
      '把区块链想成一本公开的大账本。每个人提交的操作都叫“交易”，交易不会立刻写进账本，而是先排队。',
      '<strong>Gas</strong> 就像手续费和插队费。通常你愿意付得越多，交易越容易被排到前面。',
      '账本会定期打包成一个区块。打包之后基本不能改，所以同一个机会谁先被打包，谁就先吃到。',
      '所以本游戏的核心是一场“排队竞速”：你和对手都盯着同一批机会，比谁判断快、出价准、预案稳。',
    ],
  },
  {
    title: '🔍 什么是 MEV',
    body: [
      'MEV 可以理解为“从链上交易排序里挤出来的钱”。有些机会不是来自资产本身，而是来自谁先排队、谁夹在谁前后、谁更快补价。',
      '你在游戏里扮演 searcher：发现机会，提交交易，和别的 searcher 竞争。被抢占不是钱被偷了，而是对手比你先吃到了同一个机会。',
      '真实性说明：游戏建模的是公开 mempool 里逐笔出价竞争的经典形态。现实里很多竞争已经转向 PBS、私有订单流和区块构建者拍卖；这里做了简化，方便理解。',
    ],
  },
  {
    title: '⚡ 一层怎么玩',
    body: [
      '<strong>扫描</strong>：系统按当前场景翻出一手机会牌。牌面会告诉你收益、Gas、风险和时间窗口。',
      '<strong>决策</strong>：选择要跑的牌，分配 Gas，并给每张牌设置预案：硬刚、放弃或转移。',
      '<strong>执行</strong>：Executor 半闭环执行。它会按顺序跑牌，遇到被抢、Gas 不足、失败或你的干预时重规划。',
      '<strong>结算</strong>：每张牌给出结果，更新收益、Gas、连亏压力和层数进度。',
    ],
  },
  {
    title: '🃏 五种机会牌',
    body: [
      '<span class="rule-type type-arbitrage">套利</span>：同一个东西在两个市场价格不同。你低买高卖，赚差价。它依赖“谁先把差价交易打包”，所以公开后竞争很快把利润吃薄。',
      '<span class="rule-type type-sandwich">夹击</span>：发现一笔大交易会推价格，就抢在它前后各放一笔，吃价格波动。它最依赖区块里的相邻排序。',
      '<span class="rule-type type-front-run">抢跑</span>：看到别人要做一笔有利交易，你付更高 Gas 排到前面。它最直接，就是比出价和速度。',
      '<span class="rule-type type-liquidation">清算</span>：借贷仓位坏掉时，谁先帮系统平仓谁拿奖金。窗口很短，慢一步就被别人清掉。',
      '<span class="rule-type type-nft-snipe">NFT 抢购</span>：抢稀缺 mint 名额或低价错挂单。它更像抢单竞速，波动大，机会也更容易瞬间消失。',
    ],
  },
  {
    title: '🤖 Executor 和你的干预',
    body: [
      'Executor 从第 1 层起固定在场。它是游戏里唯一由 LLM 驱动的部分；当 LLM 不可用时，界面会诚实显示规则保底，不假装是 AI。',
      '每回合你只有一次主动干预机会。快捷指令由规则解析；自然语言会在在线模式下交给 Executor 理解。',
      '预案在决策阶段逐张设置：硬刚会尝试加 Gas 压过对手；放弃会止损当前牌；转移会把资源挪给剩余机会。',
    ],
  },
  {
    title: '🏆 怎么赢或输',
    body: [
      '胜利：打到第 20 层，并且累计收益高于胜利线。',
      '失败：连续亏损达到阈值，同时累计收益低于失败线。',
      '顶部控制台会一直显示层数、Gas 池、累计收益、胜利线和失败线。你要做的是在越来越强的对手压力下活到终局。',
    ],
  },
]

export const AGENT_GUIDE = {
  executor: {
    name: 'Executor',
    role: 'LLM 执行主角',
    order: 1,
    summary: 'Executor 从第 1 层起固定在场。它会拆解作战方案、调用工具，并在异常发生时重规划。',
    withoutIt: 'Executor 不受解锁或上阵限制。每层都默认使用半闭环执行路径。',
    howToUse: '给它一个合法作战方案，然后在执行中需要改方向时使用每回合一次的干预机会。',
  },
  scout: {
    name: '侦察型角色',
    role: '透明规则 buff',
    order: 2,
    summary: '每轮扫描额外机会牌，让你在决策阶段有更多信息。',
    withoutIt: '非侦察型角色使用基础发牌数量。',
    howToUse: '如果你想看到更多选择，并愿意自己评估更多机会牌，开局选择侦察型。',
  },
  resist: {
    name: '抗压型角色',
    role: '透明规则 buff',
    order: 3,
    summary: '降低被抢概率，并让遇到竞争者时的 replace_tx 更便宜或更容易成功。',
    withoutIt: '其他角色使用基础 mempool 抢占和反抢规则。',
    howToUse: '如果你想在 Bot 压力下更稳地执行，开局选择抗压型。',
  },
  efficiency: {
    name: '效率型角色',
    role: '透明规则 buff',
    order: 4,
    summary: '按角色等级提高每层 Gas Pool 上限。',
    withoutIt: '其他角色使用每层基础 Gas Pool 上限。',
    howToUse: '如果你想保留更多预算、同时推进更多机会，开局选择效率型。',
  },
}

export const BOT_GUIDE = {
  'Bot-404': {
    name: 'Bot-404',
    layers: '第 1-3 层',
    order: 1,
    threat: '极低',
    style: '新手陪练。它很少抢走你的目标。',
  },
  Shadow: {
    name: 'Shadow',
    layers: '第 4-7 层',
    order: 2,
    threat: '低',
    style: '偏好新币机会，会带来轻度 mempool 压力。',
  },
  Phantom: {
    name: 'Phantom',
    layers: '第 8-12 层',
    order: 3,
    threat: '中',
    style: '盯紧 NFT 市场，会和你争抢同一批机会。',
  },
  'Phantom+': {
    name: 'Phantom+',
    layers: '第 13-17 层',
    order: 4,
    threat: '高',
    style: 'Phantom 的强化版，会在多场景持续施压。',
  },
  Genesis: {
    name: 'Genesis',
    layers: '第 18-20 层',
    order: 5,
    threat: '极高',
    style: '终局压力对手：出价激进，反抢需要更高 Gas，且无法被完全压制。',
  },
}
