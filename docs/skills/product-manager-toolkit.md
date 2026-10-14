# 项目产品经理 skill

安装日期：2026-10-14。本机入口：`.agents/skills/product-manager-toolkit/SKILL.md`。技能作为本地开发工具安装，目录不纳入 Git；新检出需按下方固定版本另行安装。本轮已读取并用于[游戏产品设计](../design/game-product-design.md)。

## 来源与版本

| 项目 | 内容 |
| --- | --- |
| 上游 | [alirezarezvani/claude-skills](https://github.com/alirezarezvani/claude-skills) |
| 固定提交 | `19392f7a08264ed00486a251f5b2098321771f94` |
| 上游路径 | `product-team/skills/product-manager-toolkit` |
| 原始入口 | [固定版本 SKILL.md](https://github.com/alirezarezvani/claude-skills/blob/19392f7a08264ed00486a251f5b2098321771f94/product-team/skills/product-manager-toolkit/SKILL.md) |
| 本地位置 | `.agents/skills/product-manager-toolkit/` |
| 许可 | MIT；本机安装包保留 `LICENSE` 与原版权声明 |
| 安装方式 | Codex 内置 `skill-installer` 的 GitHub 安装脚本，指定提交和项目目标目录 |

安装保留 `SKILL.md`、`references/`、`assets/`、`scripts/`，另附上游同版本的 `LICENSE`。不把上游整个插件或其他技能带入项目。

新环境的具体恢复命令与其他技能清单见[开发技能清单](README.md)。

## 本项目使用方式

例如：“使用 product-manager-toolkit，为保山幺子分的新手练习设计用户任务、PRD 和验收标准。”

先读项目 `AGENTS.md`、README、对应代码与已有规划，再使用 skill：

| 能力 | 本次采用 |
| --- | --- |
| PRD | 标准 PRD 的问题、用户、方案、范围、指标、风险与交付门槛，适配为游戏产品设计 |
| JTBD 用户任务 | 分别描述新手、熟练玩家、观战 / 复盘者、Debug 用户要完成的任务 |
| MoSCoW 优先级 | 按核心任务、已有能力、依赖与用户明确要求分为必须 / 应当 / 可选 / 后置 |
| 假设验证 | 把体验判断与代码事实分开；新手表现和重复游玩意愿通过任务观察验证 |
| RICE 工具 | 已安装，待真实覆盖人数、影响、置信度与工程量齐备后再评分；本次没有虚构输入运行排行 |
| 访谈分析工具 | 已安装，待真实访谈资料齐备后使用；本次没有虚构访谈、引用或市场数据 |

UI 细节沿用 [UI 与交互方案](../design/game-ui-interaction-design.md)，游戏规则以 `src/engine/` 为准。skill 的通用排期和团队规模是模板示例，本项目排期按依赖与验收确定。对外发送、发布和商业化不属于本次设计动作。

## 更新约定

升级时核对上游差异、许可证与脚本，再更新固定提交和本说明。项目设计稿按仓库文档迭代；不要把本项目规则直接改写进上游原版 skill，以免升级时混淆来源。
