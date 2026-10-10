/**
 * AI 动作模型：判别联合（接口隔离——每种动作只携带自己需要的字段），
 * 以及可插拔的玩家代理抽象（依赖倒置——编排层只依赖 PlayerAgent，
 * 启发式 / 搜牌 / 人类输入都是它的实现）。
 */
import { Card, Suit } from '../cards';
import { GameState } from '../engine';

export type AiAction =
  | { kind: 'bid'; seat: number; bid: number | null }
  | { kind: 'trump'; seat: number; trump: Suit }
  | { kind: 'bury'; seat: number; cards: Card[] }
  | { kind: 'play'; seat: number; card: Card };

/** 一个座位上的决策者：根据局面给出下一步动作；无事可做返回 null */
export interface PlayerAgent {
  nextAction(state: GameState): AiAction | null;
}

/** 异步能力为独立扩展，原有同步 Agent 仍然满足调用契约。 */
export interface AsyncPlayerAgent extends PlayerAgent {
  nextActionAsync(state: GameState, signal?: AbortSignal): Promise<AiAction | null>;
}

export function isAsyncPlayerAgent(agent: PlayerAgent): agent is AsyncPlayerAgent {
  return 'nextActionAsync' in agent && typeof agent.nextActionAsync === 'function';
}
