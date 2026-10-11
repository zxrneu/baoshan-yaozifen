/**
 * AI 公开门面。
 * - AiAction / PlayerAgent：可插拔的决策抽象（新 AI = 新实现，无需改编排层）。
 * - applyAiAction：把动作提交给引擎（与人工入口共用校验）。
 */
import {
  GameState, currentSeat,
} from '../engine';
import { AiAction } from './types';
import { heuristicAgent } from './heuristic';

export * from './types';
export * from './heuristic';
export * from './evaluation';
export * from './sampling';
export * from './rollout';
export * from './search';
export * from './smart';
export * from './optimized';
export * from './optimizedAgent';
export * from './browserAgent';
export * from './tactics';
export * from './engines';

export { applyAiAction } from './applyAction';

/** 生成默认启发式 AI 的下一步动作（旧接口，供脚本/测试直接驱动） */
export function aiNextAction(state: GameState): AiAction | null {
  return heuristicAgent.nextAction(state);
}

// re-export 供 UI 使用
export { currentSeat };
