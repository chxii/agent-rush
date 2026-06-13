# Agent Rush

> **TL;DR (EN)** — Agent Rush turns Ethereum **MEV** into a playable roguelike. You're a *searcher*: pick opportunity cards, split a shared Gas budget, set contingencies — then hand the plan to an **Executor**, an LLM-driven long-horizon agent that decomposes the goal, calls on-chain tools, and **re-plans live when a rival bot front-runs you**. Every step of its reasoning streams token-by-token on screen. The agent runs on **GLM (Z.AI)** with strict JSON-Schema-constrained tool calls and a deterministic local fallback, so the demo never stalls. Pure front-end, browser-only — no wallet, contract, or backend required. **Built for the Z.AI track: the single LLM touchpoint is the agent's plan→tool→repair loop, exactly where long-horizon capability is irreplaceable.**

> **你是一名 MEV 搜索者（searcher）。挑机会、分 Gas、定预案，再派出你的 AI Executor Agent 下场——它真实地规划、调用链上工具、被对手抢占时迭代修复，最终向你交付战果。**
>
> 浏览器打开即玩 · 无需钱包 / 合约 / 后端 · Executor 由 GLM 实时驱动

**Hackathon 赛道**：Z.AI 赛道
**类型**：Roguelike 策略卡牌 / MEV 模拟器
**技术**：纯前端（HTML + CSS + 原生 ES Module JS），零构建、零运行时依赖、静态部署
**AI 引擎**：GLM（Z.AI，`glm-5.1`），SSE 流式 + JSON Schema 约束工具调用
**在线试玩**：[https://agent-rush.vercel.app/](https://agent-rush.vercel.app/)

> 📖 完整设计文档见 [`docs/GDD_AgentRush_v7_Main.md`](docs/GDD_AgentRush_v7_Main.md)。

---

## Project Overview（项目概览）

Agent Rush 把以太坊上真实存在的 **MEV（Maximal Extractable Value，最大可提取价值）** 博弈，抽象成一局可玩、可见的策略卡牌游戏。

你扮演一名 **MEV 搜索者（searcher）**——链上机会的猎手。每一层（共 20 层）面对一手从 mempool 扫出的"机会牌"：套利、夹击、NFT 抢购、抢跑、清算。你要在有限的 **Gas 预算**内选牌、配资源、设预案，并和越来越强的对手 Bot 抢同一笔利润。

但游戏的核心不是卡牌本身，而是你把方案交给 **Executor** 之后看到的东西：一个由大语言模型驱动的自主 Agent，把"执行这几张牌"的高层目标实时拆解成子任务、多步规划、调用工具、被对手抢占时迭代修复——**整个长程工作流在思维链面板里逐字可见**。

这是"你 + 你的 Agent"的一对一关系：**你出脑子，Executor 替你下场**。不是一支团队，是一个真实在读工具返回、临场改主意的 Agent。

---

## Problem（问题）

长程任务智能体（Long-Horizon Agent）是当前 AI 最重要的能力前沿之一，但它有一个展示困境：

- **过程不可见**：Agent 的价值在于"如何一步步把复杂目标做完"，但大多数应用只给用户看最终结果，中间的任务分解、规划、工具调用、错误修复全藏在黑盒里。
- **难以感知能力边界**：用户很难直观判断一个 Agent 到底"聪明在哪"——是真的在规划，还是只是单步问答。
- **缺乏对抗与压力场景**：真实世界的长程任务往往发生在动态、对抗、资源受限的环境里，而多数 Demo 是静态、无压力的。

MEV 恰好是一个**天然的长程对抗场景**：资源有限（Gas）、强对抗（其他 searcher 抢同一笔利润）、需要实时重规划（目标被抢就得换策略）。Agent Rush 用游戏的形式，把 Agent 的全过程"摊开"给人看，同时让没接触过 Web3 的人**玩过即懂 MEV**。

---
## Team（团队）

- **开发者**：Xi Cheng（[@chxii](https://github.com/chxii)）——独立开发，设计 + 实现 + 平衡。

**做这个的缘起**：开发者本人是 Web3 完全新手，两周前才开始接触 mempool、Gas 竞价、MEV 这些基础概念。Agent Rush 是"边学边做"的产物——把刚搞懂的真实链上博弈，做成一个自己能上手玩、也能让别人玩过即懂的东西。这种新手视角反而成了项目的底色：它强迫每个机制都讲清楚"对应现实里的什么"，也是坚持诚实标注简化与边界的原因。

**往后能长成什么**：当前是教学/演示形态，但内核——"人出策略、长程 Agent 在对抗环境里实时执行并交付"——可以往两个方向延伸：一是接入真实只读链上数据（实时 Gas / 区块 / mempool 快照）做"半真实沙盘"；二是把 Executor 的 plan→tool→repair 循环抽出来，作为展示任意长程 Agent 能力的通用可视化外壳。

---


## Why AI（为什么用 AI）

全游戏**只有一个地方用 LLM——Executor 的执行循环**——这是刻意的设计：把 LLM 用在它真正不可替代的地方，其余诚实标注为规则。

| 部分 | 阶段 | 职责 | 实现 |
|------|------|------|------|
| **起始角色 buff**（侦察 / 抗压 / 效率） | 扫描 / 决策 | 发牌数量、抗抢占、Gas 效率 | 规则引擎（透明系数，公开告知玩家） |
| **对手 Bot**（Bot-404 → Genesis） | 全程 | 抢占机会牌 | 规则引擎（按层数 + Boss 加成调强度） |
| **工具模拟器 / 数值结算** | 执行 | 成败判定、盈亏、Gas 扣减 | 确定性模拟器（LLM 绝不编造数值） |
| **Executor** | 执行 | **初始规划、跨目标重规划、失败恢复、人话交付** | **真实 GLM 调用** |

Executor 体现的正是长程能力，对应游戏里真实的 GLM 调用点，并由 JSON Schema 严格约束输出：

1. **任务分解 / 初始规划**——把"执行 N 张牌"拆解、排序（含全部选中牌，只排序不弃牌）。
2. **工具调用**——`fetch_prices` / `monitor_mempool` / `broadcast_tx` / `replace_tx` / `scan_replacement` / `reallocate_gas` / `abandon_card`。
3. **迭代修复 / 重规划**——被抢占、Gas 不足或玩家临场改令时，拿当前真实战况回头让 LLM 重新规划剩余步骤。
4. **闭环交付**——用人话复盘本轮、生成结算报告与决策高亮。

**诚实边界**：Executor 拿到的是展示口径数据（含 `displayedRisk`，**不含真实风险 `trueRisk`**），它和玩家信息对等、一样会被骗局牌骗——识别骗局是玩家的职责，不是甩给 AI。对手 Bot 不接 LLM（规则即可），所有数值由模拟器算。**LLM 决定"做什么"，模拟器决定"结果如何"。**

**为什么是 GLM / Z.AI**：长程任务能力正是 GLM 这代模型的强项——稳定的多步规划、可靠的结构化（JSON）输出、以及流式推理。我们刻意把它放在游戏里**唯一不可替代**的位置（Executor 的执行循环），而不是到处撒 LLM 调味。具体对齐 Z.AI 能力的三点：

- **工具调用（function calling）**：Executor 的七个动作（`fetch_prices` / `monitor_mempool` / `broadcast_tx` / `replace_tx` / `scan_replacement` / `reallocate_gas` / `abandon_card`）由 GLM 选择调用，结果回灌进下一轮观察——这就是 agent loop 的本体。
- **结构化输出**：每个调用点的输入/输出都由 JSON Schema（ajv）严格约束，Schema 不符即降级，保证"AI 决定做什么"始终落进可执行的轨道。
- **流式推理**：GLM 的 SSE 响应被边收边解析，`reasoning` 增量逐字推到思维链面板——玩家看到的是 AI **实时思考的过程**，不是结果一次性弹出。

> 接入只用标准 OpenAI 兼容协议（`https://api.z.ai/.../chat/completions`），线上换任何 endpoint / 模型只改环境变量，无需改前端。

---

## Why Web3（为什么用 Web3）

MEV 不是为蹭 Web3 概念而硬套的主题，而是长程 Agent 的**理想试炼场**：

- **资源约束真实**：Gas 预算有限，几张牌共享一个池、此消彼长——逼出"规划"而非"贪心"。
- **对抗性真实**：对手 Bot（Bot-404 → Shadow → Phantom → Phantom+ → Genesis，基础抢夺强度 0.17 → 0.95 逐级递增）抢同一笔利润——逼出"迭代修复"和"实时重规划"。
- **信息不对称真实**：骗局牌伪装成低风险高收益（显示风险 0.03~0.25，真实 0.82~0.97），考验玩家排雷——对应真实的蜜罐 / 钓鱼陷阱。
- **可模拟、零门槛**：MEV 的博弈逻辑可以用纯前端完整模拟，**不需要真实上链、钱包或合约**，浏览器打开即玩。Demo 既保留 Web3 的对抗内核，又把门槛降到零。

**现实性诚实声明**：游戏建模的是 2019–2021 年经典 MEV（公开 mempool + Gas 公开竞价，即大众心智模型）。当下主流已转向 Flashbots / PBS / 私有订单流，竞价搬进了 builder 的"密封小黑屋"，且失败 bundle 不上链、不烧 gas（与游戏"失败烧 Gas"相反）。我们选用旧模型是**自觉的教学简化**——它最快让人懂 MEV，且可见的对抗才好玩。规则页对此有明确标注。详见 GDD §14。

### Web3 Mechanics Mapping（机制 ↔ 真实链上原语）

下面每条游戏机制都对应一个真实存在的以太坊原语——数值是模拟的，但博弈结构是从真实 MEV 抽象来的。

| 游戏里的东西 | 对应的真实链上原语 | 怎么对应的 |
|------------|------------------|-----------|
| **机会牌从"扫描"里冒出来** | searcher 的两类信息源：**监听 public mempool**（夹击/抢跑）与**轮询链上状态**（套利价差 / 清算线） | 夹击、抢跑盯的是"还没打包的 pending tx"；套利和清算则靠尽快读链上数据算出来——游戏把两者都抽象成"扫描发牌" |
| **套利 `arbitrage`** | **DEX 跨池价差套利**（atomic arbitrage） | 两个 DEX 同一资产价差 → 单笔原子交易买低卖高，理论上无风险；牌的 `slippageEstimate` 对应真实滑点 |
| **夹击 `sandwich`** | **Sandwich attack** | 本身就是 **front-run + back-run 的组合**：在受害大单前买、后卖赚价差。强依赖 mempool 暴露（代码里 `mempool: 1.25` 最敏感），且**非原子**——比套利更易失手 |
| **抢跑 `front_run`** | **Front-running**（generalized frontrunner） | 监听 mempool 发现一笔有利可图的 pending tx，用**更高 gas 抢在它前面**执行。唯一带 `frontRunBidCheck` 的牌：出价 ≥ 对手则加成、否则罚分 |
| **清算 `liquidation`** | **借贷协议清算**（Aave/Compound 式） | 抵押品健康因子跌破阈值即可被清算、收清算费。唯一带 `hardTimeWindow`（机会有时效）、且利润方差最低（`0.05`）——清算回报相对确定 |
| **NFT 抢购 `nft_snipe`** | **NFT drop 抢 mint / 抢错误低价挂单** | 热门 drop 里抢"第一个 mint"，或 frontrun 别人把错误低价挂单买走。抢占概率倍率最高（`1.65`）——对应 mint gas war 的极端拥堵 |
| **给每张牌分 Gas（共享池）** | **Gas price / priority fee 竞价** | 出价越高越可能被矿工/builder 优先打包；池是共享的 → 此消彼长，逼出"规划而非贪心" |
| **被对手 Bot 抢走** | **Gas-price auction 里被对手 outbid**（经典公开竞价） | `broadcast_tx` 里若对手出价更高就 `stolen`——两个 frontrunner 互相抬价、谁高谁进区块，是经典公开竞价下的失败模式 |
| **反抢 `replace_tx`** | **Replace-by-fee（同 nonce 提高 gas 覆盖原交易）** | 必须 `newGas > oldGas` 才能提交，且要超过对手出价的倍率门槛才压制成功——就是 RBF 的规则 |
| **失败仍烧 Gas** | 经典公开竞价里**失败/被抢的交易照样上链、照样付 gas** | 早期 PGA 的真实痛点（注：现代 Flashbots / 私有订单流下失败 bundle 不上链，见上方诚实声明） |
| **骗局牌（显示低风险，真实高风险）** | **Honeypot / 钓鱼合约**（看着能套利，进去出不来） | `displayedRisk` ≠ `trueRisk`，且 Executor 也只拿到展示口径——识别陷阱是玩家职责，对应真实排雷 |
| **隐藏 GLM key 的薄代理** | 真实 dApp 后端**不把密钥暴露给前端**的安全惯例 | Vercel edge 代理从环境变量注入 key、SSE 透传，前端永远拿不到 |

> **作者注**：我是 Web3 完全新手，这两周才刚开始啃 mempool、Gas 竞价、MEV 这些最基础的概念。学的过程中越读越觉得这种"抢同一笔利润"的博弈本身就很好玩，就想做个东西亲手体会一下抢夺的乐趣——Agent Rush 就是这么来的。所以这张映射表不是事后包装，而是我边学边把"刚搞懂的真实机制"一条条塞进游戏的过程。**数值我做了大量简化。**

---

## How It Works（运行机制）

### 四阶段回合循环

每一层是一个 `扫描 → 决策 → 执行 → 结算` 的循环：

```
扫描 (Scan)          决策 (Play)              执行 (Execute)            结算 (Settle)
系统发机会牌       →  选牌 + 配 Gas + 设预案  →  Executor 半闭环执行     →  损益结算 + 距离线推进
角色 buff 影响发牌    （Gas 池 + 选牌数双约束）   （思维链流式展示）          点"结算"才弹报告
```

**玩家三维决策**：选哪些牌（每层 1→2→3 张随层解锁）；给每张分多少 Gas（共享一个池，此消彼长）；设遇袭预案（硬刚 `fight` / 放弃 `abandon` / 转移 `transfer`）。

### 执行：Executor 半闭环

执行阶段始终由 Executor 驱动（从第 1 层起固定在场，无需解锁）。它走**半闭环的"观察–思考–行动"循环**：顺利时按既定计划逐张推进、不打扰 LLM；只有在**意外发生时**才拿真实战况回头让 LLM 重新规划剩余步骤。触发重规划的事件（每回合上限 4 次）：

- **被对手抢占**（核心高光，可触发反抢 `replace_tx`）
- **Gas 不足**
- **玩家一次性临场干预**

> 交易失败 / 目标失效 / 窗口过期是**已结算的终结失败**，不会重规划那张已败的牌（无可挽回），但会开一个干预窗口让你**重新调度剩余牌和 Gas**。

### 玩家的一次性干预

每回合给玩家**一次**临场改令机会。当干预有意义时弹出 **60 秒倒计时窗口**，可点三个快捷指令（全部硬刚 / 放弃最高风险 / Gas 集中最优），或自然语言打字下令。指令作为高优先级观察注入循环，Executor 读到后重规划剩余动作。越早干预，可调整空间越大。

### 20 层进程

| 层段 | 对手 Bot | 场景 | 关键节点 |
|------|---------|------|----------|
| 1-3 | 无 / Bot-404 | DEX 套利 | 交互式教学：排雷 → 配 Gas/EV → 预案与干预 |
| 4-6 | Shadow | DEX / 新币发射台 | 正式开始，引入场景选择 |
| **7** | Shadow | — | **Boss**，角色升 Lv2 |
| 8-11 | Phantom | NFT 市场 / 借贷 | 长程能力完整展示 |
| **12** | Phantom | — | **Boss**，角色升 Lv3 候选 |
| 13-16 | Phantom+ | 借贷 / 多场景 | 高竞争 |
| **17** | Phantom+ | — | **Boss**，角色满级 Lv3 |
| 18-19 | Genesis | 四场景全开 | 终局最强对手 |
| **20** | Genesis | 四场景全开 | **Boss**，达标即通关 |

> **Boss 层 = 7/12/17/20**，对手强度 +0.07，通关奖励是**强化当前起始角色的档位**（取代旧版"逐层解锁新 Agent"）。

### 输赢条件

- **胜利**：撑到第 20 层 **且** 累计收益 > 8.75 ETH。
- **失败**：连亏 ≥ 2 **且** 累计收益 < −0.5 ETH（双条件同时）。
- **第 20 层未达标判负** + **跳过每层 −0.1 ETH 惩罚**，堵掉"躺平凑数"漏洞。
- 顶部控制台**实时显示距离胜利线 / 失败线还有多远**——解决旧版"不知道怎么赢/输"的缺陷。

### 健壮性：自动降级，绝不卡死

- 真实 GLM 调用有超时保护（请求 20s / 流式读取 15s）。**任何一次超时、网络失败、或返回不符 Schema 的 JSON，都自动降级到本地确定性策略（RuleDecider）**，游戏继续，UI 诚实标注 `[自动保底]`。
- 重规划达上限（4 次）也切保底。相同局面会缓存，不重复调用。
- 若未配置 API Key，整个系统自动切到 Mock 模式（RuleDecider），主流程依然完整可玩——这是 Demo 的安全垫。

### 真实流式输出

GLM 的 SSE 流式响应被边收边解析，从 JSON 碎片中实时抽取 `reasoning` / `summary` 文本增量，逐字推送到思维链面板——玩家看到的是 AI **实时思考的逐字过程**，而非结果一次性弹出。

---

### 本地运行

```bash
# 1. 配置 GLM API Key（可选——不配则自动用 Mock 模式，主流程仍完整可玩）
cp config/env.js.example config/env.js
# 编辑 config/env.js，填入：window.GLM_API_KEY = 'your-key-here'

# 2. 起一个静态服务器（任选其一）
python -m http.server 8000
#  或  npx serve .

# 3. 浏览器打开
#    http://localhost:8000            正常游戏
#    http://localhost:8000/?debug=1   带调试面板（Demo 用）
```

> `config/env.js` 已在 `.gitignore`，API Key 不进版本库。线上版用 Vercel 薄代理（`api/llm.js`）从环境变量注入 key 并 SSE 透传，前端永远拿不到 key。

---

## Validation（验证）

项目按里程碑分阶段开发（A: MVP → B: 角色重构 → C: 平衡/真实性/UI），每阶段经审核后合并 main。已验证的关键点：

- **单元测试全绿**：`npm test`（`node --test`）覆盖 battle-plan、卡牌机制、角色 buff、半闭环执行、玩家干预、Executor JSON 解析、RNG 注入、配置冒烟等 10 个测试文件。
- **批量平衡模拟**：`npm run sim`（`sim/run-batch.js`）跑 headless 全局模拟，四档玩家策略实测通关率落在目标区间——random 8.4%（目标 5-15%）、greedy 34.1%（25-40%）、balanced 64.3%（50-65%）、expert 82.1%（80-92%）；角色通关率差异 6.9pp（目标 ≤10pp）、半闭环触发 3.6 次/局（目标 1-4）。
- **Schema 校验与降级**：Executor 各调用点输入/输出由 JSON Schema（ajv）约束；故意传缺字段的 JSON 触发 fallback 而非崩溃；断网 / 超时 / Schema 失败三种路径均验证可正确降级、游戏继续、玩家可见中文降级提示。
- **真实性审计**：5 种牌型对照真实 MEV 策略逐项核实（C1 审计），机制方向修正后重跑平衡（C2）；时代性简化已诚实标注。
- **九轮实机测试**：真人试玩返工（教学、UI、干预、平衡），结论合并 main，线上版 v1.0.0 上线。

---

## Risks（风险与权衡）

诚实记录已知风险和有意识的取舍：

| 风险 / 取舍          | 说明                                           | 缓解 / 现状                                           |
| ---------------- | -------------------------------------------- | ------------------------------------------------- |
| 现场 GLM 超时 / 限流   | Demo 依赖外部 API                                | 20s/15s 超时自动降级 + 相同局面缓存 + 纯 Mock 安全垫（无 key 仍完整可演） |
| AI 返回非预期结构       | LLM 输出不总是合法 JSON                             | ajv Schema 校验，失败即 fallback，UI 标注保底                |
| 对手"学习"           | 对手学习你的套路，当前未实现（`genesisHistory` 字段保留但无运行时读写） | 列为未来扩展                                            |
| 互斥牌（conflict）    | 设想的中后期复杂度来源，当前无代码，逐张独立结算                     | 列为未来阶段扩展                                          |
| 时代性简化            | "失败烧 Gas"符合早期 PGA、与现代 Flashbots 相反           | 规则页明确标注，靠诚实叙事兜（详见 GDD §14）                        |
| expert 档通关率卡区间下限 | ~82%，接近 80% 下沿                               | 后续叠加难度需重跑 sim 验证                                  |
| 纯前端、无后端          | 无服务端存档与排行                                    | localStorage 本地持久化；零门槛与零成本部署优先                    |

---

## Development Test Harness

浏览器游戏本身零运行时依赖：打开 `index.html` 或起静态服务器都无需 `npm install`。

`package.json` 仅供开发期使用——Node 测试与 headless 模拟脚本。所有 npm 包（如有）须留在 `devDependencies`。

```bash
npm test       # node --test 单元测试
npm run sim    # 批量平衡模拟
```
