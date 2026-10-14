# 开发质量技能接入

日期：2026-10-14。第一批落地真实浏览器回归、故障定位和项目 AI 评测技能；React 性能专项、公开部署治理与原生分发仍按具体任务推进。

完整清单、固定版本与新环境安装见[开发技能清单](README.md)。本页记录开发质量技能的接入与验证范围。

## 技能来源与用法

| 技能 | 项目入口 | 用途 |
| --- | --- | --- |
| systematic-debugging | `.agents/skills/systematic-debugging/SKILL.md` | 复现异常、追踪边界、验证单一根因后修复 |
| test-driven-development | `.agents/skills/test-driven-development/SKILL.md` | 故障定位技能引用的测试先行流程 |
| verification-before-completion | `.agents/skills/verification-before-completion/SKILL.md` | 故障定位技能引用的交付证据检查 |
| yaozifen-ai-evaluation | [可安装源码](yaozifen-ai-evaluation/SKILL.md) | 本项目实验协议、信息隔离、归因和独立换边验收 |

前三项来自 [obra/superpowers](https://github.com/obra/superpowers)，固定提交 `bb92a77741419a4ab5f06e711a283343f1ada0c3`，上游路径分别为 `skills/<技能名>`。通过 Codex 的 skill-installer 安装到项目目录，保留支持文件及同版本 MIT 许可证；不安装整个插件。上游文中的 `superpowers:<技能名>` 对应表中的本地入口。项目 `AGENTS.md` 和用户要求优先，已有纯文档/样式例外继续适用。

AI 评测技能由 skill-creator 创建，链接现有协议，不另复制规则或测试数量。四项项目技能可在下一轮发现；示例：

- “使用 systematic-debugging 定位保存失败后不能继续的问题。”
- “使用 yaozifen-ai-evaluation 审阅这份模拟报告，看是否足以替换默认引擎。”

升级上游技能时先审阅差异与依赖，再更新固定提交和许可证；自定义技能随项目协议同步。

项目技能目录按当前仓库约定作为本机工具忽略，不改变这一约定；换工作区时需重新安装技能。

## 真实浏览器回归

新增 `@playwright/test` 仅作为开发依赖：Vitest/happy-dom 无法验证真实布局、浏览器事件与跨刷新 HTTP 历史闭环。原 Vitest 集合继续由 `pnpm test` 运行，`tests/browser/` 由独立命令和 CI 执行，不通过环境条件跳过用例。

```bash
pnpm exec playwright install chromium
pnpm test:browser
```

Linux CI 使用 `pnpm exec playwright install --with-deps chromium`。配置入口为 [playwright.config.ts](../../playwright.config.ts)，用例为 [history-flow.test.ts](../../tests/browser/history-flow.test.ts)。

- 服务固定绑定 `127.0.0.1:4177`，启用 strictPort，不复用已运行的服务；端口占用时明确失败。
- 每次生成独立临时数据库与离线 Bridge 配置。`browser-test` 模式不读取玩家 `.env`，且禁止 Vite 自动加载环境文件；模型端点覆盖为本机不可用端口，密钥清空。
- 浏览器上下文独立，Debug 初始暂停；通过正式牌桌控件操作，不向产品添加私有测试接口，也不注入完整牌局状态。
- 正常路径覆盖叫分、定主、扣底、真实 HTTP 出牌决策与存档；刷新后从历史只读复盘，再在副起点创建不同叫分的独立分支，核对原节点保留。
- 失败路径用浏览器路由明确返回 503，验证“未保存”、重试使用相同请求身份，以及恢复后可查询；不依赖默认服务端口是否在线。
- 两项用例分别在 1280×720 和 390×844 Chromium 下运行，共四项；手机尺寸沿用产品横屏容器/滚动策略，不代表新竖屏玩法或真实设备认证。
- 无自动重试；失败截图与 trace 保留在 `output/playwright/test-results/`，HTML 报告在 `output/playwright/report/`。查看命令：`pnpm exec playwright show-report output/playwright/report`。CI 失败时上传证据，保留七天。

当前覆盖以 Debug 人工接管与历史闭环为主，不宣称已覆盖整场自动连打、原生 WebView、跨浏览器兼容、服务进程重启、全部模拟批跑或触屏可用性研究。已有组件/HTTP/SQLite 测试继续承担各自边界。

## 测试先行与技能试用

隔离回归先写 [browser-environment.test.ts](../../tests/browser-environment.test.ts)，运行后因 `browser-test` 仍调用 `loadEnv`、可能覆盖临时库及密钥而失败；随后仅调整测试模式环境加载行为并确认通过。新增浏览器用例覆盖现有功能；首次出现的配置参数和按钮定位错误只计为测试接入问题，不冒充产品缺陷的红阶段证据。

新 AI 评测技能以已有 [Prompt 2.0 对照记录](../ai/llm-prompt-optimization.md)试用审阅：同配置公开场景从 22/35 到 26/35，可支持该批场景改善；仅有 none 档单次对照，且没有独立确认集/整副牌对战，不能推出默认 low 档或实战牌力提升，也不足以按牌力替换默认引擎。本次未调用收费模型或重跑历史实验。

交付检查为四项技能的结构校验、`pnpm test`、`pnpm test:browser` 和 `pnpm build`；实际结果以当次执行输出为准。没有修改原生代码，不新增本轮 Cargo 检查要求。
