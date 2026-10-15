# 本地会话与调试工作台

本文描述当前本地运行机制。包边界见 [Monorepo 说明](../architecture/monorepo.md)，AI 输入见[信息隔离](../architecture/information-isolation.md)。

## 职责与代码

| 入口 | 职责 |
| --- | --- |
| [GameSession](../../packages/match-runtime/src/session.ts) | 暂停、单步、自动推进、合法提交、撤销/重做与过期请求管理 |
| [snapshot.ts](../../packages/match-runtime/src/snapshot.ts) | 本地工作台快照与恢复 |
| [会话契约](../../packages/protocol/src/session.ts) | 动作、游标、提交及决策上下文 |
| [useGame](../../apps/web/src/hooks/useGame.ts) | React 驱动、动画等待、人工操作和诊断编排 |
| [动作展示](../../packages/match-runtime/src/actions.ts) | 提交后的可展示步骤 |

规则函数负责判定和状态转换；会话负责串行应用动作。AI 建议只有经过合法性与游标检查后才变成真实提交。重开、撤销、切换配置或分支后，旧请求不能覆盖新局面。

## 历史与模拟

合法提交由[历史存储](../features/history-storage.md)采集；[复盘](../features/history-replay.md)读取保存动作，不重新调用模型。反事实续打建立独立分支，保留原路径；[配置](../features/engine-profiles.md)按不可变版本冻结，批跑和重启边界见[模拟说明](../features/simulations.md)。

保存失败会暂停自动推进并保留待保存包；重试沿用身份，成功后由玩家明确继续。用户的历史库与评测脚本输出是不同的数据生命周期，清理实验不清理玩家存档。

## 显示与输入

Debug 和观战可展示完整牌局，普通 AI 仍只获得阶段合法观察。100 分搭档明牌仅在成功扣底后公开并随出牌同步。完整快照、暗牌和 seed 用于本地规则、恢复与复盘，不进入普通 AI/RPC。

牌桌、侧栏、弹窗、触屏与键盘遵守[交互规范](../ui/interaction-guidelines.md)。原型只用于交互演示，正式行为由应用和回归测试验证。

## 后续边界

当前 GameSession 是本地会话；多人权威、房主迁移、网络断线恢复、Oracle 与任意局面编辑不能由本地撤销/快照能力推断。多人演进见[熟人 P2P 方案](../planning/multiplayer-and-monorepo.md)，其他候选状态统一见[开发路线](../planning/development-roadmap.md)。
