# Agent Rush

> **指挥一支 AI Agent 战队，在区块链 mempool 中抢套利、防夹击的 MEV 模拟策略卡牌游戏。**
> 浏览器打开即玩 · 无需钱包/合约/后端 · Executor Agent 由 GLM 实时驱动

**Hackathon Track**: Web3 × Long-Horizon Task (GLM-5.1)
**Genre**: Roguelike 策略卡牌 / MEV 模拟器
**Tech**: 纯前端（HTML + CSS + 原生 ES Module JavaScript），零构建、静态部署

---

## Project Overview（项目概览）

Agent Rush 把区块链 MEV（最大可提取价值）的真实博弈，抽象成一局可玩、可见的策略卡牌游戏。

玩家扮演一个 MEV 团队的指挥者，每一关（共 20 关）面对一批从 mempool 扫描出的"机会牌"——套利、三明治夹击、NFT 抢购、抢跑、清算。你要在有限的 **Gas 预算**和 **时间窗口**内，选牌、配队、下注，并与越来越强的敌方 Bot 抢夺同一笔机会。

游戏的核心不是卡牌本身，而是你解锁 **Executor Agent** 之后看到的东西：一个由大语言模型驱动的自主智能体，把"执行这几张牌"这个高层目标，实时拆解成子任务、多步规划、调用工具、遇到对手抢占时迭代修复——**整个 Long-Horizon 工作流在 Thought Chain 面板里逐字可见**。

---

## Problem（问题）

Long-Horizon Agent（长程任务智能体）是当前 AI 最重要的能力前沿之一，但它有一个展示困境：

- **过程不可见**：Agent 的价值在于"如何一步步把复杂目标做完"，但大多数 Agent 应用只给用户看最终结果，中间的任务分解、规划、工具调用、错误修复全藏在黑盒里。
- **难以感知能力边界**：用户很难直观判断一个 Agent 到底"聪明在哪"——是真的在规划，还是只是单步问答。
- **缺乏对抗与压力场景**：真实世界的 Long-Horizon 任务往往发生在动态、对抗、资源受限的环境中，而多数 Demo 是静态的、无压力的。

MEV 恰好是一个**天然的 Long-Horizon 对抗场景**：资源有限（Gas）、时间紧迫（区块/窗口）、强对抗（其他 searcher bot 抢同一笔利润）、需要实时重规划（目标被抢就得换策略）。Agent Rush 用游戏的形式，把 Agent 的全过程"摊开"给人看。

---

## Why AI（为什么用 AI）

全游戏只有一个地方用 LLM——**Executor 的执行循环**——这是刻意的设计：把 LLM 用在它真正不可替代的地方。**Executor 是固定主角，从第 1 层起就在执行阶段驱动，不需解锁、不占阵容名额。**

其余的信息处理能力（扫描发牌、识破骗局牌、推荐出牌组合）都是规则引擎即可胜任的，它们并入**起始角色**体系，作为透明的规则型 buff（开局三选一：侦察 / 抗压 / 效率），公开告知玩家——LLM 只集中在 Executor 一处，其余诚实标注为规则。

| 部分 | 阶段 | 职责 | 实现 |
|------|------|------|------|
| **起始角色 buff**（侦察 / 抗压 / 效率） | 扫描 / 决策 | 发牌数量、识破骗局、抗抢占、Gas 效率、推荐高亮 | 规则引擎（透明系数） |
| **对手 Bot**（Bot-404 → Genesis） | 全程 | 抢占机会牌，部分会学习玩家套路 | 规则引擎 |
| **Executor** | 执行 | **动态执行、自动调度 Gas、失败恢复、跨目标重规划** | **真实 GLM 调用** |

Executor 体现的正是 Long-Horizon 能力，对应游戏里**真实的 GLM 调用点**，并由 JSON Schema 严格约束输出：

1. **任务分解 / 初始规划**— 把"执行 N 张牌"拆解、排序、分配 Gas
2. **工具调用**— `fetch_prices` / `broadcast_tx` / `replace_tx` / `monitor_mempool` 等
3. **迭代修复 / 重规划**— 被对手抢占、交易失败、Gas 不足或玩家临场改令时，拿当前真实战况回头让 LLM 重新规划剩余步骤
4. **工作流闭环 / 交付**— 用人话复盘本轮、生成结算报告与决策高亮

> 评审能在一局内**亲眼指认至少 3 处** Long-Horizon 特征——这是本项目的核心卖点。

---

## Why Web3（为什么用 Web3）

MEV 不是为了蹭 Web3 概念而硬套的主题，而是 Long-Horizon Agent 的**理想试炼场**：

- **资源约束真实**：Gas 预算有限，每个决策都有机会成本——逼出"规划"而非"贪心"。
- **时间压力真实**：mempool 机会只在有限秒数内有效，区块竞争是零和的——逼出"优先级排序"。
- **对抗性真实**：敌方 Bot（Bot-404 → Shadow → Phantom → Phantom+ → Genesis，胜率逐级从 5% 升到 65%）会抢同一笔利润——逼出"迭代修复"和"实时重规划"。
- **可模拟、零门槛**：MEV 的博弈逻辑可以用纯前端完整模拟，**不需要真实上链、不需要钱包或合约**，浏览器打开即玩。这让 Demo 既保留了 Web3 的对抗内核，又把体验门槛降到零。

最高层的对手 **Genesis** 还带一个轻量"学习"机制（规则引擎实现）：它会记录你最近两轮的开局，若发现固定套路，下一轮针对性提升 20% 抢夺胜率——制造"预判 vs 反预判"的博弈层次。

---

## How It Works（运行机制）

### 三阶段回合循环

每一关是一个 `scan → play → execute → settle` 的循环：

```
扫描 (Scan)          决策 (Play)           执行 (Execute)          结算 (Settle)
系统发机会牌       →  选牌 + 配 Gas      →  Executor 半闭环执行    →  损益结算 + 进度推进
角色 buff 影响        + 定遇袭预案           （Thought Chain 流式展示）
发牌/识破骗局         时间窗口内决策          意外时拿真实战况重规划
```

### 执行：Executor 半闭环

执行阶段始终由 Executor 驱动（无"刚体/自适应"二分——Executor 从第 1 层起固定在场）。它走**半闭环的"观察–思考–行动"循环**：顺利时按既定计划逐张推进、不打扰 LLM；只有在**意外发生时**（被对手抢占 / 交易失败 / Gas 不足 / 玩家一次性临场改令）才拿当前真实战况回头让 LLM 重新规划剩余步骤。这正是长程、自主、迭代修复的体现，也是最值得展示的高光。

### 20 关进程

| 层段    | 对手 Bot      | 场景       | 关键节点                          |
| ----- | ----------- | -------- | ----------------------------- |
| 1-3   | 无 / Bot-404 | DEX 套利   | 教程：零门槛上手，Executor 即在场         |
| 4     | Bot-404     | DEX 套利   | **Boss**，强化角色能力档位             |
| 5-7   | Shadow      | +新币发射台   | 引入场景选择                        |
| 8     | Phantom     | NFT 市场   | **Boss**，引入互斥牌 / 强化角色         |
| 9-12  | Phantom     | NFT / 借贷 | Long-Horizon 完整展示             |
| 13    | Phantom+    | 借贷清算     | **Boss**，强化角色 / 扩容 Gas 池      |
| 14-17 | Phantom+    | 多场景      | 困难，对手深度反制                     |
| 18-20 | Genesis     | 全场景      | Genesis 学习机制，预判博弈             |

> Boss 层奖励为**强化当前起始角色的能力档位**（或扩容 Gas 池等），取代旧版"逐层解锁新 Agent"。具体奖励内容为待平衡调整项。

### 鲁棒性：5 秒超时自动降级

真实 GLM 调用通过 `AbortController` 实现 5 秒超时。**任何一次调用超时、网络失败、或返回不符合 Schema 的 JSON，都会自动降级到本地保底策略（fallback），游戏绝不卡死**。若环境未配置 API Key，整个系统自动切换到 Mock 模式，主流程依然完整可玩——这是 Demo 的安全垫。

### 真实流式输出

GLM 的 SSE 流式响应被边收边解析：一个有状态的字段提取器从 JSON 碎片中实时抽取 `reasoning`（结算为 `summary`）字段的文本增量，逐字推送到 Thought Chain 面板——玩家看到的是 AI **实时思考的逐字过程**，而非结果一次性弹出。

---

## Demo（演示脚本）

完整 Demo 约 7 分钟，三幕结构（通过 `?debug=1` 调试面板可一键跳层）：

- **第一幕（2 min）· 层 1-3**：展示零门槛上手——看牌、选牌、出牌、看结算。Executor 从第一关起即在执行阶段驱动。
- **第二幕（3 min）· 层 10**：核心展示。Executor 半闭环执行，Thought Chain 流式显示 AI 推理；预设 Phantom 抢占目标，触发 **IncidentResponse 迭代修复**路径；结算面板高亮决策时刻。
- **第三幕（2 min）· 层 18**：Genesis 学习机制，展示"预判 vs 玩家反预判"的博弈。

**调试面板**（`?debug=1`）提供：跳到层 10 / 层 18、强制触发 Phantom 抢占、注入骗局牌——保证 Demo 关键事件每次都能稳定复现。

### 本地运行

```bash
# 1. 配置 GLM API Key（可选——不配则自动用 Mock 模式）
cp config/env.js.example config/env.js
# 编辑 config/env.js，填入：window.GLM_API_KEY = 'your-key-here'

# 2. 起一个静态服务器（任选其一）
python -m http.server 8000
# 或   npx serve .

# 3. 浏览器打开
#    http://localhost:8000            正常游戏
#    http://localhost:8000/?debug=1   带调试面板（Demo 用）
```

> `config/env.js` 已加入 `.gitignore`，API Key 不会进版本库。

---

## Validation（验证）

项目按阶段开发，每个阶段经过架构师审核后才合并到 main。已验证的关键点：

- **接口一致性**：Mock 与真实 GLM 实现接口完全一致，调用方无需感知真实/模拟差异；由是否存在 API Key 自动切换。
- **Schema 校验**：Executor 的各调用点输入/输出均由 JSON Schema（ajv）约束，故意传入缺字段的 JSON 会触发 fallback 而非崩溃。
- **流式提取器**：字段值提取器经隔离单测——中文、转义引号、换行、Unicode、反斜杠、空值、末尾字段、summary 共 8 类场景，各 300 次随机碎片切分全部正确还原，且不泄漏 JSON 结构字符。
- **降级路径**：断网 / 超时 / Schema 失败三种情况均验证可正确降级，游戏继续运行，玩家可见中文降级提示。
- **20 关进程**：Boss 层（4/8/13）的角色能力档位强化、场景选择、Genesis 学习（连续两轮同场景同开局 → 第三轮胜率 +20%）逻辑均经核对。

> 完整的开发阶段计划与各阶段验收清单见 `docs/DevPlan_v6.md`，游戏设计细节见 `docs/GDD_AgentRush_v6_Main.md`。

---

## Risks（风险与权衡）

诚实记录已知的风险和有意识的取舍：

| 风险 / 取舍                 | 说明                                     | 缓解措施                                                |
| ----------------------- | -------------------------------------- | --------------------------------------------------- |
| 现场 GLM 超时 / 限流          | Demo 依赖外部 API，可能不稳定                    | 5s 超时自动降级 + 关键路径预热缓存 + 纯 Mock 安全垫（主流程在无 Key 时仍完整可演） |
| AI 返回非预期结构              | LLM 输出不总是合法 JSON                       | ajv Schema 校验，失败即 fallback                          |
| Genesis"学习"是规则引擎而非真 ML  | 真实 ML 成本过高，不适合纯前端                      | 规则引擎行为等效，足以制造"预判"博弈层次                               |
| 流式已吐字但 Schema 校验失败的边缘情况 | 极少数情况下 UI 显示的真实文本与实际生效的 fallback 计划不一致 | 概率极低且游戏正常继续；已记录，非阻断                                 |
| 场景从设计的 8 个压缩到 4 个       | 开发窗口有限                                 | 4 个场景（DEX套利 / 新币 / NFT / 借贷）已完整覆盖 Demo 脚本           |
| 玩家暂停介入（NLP 指令）未实现       | PlayerIntervention 调用点已定义但未接通真实交互      | 不影响 Long-Horizon 5 要素展示；预留接口待后续实现                   |
| 纯前端、无后端                 | 无服务端存档与排行                              | 用 localStorage 本地持久化；零门槛与零成本部署是更高优先级                |

---

*本项目为 Hackathon 参赛作品。设计文档、阶段计划与提交准备材料见 `docs/` 目录。*

## Development Test Harness

The browser game remains a zero-runtime-dependency static app: opening `index.html`
or serving the directory does not require `npm install`.

`package.json` is development-only. It exists for Node-based tests and future
headless simulation scripts under `test/` and `sim/`. All npm packages, if any
are added later, must stay in `devDependencies`.

```bash
npm test
npm run sim
```
