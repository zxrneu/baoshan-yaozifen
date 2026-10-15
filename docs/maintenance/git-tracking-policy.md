# Git 文件管理约定

仓库保存源码、固定输入、配置模板和当前文档；可重新生成的执行结果默认忽略。返回[文档索引](../README.md)。

| 类别 | 管理方式 |
| --- | --- |
| apps、packages、scripts、tests、实验代码与构建配置 | 跟踪 |
| pnpm-lock.yaml、src-tauri/Cargo.lock | 跟踪，固定依赖版本 |
| data/evaluation、测试夹具、应用资源与仍使用的原型 | 跟踪，属于运行或验证输入 |
| .env.example、engine-profiles.example.json | 跟踪，无密钥模板 |
| docs 与项目技能源码 | 跟踪，只维护当前说明和必要设计 |
| experiments/results、各实验的检查点/请求日志/报告/统计 | 忽略，按需生成与清理 |
| output、coverage、dist、依赖与缓存 | 忽略，按需生成与清理 |
| .env、*.local、engine-profiles.json | 忽略，玩家配置与密钥 |
| data 下除 evaluation 外的文件 | 忽略，玩家历史库、备份与日志 |
| .agents/skills | 本地安装并忽略，来源及恢复见[技能清单](../skills/README.md) |

实验目录只提交可复用代码与必要配置；固定题目归入 `data/evaluation/`，不要把运行报告伪装成测试输入。实验输出规则见 [experiments/.gitignore](../../experiments/.gitignore)。如需长期证据，先明确独立归档位置、必要文件与脱敏要求，避免恢复大批原始日志白名单。

删除过时产物前检查读取方与引用，清理后检查 `git diff --check`、文档链接及仓库要求的测试/构建。删除当前树文件不会减少 Git 历史体积；旧版本按需从 Git 查询，不复制回当前目录。

检查忽略规则可用 `git check-ignore --no-index -v -- <路径>`；已跟踪文件不会因新增忽略规则自动取消跟踪，交付时仍需确认对应删除或移除索引变更。
