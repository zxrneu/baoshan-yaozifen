/**
 * AI 动作模型：判别联合（接口隔离——每种动作只携带自己需要的字段），
 * 以及可插拔的玩家代理抽象（依赖倒置——编排层只依赖 PlayerAgent，
 * 启发式 / 搜牌 / 人类输入都是它的实现）。
 */
import type { AiAction, DecisionContext } from '@yaozifen/protocol/session';
export type { AiAction, DecisionContext } from '@yaozifen/protocol/session';
import { GameState } from '@yaozifen/game-core';

/** 一个座位上的决策者：根据局面给出下一步动作；无事可做返回 null */
export interface PlayerAgent {
  nextAction(state: GameState): AiAction | null;
}

/** 异步能力为独立扩展，原有同步 Agent 仍然满足调用契约。 */
export interface AsyncPlayerAgent extends PlayerAgent {
  nextActionAsync(state: GameState, signal?: AbortSignal, context?: DecisionContext): Promise<AiAction | null>;
}

export function isAsyncPlayerAgent(agent: PlayerAgent): agent is AsyncPlayerAgent {
  return 'nextActionAsync' in agent && typeof agent.nextActionAsync === 'function';
}
