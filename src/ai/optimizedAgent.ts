/** Agent 适配器：阶段分派与动作包装；出牌算法通过接口注入。 */
import { currentSeat, GameState } from '../engine';
import { smartAgent } from './smart';
import { AiAction, AsyncPlayerAgent, PlayerAgent } from './types';
import {
  AsyncCardSelector, CardSelector, createOptimizedSelector, observePlayer, OptimizedSelectorOptions,
} from './optimized';

export interface OptimizedAgentOptions extends OptimizedSelectorOptions {
  selector?: CardSelector;
  nonPlayingAgent?: PlayerAgent;
}

export function createOptimizedAgent(options: OptimizedAgentOptions = {}): PlayerAgent {
  const selector = options.selector ?? createOptimizedSelector(options);
  const nonPlaying = options.nonPlayingAgent ?? smartAgent;
  return {
    nextAction(state: GameState): AiAction | null {
      if (state.phase !== 'playing') return nonPlaying.nextAction(state);
      const seat = currentSeat(state);
      return { kind: 'play', seat, card: selector.choose(observePlayer(state, seat)).card };
    },
  };
}

export function createAsyncOptimizedAgent(
  asynchronous: AsyncCardSelector, options: OptimizedAgentOptions = {},
): AsyncPlayerAgent {
  const synchronous = createOptimizedAgent(options);
  return {
    ...synchronous,
    async nextActionAsync(state, signal) {
      if (signal?.aborted) throw new DOMException('已取消搜索', 'AbortError');
      if (state.phase !== 'playing') return synchronous.nextAction(state);
      const seat = currentSeat(state);
      const decision = await asynchronous.choose(observePlayer(state, seat), signal);
      return { kind: 'play', seat, card: decision.card };
    },
  };
}

export const optimizedAgent: PlayerAgent = createOptimizedAgent();
