# 待办

> 当前主线：**SQLite 对局历史、复盘、现有引擎的多配置选择与 HTTP 模拟对战**。完整依赖、状态与验收见 [开发路线图 v2.1](docs/development-roadmap.md)；具体存储/配置/回放规格见 [专项设计](docs/game-history-replay-and-engine-profiles.md)，评测方法见 [统一评测方案](docs/ai-engine-model-evaluation-plan.md)。
>
> T0.1–T0.4、T1.1/T1.2、浏览器白屏及后续 PIMC 预算降级修复已完成；详细记录见 [v1 归档](docs/development-roadmap-v1-archive.md)。历史进展中的数量只代表当时验证，当前测试数以实跑为准。

## 当前执行队列

- [ ] **P0.1**：SQLite 驱动、版本化历史协议、Repository 与迁移；同时确定引擎配置快照结构。
- [ ] **P0.2–P0.3**：统一提交自动保存、事务/幂等/恢复、历史列表与查询。
- [ ] **P1.1–P1.2**：从数据库逐步复盘、轮次跳转、当时可见观察与决策关联。
- [ ] **P2.1**：配置文件定义多个 LLM、多个 System One，以及 Bridge/Algorithm 的多组参数，保存不可变版本。
- [ ] **P2.2–P2.3**：HTTP 按 profileId/版本决策，四座独立选择，实际配置与历史一致。
- [ ] **P1.3 + P3**：保留历史分支，按配置做后续/换边模拟，批跑入库并从报告打开副牌复盘。

首批闭环：打牌 → SQLite 保存 → 重启查询 → 原动作复盘。AI 归因/预算配合 HTTP 与模拟交付；牌力改进与 RL 保留为配套研究，UI 大改、联机和正式分发仍后置。

## 决策引擎与实战策略（2026-10-11 进展）

- [x] **P0 · 可复现决策记录与导出。**
  - 新增统一决策记录器 `decisionLogger`，记录对局轮次、出牌座位、可见观察、当前候选、最终选牌、耗时、模型置信度与回退原因。
  - 支持弹窗一键导出 JSON 格式决策数据供离线调试与回归测试。
- [x] **P0 · 搭档协作与保牌精简。**
  - 实现 `isPartnerGuaranteedWinning`（判定第四手、最大主牌、公开缺门与后手杀牌）。
  - 实现 `pruneCandidates`：搭档确定稳赢时，将同门零分非超车候选合并为最小牌（如保留 ♦2，排除无收益的 ♦K 消耗）；分牌与能改变领出权的牌继续保留。
  - 修复截图回归局面：西家 ♦A、北家 ♦J、东家持 ♦K 与 ♦2 时三类引擎最终均出 ♦2。
- [x] **P0 · 胜负锁定提前结算。**
  - 基础规则下，四家出完入账后实时判定：庄方达到叫分 $B$ 或闲方达到 $105 - B$ 立即结束本副；达到目标胜副结束整场。
    - 注：$105 - B$ 为**精确**锁定阈值（分牌分值恒为 5 的倍数，$D > 100 - B \iff D \ge 105 - B$），非保守值；详见 `tests/early-finish-threshold.test.ts`。
  - 手牌完整保留不丢，结算展示“提前锁定胜负”徽章与未打出分；分数守恒公式调整为 `已吃分 + 未打出分 + 底牌分 = 100`。
- [x] **P1 · 三类可切换决策引擎与模型代理。**
  - 统一异步接口 `DecisionEngine` 与适配器 `EnginePlayerAgent`，支持三个自动座位统一切换。
  - 传统算法（Worker / PairedSearch，默认 250ms 预算）。
  - 非自回归模型（Ollaya / Laya，TypeSafe `/v1/systemone` 接口适配，~200ms）。
  - 大语言模型（OpenAI 兼容 Chat Completions / DeepSeek / vLLM，严格 JSON 输出，默认 8s 超时）。
  - 独立 Node 模型代理服务 `server/proxy.ts`（支持 `/api/engines` 健康探测与上游反向代理鉴权）。
- [x] **P0 · 全阶段 Client/Server 决策服务架构与健壮性改造。**
  - 设计符合 SOLID 原则的 Client/Server 架构：前端通过 `RemoteDecisionEngine` 统一向 Node 服务端 `/api/decision` 发起 RPC 决策请求。
  - 彻底规避浏览器直接调用本地模型时的 CORS、Chrome PNA（私有网络访问）以及 `signal is aborted without reason` 异常（`safeAnySignal` 严格保持取消 reason 链）。
  - **全阶段 AI 决策统一覆盖**：叫分 (Bidding)、定主 (Trump)、扣底 (Burying)、出牌 (Playing) 全部纳入 `DecisionEngine` 与 RPC 协议体系，由 LLM / Laya / Bridge / 算法全权负责。
  - **双重优雅降级**：服务端在模型超时/异常时，进程内毫秒级降级为 `BridgeEngine`；客户端在服务端不可用时透明降级为本地 `BridgeEngine`，完全保留纯单机与移动端离线能力。
  - 完善全阶段与 C/S 测试，自动化测试集扩展至 34 个套件、427 项测试（100% 通过）。
- [x] **P1 · 开发与服务流程优化：支持单命令合一 (pnpm dev) 与前后端解耦双终端 (pnpm server + pnpm client)。**
  - 抽取核心路由与请求分发逻辑至轻量 `server/apiHandler.ts`，消除对第三方重型框架及 Node 专属全局对象的强绑定。
  - `pnpm server`（别名 `pnpm proxy`）作为独立决策与模型代理后端服务，自动加载 `.env` 专属 GPU 节点与模型配置。
  - `pnpm client` 作为独立客户端开发服务，通过 Vite 自动反向代理 `/api` 至 `pnpm server`（端口 3001）。
  - `pnpm dev` 保留单命令合一模式，内嵌 Connect 中间件，开发模式零配置开箱即用。
- [x] **P0 · 修复桥牌双明手求解器 (DDS) 置换表算法缺陷与内存优化。**
  - 在置换表键（`ttKey`）中纳入当前双方得分（`@pts[0],pts[1]`），彻底消除同残局在不同吃分历史下错误复用成局判定的问题。
  - 置换表引入 Alpha-Beta 标志位（`EXACT` / `LOWER_BOUND` / `UPPER_BOUND`），保证在不同窗口搜索同一分支时返回正确的上下界剪枝值。
  - 优化哈希键生成逻辑，消除数组 `join(',')` 产生的临时对象与 GC 压力。
- [x] **P0 · 安全治理：消除公网 IP 硬编码与完善环境配置模板。**
  - 清除源码与配置中硬编码的公网 IP `211.141.18.165`，替换为安全标准的默认本地地址（`http://127.0.0.1:8000/v1`）。
  - 全面更新 `.env.example`，补齐代理端口、主机、LLM 与 Laya 完整环境变量说明。
- [x] **P1 · 交互体验优化：透视切换解耦与牌桌方位归正。**
  - 解耦 `useGame.ts` 中透视切换对 AI 轮次 `useEffect` 的触发依赖，杜绝点击“透视”时无意取消中断正在进行的模型思考。
  - 归正牌桌座位与出牌槽位方位（`SEAT_POS = ['right', 'bottom', 'left', 'top']`），符合“上北下南，左西右东”的真实空间认知。
- [x] **P1 · 跨端环境感知：Tauri 单机离线默认直连优化。**
  - 增加 `IS_TAURI_APP` 原生端嗅探，在未显式配置服务端时，桌面/移动单机 App 默认关闭 `useServerDecision`，直接调用本地高性能 `BridgeEngine`，消除离线网络空转。
- [x] **P2 · LLM 扣底真实模型驱动与依赖补齐。**
  - 为 `LlmEngine.chooseBury` 接入真实 LLM 决策与非分牌合法性严格校验，并在返回非法手牌时无缝降级至 `smartBury` 启发式规则。
  - 显式在 `package.json` devDependencies 中补齐 `vite-node` 开发依赖。

---

## 自训强化学习 (Self-Trained RL) 研究候选（M4 后置）

以下是待验证的研究设计，尚未表示已开始训练。进入条件、语料治理、蒸馏与实战门槛以路线图 M4 为准；团队奖励、模型格式和固定局数均须经实验确认。

参考 [PerfectDou](https://arxiv.org/abs/2203.16406) 与 [Team-PSRO](https://proceedings.neurips.cc/paper_files/paper/2023/hash/8e4ccc9ca6ae2225c4cbb7782ab48daf-Abstract-Conference.html)，自训保山幺子分团队强化学习策略：

- [ ] **1. 合法动作掩码 (Action Masking)**
  - 根据保山幺子分跟门规则（同门必跟、缺门垫牌/杀牌），在策略网络 Policy Logits 输出层前施加 $-\infty$ 掩码，杜绝非法出牌行为，避免策略探索浪费在非法动作空间。
- [ ] **2. 团队奖励函数设计 (Team Reward Function)**
  - 终局胜负奖励：赢局 $+1$，输局 $-1$；
  - 待消融的团队吃分密集奖励：搭档双方共享吃分奖励 $R_{trick} = \frac{\text{trickPoints}}{100}$（若敌方吃分则扣除响应分值）；
  - 待消融的叫分成局边际奖励：庄家成局额外奖励 $+0.5$，超分递增；闲家成功防守奖励 $+0.5$；
  - 保牌与喂分内生激励：通过团队累积分数自然演化出搭档稳赢时垫最小牌与安全喂分行为。
- [ ] **3. 自博弈与历史策略池训练 (Self-Play & League Training)**
  - 采用 Team-PSRO / 联赛机制，建立历史策略池（Checkpoints Pool），随机抽取历史版本搭档与对手对战；
  - 消除非传递性博弈下的策略循环与过拟合；
  - 双方换位对局（保证公平性与方差缩减）。
- [ ] **4. 训练与推理信息隔离 (Information Isolation & Asymmetric Actor-Critic)**
  - 推理时（Actor）：只能观测合法已知历史（自身手牌、已打出牌、明牌、出牌历史与公共分值）；
  - 训练时（Critic）：可利用非对称价值网络（Asymmetric Critic）观测全场全局暗牌信息（Oracle），提供低方差的价值基线指导 Actor 更新。
- [ ] **5. 模型导出与引擎接入**
  - 训练完毕后将 Actor Policy 导出为 ONNX / SafeTensors 格式；
  - 实现 `RlEngine` 接入已有的 `DecisionEngine` 接口，无缝替换牌桌自动座位。
- [ ] **6. 统一自动化评测与基准对比**
  - 复用现有统一场景与换边实战入口，和冻结的启发式/搜索/模型基线比较；按独立发牌组、目标效果、区间宽度与预算预先确定确认规模，不以固定 2000 局保证排序；
  - 输出赢副率（Win Rate）、团队净得分（Net Score）、平均出牌耗时（Latency）与动作胜率提升报告。

---

## 历史已完成交互优化

- [x] **不能出的手牌显示优化（2026-10-10）。** 使用不透明的灰色牌面，解决重叠手牌透出下层花色和点数的重影；保留可辨认的红黑花色、分值和主牌标识。仅可选牌悬停时抬起，跟牌和扣底显示禁用原因；等待其他玩家时手牌保持正常显示并停止选择。
- [x] **文字可读性（2026-10-10）。** 放大操作提示、座位状态、比分、工具栏和规则说明，常用界面文字至少 14px，主要提示 18px；放大牌面分值和主牌角标。
- [x] **明牌与玩家座位关联（2026-10-10）。** 明牌放在对应东、西、北家的头像旁边，朝向跟随玩家座位，复用完整扑克牌面，按普通手牌叠放，不再按花色分成格子；根据空间连续换行，避免将明牌另放在牌桌下方而需要翻到下一屏。
