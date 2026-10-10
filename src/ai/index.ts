/**
 * AI 公开门面。
 * - AiAction / PlayerAgent：可插拔的决策抽象（新 AI = 新实现，无需改编排层）。
 * - applyAiAction：把动作提交给引擎（与人工入口共用校验）。
 */
import {
  GameState, currentSeat, bid as bidAction, bury as buryAction,
  declareTrump as declareTrumpAction, playCard as playCardAction,
} from '../engine';
import { AiAction } from './types';
import { heuristicAgent } from './heuristic';

export * from './types';
export * from './heuristic';

/** 执行 AI 动作，返回新状态（与人工入口共用引擎校验） */
export function applyAiAction(state: GameState, action: AiAction): GameState {
  switch (action.kind) {
    case 'bid':
      return bidAction(state, action.seat, action.bid);
    case 'trump':
      return declareTrumpAction(state, action.seat, action.trump);
    case 'bury':
      return buryAction(state, action.seat, action.cards);
    case 'play':
      return playCardAction(state, action.seat, action.card);
  }
}

/** 生成默认启发式 AI 的下一步动作（旧接口，供脚本/测试直接驱动） */
export function aiNextAction(state: GameState): AiAction | null {
  return heuristicAgent.nextAction(state);
}

// re-export 供 UI 使用
export { currentSeat };
