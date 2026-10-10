# 保山幺子分决策引擎架构与算法研究报告

## 1. 架构设计与 SOLID 原则

为支持在牌桌中实时无缝切换不同 AI 决策体系（传统搜索算法、非自回归小模型、大语言模型以及自训强化学习），系统对 AI 决策模块进行了全面重构，严格遵循 SOLID 面向对象设计原则：

- **单一职责原则 (Single Responsibility Principle, SRP)**：
  - `PlayerObservation`：只负责合法已知信息的投影与隔离，绝不泄露暗牌；
  - `tactics.ts` (`isPartnerGuaranteedWinning` / `pruneCandidates`)：只负责搭档稳赢状态评估与无收益牌精简；
  - `WorkerCardSelector` / `PairedCardSelector`：只负责约束采样与配对胜率搜索；
  - `LayaEngine` / `LlmEngine`：只负责各自协议格式的转换与网络通信；
  - `EnginePlayerAgent`：只负责前置单候选直接出牌与模型异常/超时回退到算法；
  - `engineSettings.ts`：只负责引擎配置的结构定义、校验与 localStorage 持久化；
  - `DecisionLogger`：只负责决策日志采集、指标隔离存储与 JSON 导出。
- **开闭原则 (Open-Closed Principle, OCP)**：
  - 核心牌桌 `useGame` 与界面只依赖 `PlayerAgent` 抽象；
  - 新增任何决策引擎（如自训 RL 模型）只需实现统一的 `DecisionEngine` 接口，无需修改牌桌交互、规则引擎或编排逻辑。
- **里氏替换原则 (Liskov Substitution Principle, LSP)**：
  - 所有引擎均保证在给定合法候选牌时，输出合法的出牌决策；任何引擎均可在不破坏对局合法性的前提下随时互相替换。
- **接口隔离原则 (Interface Segregation Principle, ISP)**：
  - 决策引擎只暴露极简的异步 `chooseCard(observation, candidates, signal)` 接口；
  - 搜索胜率（`searchWinRate`）与模型概率（`probabilities`）分别记录，不混用不同语义的指标。
- **依赖倒置原则 (Dependency Inversion Principle, DIP)**：
  - 高层牌桌模块依赖 `DecisionEngine` 抽象接口，具体引擎的组装与生命周期管理统一由 `DecisionEngineManager` 组合根负责。

---

## 2. 核心战术策略改进：搭档保牌与候选精简

### 2.1 问题背景
在实际对局中（例如经典局面：西家领出最大主牌 ♦A、北家跟 ♦J，东家持 ♦K 与 ♦2）：
- 保山幺子分中，分牌只有 **A (10分)**、**10 (10分)**、**5 (5分)**；
- **K、Q、J 均为 0 分牌**；
- 此时西家搭档出 ♦A 已经确定稳赢该轮吃分，东家出 ♦K 既无法额外拿分，又浪费了一张之后可以用作领出权控制的高牌力大牌。

### 2.2 解决方案
1. **搭档稳赢判定 (`isPartnerGuaranteedWinning`)**：
   - **第四手**：当前已有 3 张出牌，自己是最后一家，只要自己不超车搭档必赢；
   - **最大主牌**：搭档出主牌，且场上所有未见牌与已知明牌中没有更大的主牌；
   - **副牌领出**：搭档副牌当前最大，且确认同门未见牌无更大张，同时排除后手对手绝门杀牌的风险。
2. **战术候选精简 (`pruneCandidates`)**：
   - 当搭档确定稳赢时，将同门、零分、不改变赢家的候选牌合并为**点数最小的牌**（保留 ♦2，排除无收益的 ♦K 消耗）；
   - 分牌（A/10/5，可用于安全喂分）和能改变赢家的超车牌继续保留，供深度搜索或收益模型做进一步评估。

---

## 3. 胜负锁定与提前结算机制

- **触发条件**：在基础计分规则（`basicScoring`）下，四家出完入账后实时判定：
  - 庄家方总吃分（出牌吃分＋底牌分）达到叫分 $B$；
  - 闲家方总吃分达到 $105 - B$（此时庄家方理论最多只能拿 $100 - (105 - B) = B - 5$ 分，已无法成局）；
- **结算展示**：
  - 结算弹窗展示“⚡ 提前锁定胜负”金色徽章；
  - 剩余未打出的分牌计入 `unplayedPoints`，并在战报中单独列出；
  - 各玩家剩余手牌完整保留；
  - 分数守恒关系更新为：
    $$\text{庄方吃分} + \text{闲方吃分} + \text{底牌分} + \text{未打出分} = 100$$
- **扩展性**：自定义计分策略（如未来引入的抠底翻倍策略）继续打满 12 轮。

---

## 4. 四类决策引擎对比与参数体系

| 引擎类型 | 技术架构与接口 | 典型延迟 | 特点与优势 | 异常应对 |
|---|---|---|---|---|
| **传统算法** | Web Worker 独立线程，约束采样 + 配对胜率搜索 + 残局精确求解 | ~250 ms | 无需外网或外部进程，纯前端运行，严格数学逻辑保障 | 超出预算自适应回退到保牌基线 |
| **非自回归模型** | TypeSafe `/v1/systemone` 接口适配，默认模型 **`laya:multilingual`**（支持中文） | ~170 - 250 ms | 单步推断极快，`output_tokens: 0`，并行概率打分与选择 | 默认超时 1.5s，失败/非法牌自动回退算法 |
| **大语言模型** | OpenAI 兼容 Chat Completions，适配 vLLM 与 DeepSeek；默认模型 **`qwen38_27b`** | ~1 - 5 s | 具备深厚策略常识，JSON 严格结构化输出；支持思考等级 `reasoning_effort` 调节 | 默认超时 8s，失败/非法牌自动回退算法 |
| **自训强化学习** | *规划中*：PerfectDou / Team-PSRO 架构，ONNX 格式导出接入 | ~10 - 50 ms | 专门针对保山幺子分团队博弈自对弈训练，极高牌力上限 | 由适配器统一防护非法牌与动作掩码 |

### 4.1 大语言模型思考等级 (`reasoning_effort`) 规范
在 OpenAI 规范与 vLLM（如部署的 Qwen / QwQ / DeepSeek 系列推理模型）中，通过 `reasoning_effort` 参数控制内部思维链深度：
- `default`：默认档位，由模型端策略自适应决定，客户端传递标准 `temperature: 0.1`；
- `none`：显式关闭思考链，以最高速度生成结构化选牌；
- `low`：低思考深度，消耗少量 token，在快速响应的同时具备基础战术逻辑；
- `medium`：中等思考深度，在延迟与胜率间保持平衡；
- `high`：高思考深度，进行充分的多步手牌与胜负推演。

> 当设置非 `default` 的思考等级时，请求体会自动省略采样温度参数（`temperature`），避免触发推理模型对显式温度参数的 400 校验限制。

---

## 5. 本地服务部署与运行指南

### 5.1 启动 Ollaya Laya 推理服务（本地）
```bash
# 1. 启动 Ollaya 守护服务（默认监听 127.0.0.1:11435）
~/.local/bin/ollaya serve

# 2. 检查模型状态（确保包含多语言中文模型 laya:multilingual）
~/.local/bin/ollaya list
# 包含 laya:multilingual
```

### 5.2 启动 Node 模型代理服务
```bash
# 开发环境启动代理服务（默认端口 3001）
pnpm proxy

# 支持通过环境变量注入上游与密钥（解决浏览器跨域与鉴权保护）：
LAYA_BASE_URL=http://127.0.0.1:11435 \
LAYA_MODEL=laya:multilingual \
LLM_BASE_URL=http://211.141.18.165:6195/v1/ \
LLM_MODEL=qwen38_27b \
pnpm proxy
```

### 5.3 启动前端界面与设置面板
```bash
# 启动 Vite 开发服务（已配置 /api 反向代理至 3001）
pnpm dev
```

打开浏览器牌桌后：
1. 点击右侧工具栏的 **“AI 引擎 · [当前引擎]”** 按钮打开配置弹窗；
2. 在 **“AI 决策引擎与模型服务配置”** 中：
   - 切换当前生效引擎（传统算法 / 非自回归模型 / 大语言模型）；
   - 自定义配置 vLLM 的 `openai_api_base`（默认 `http://211.141.18.165:6195/v1/`）与 `model_name`（默认 `qwen38_27b`）；
   - 调节 **思考等级 (`reasoning_effort`)**（默认 / 关闭 / 低 / 中 / 高）；
   - 配置 TypeSafe 服务端点与模型名（默认 `laya:multilingual`）；
   - 点击 **“测试 LLM 连通性”** 或 **“测试 TypeSafe 连通性”** 实时诊断握手延迟；
   - 点击 **“💾 保存并应用配置”** 立即持久化至 `localStorage` 并应用到对局中。
