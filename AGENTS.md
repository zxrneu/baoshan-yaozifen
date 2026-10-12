# AGENTS.md

保山幺子分：四人搭档吃分纸牌游戏。开发说明见 [README.md](README.md)；技术栈、版本和检查项以 `package.json`、`tsconfig.json`、CI 为准。

## 开发与验证

```bash
pnpm dev      # Vite + 内置 /api 中间件
pnpm test     # tests/**/*.test.ts
pnpm build    # 类型检查 + 生产构建
```

- 完成任何改动前必须跑通 `pnpm test` 与 `pnpm build`；`experiments/` 使用独立配置，不在常规测试内。
- 改动 `src-tauri/` 时另跑 `cargo check --locked --manifest-path src-tauri/Cargo.toml`。
- 测试放 `tests/`，命名为 `*.test.ts`，描述用中文。修 bug 先写复现测试；规则边界与信息隔离必须覆盖。
- 降级测试须显式构造请求失败（如 mock 或注入失败的 fetch），避免依赖默认端口的服务状态。
- 替换引擎须通过[统一评测](docs/ai-engine-model-evaluation-plan.md)；牌力结论须有评测证据。

## 架构与信息隔离

- `src/engine/` 保持纯函数，不依赖 UI、AI 或网络。
- 决策引擎与 RPC 使用阶段观察对象，不接收完整牌局状态。
- AI 只使用本阶段合法可见信息：自己的手牌、已知底牌、公开牌、出牌历史和公共状态；不得读取其他座位暗牌、未知底牌或发牌 seed。
- 叫到 100 分时，**成功扣底后**庄家搭档的剩余手牌公开；AI 观察必须包含并持续同步这些明牌。叫分、定主、扣底阶段仍禁止读取搭档暗牌。
- 修改 AI、观察投影或采样逻辑时，须留回归测试验证信息隔离。
- 遵循 SOLID；文件头用中文简述模块职责及采用的原则。

## 规则边界

完整规则见 `src/engine/` 与 README；以下为基础规则的不变量：

- 座位 `0..3` = 东/南/西/北；`seat % 2` 为所属方（0=东西，1=南北）。
- A/10 各 10 分、5 为 5 分，全副 100 分；分牌不能扣底。
- 叫分为 `B` 时，庄家锁定线为 `B`，闲家为 **`105 - B`**（分值恒为 5 的倍数）；不要改成 `101 - B`。
- 已吃分 + 未打出分 + 底牌分 = 100。

## 代码约定

- 注释与 UI 文案用中文；提交信息用 Conventional Commits。
- 避免 `as any`，优先类型收窄或集中适配；新增依赖须说明必要性。
- 密钥与公网服务地址通过 `.env` 配置，参考 `.env.example`。

规划见 [TODO.md](TODO.md) 与[开发路线](docs/development-roadmap.md)，架构细节见[决策引擎文档](docs/decision-engines-and-rl.md)。文档按需阅读，事实以代码与实跑为准。
