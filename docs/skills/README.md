# 开发技能清单与安装

更新日期：2026-10-14。这份清单记录已用于本项目的技能，方便新开发者按任务安装。源码开发、`pnpm test` 和 `pnpm build` 不依赖这些工具；本机安装目录 `.agents/skills/` 已被 Git 忽略。

## 按任务选择

| 技能 | 使用时机 |
| --- | --- |
| product-manager-toolkit | 产品需求与优先级 |
| ui-ux-pro-max | 界面、布局、触屏与可访问性 |
| systematic-debugging | 复现问题、定位根因 |
| test-driven-development | 功能/行为修改与缺陷修复 |
| verification-before-completion | 交付前执行并核对检查 |
| yaozifen-ai-evaluation | 引擎对照、评测审阅与默认替换证据 |

开发质量三项适用于日常工程工作；产品、UI 和 AI 评测技能按任务使用。普通界面修改不需要触发完整 AI 评测；报告审阅也不自动授权收费模型调用。

## 来源与固定版本

| 技能 | 来源与路径 | 版本依据 |
| --- | --- | --- |
| `product-manager-toolkit` | [alirezarezvani/claude-skills](https://github.com/alirezarezvani/claude-skills)，`product-team/skills/product-manager-toolkit` | 上游提交 `19392f7a08264ed00486a251f5b2098321771f94`，MIT |
| `ui-ux-pro-max` | [nextlevelbuilder/ui-ux-pro-max-skill](https://github.com/nextlevelbuilder/ui-ux-pro-max-skill)，`.claude/skills/ui-ux-pro-max` | 上游提交未记录；本项目提交 `855e15a6c22ebdf225a6b8e47f9a3e0508dce40b` 保存完整安装包及 `LICENSE.txt`，MIT |
| `systematic-debugging` | [obra/superpowers](https://github.com/obra/superpowers)，`skills/systematic-debugging` | 上游提交 `bb92a77741419a4ab5f06e711a283343f1ada0c3`，MIT |
| `test-driven-development` | 同上，`skills/test-driven-development` | 同上 |
| `verification-before-completion` | 同上，`skills/verification-before-completion` | 同上 |
| `yaozifen-ai-evaluation` | 本项目，`docs/skills/yaozifen-ai-evaluation/` | 随项目 Git 提交版本管理；创建工具为 `skill-creator` |

UI 安装包已将检索脚本入口适配为 `.agents/skills/ui-ux-pro-max/`。恢复该历史包可复用当时的内容；它的版本依据是本项目提交，不能当作已核实的上游提交。

## 新环境安装

以下命令均从项目根目录运行，先确认对应目标目录尚不存在。已有技能不要直接覆盖，升级应先审阅差异。第三方工具通常需要 Python 3；网络安装需要访问 GitHub。

### 产品与 UI：恢复项目使用过的安装包

仓库历史保留了完整安装包和许可证，无需重新选择上游版本：

```bash
git archive 855e15a6c22ebdf225a6b8e47f9a3e0508dce40b \
  .agents/skills/product-manager-toolkit \
  .agents/skills/ui-ux-pro-max | tar -x
```

该命令只恢复本机文件，不把技能重新加入 Git。浅克隆若缺少该提交，先使用 `git fetch origin 855e15a6c22ebdf225a6b8e47f9a3e0508dce40b` 获取；普通完整克隆可直接恢复。也可按表中固定上游版本重新安装产品技能。

### 开发质量：安装固定上游版本

在带有内置 `skill-installer` 的 Codex 环境，使用其安装脚本：

```bash
skill_installer="${CODEX_HOME:-$HOME/.codex}/skills/.system/skill-installer/scripts/install-skill-from-github.py"
python3 "$skill_installer" \
  --repo obra/superpowers \
  --ref bb92a77741419a4ab5f06e711a283343f1ada0c3 \
  --path skills/systematic-debugging skills/test-driven-development skills/verification-before-completion \
  --dest .agents/skills
```

安装脚本复制所选技能目录；还需从同一上游提交取得仓库根目录的 `LICENSE`，保存在每个安装目录中。可以直接对 Codex 说：“使用 skill-installer，将 obra/superpowers 提交 bb92a77741419a4ab5f06e711a283343f1ada0c3 的 systematic-debugging、test-driven-development、verification-before-completion 安装到本项目 .agents/skills，并保留同版本 MIT 许可证。”

其他助手或安装脚本路径不同的环境，可下载该固定提交，仅复制表中三个技能目录和许可证。保留各目录中的支持文件，尤其是测试写法和故障追踪参考。上游文中的 `superpowers:<技能名>` 对应本机同名技能。

### AI 评测：从项目源码安装

```bash
mkdir -p .agents/skills
cp -R docs/skills/yaozifen-ai-evaluation .agents/skills/
```

安装后可检查六个技能各自的 `.agents/skills/<名称>/SKILL.md`，以及 AI 评测技能的 `agents/openai.yaml`。Codex 在后续轮次发现安装的技能；其他助手可直接读取对应 `SKILL.md`。

## 调用与维护

例如：“使用 systematic-debugging 定位保存失败后不能继续的问题”“使用 ui-ux-pro-max 审查手机选牌交互”“使用 yaozifen-ai-evaluation 审阅这份报告是否支持替换默认引擎”。UI 检索可从项目根目录运行：

```bash
python3 ".agents/skills/ui-ux-pro-max/scripts/search.py" "touch target selection" --domain ux
```

项目 [AGENTS.md](../../AGENTS.md)、用户要求、代码与实际验证结果优先于技能中的通用建议。升级时记录新固定提交、许可证、必要的本地适配及采用原因；自定义 AI 技能先更新文档目录中的源码，再同步本机安装副本。新增技能时在本清单登记来源、版本、用途和恢复方法。

`skill-installer` 和 `skill-creator` 是安装/创建时使用的辅助技能，不需要为正常游戏开发安装整套插件。浏览器回归使用的是项目 `@playwright/test` 和 [playwright.config.ts](../../playwright.config.ts)，运行方法见[开发指南](../guides/development.md)。
