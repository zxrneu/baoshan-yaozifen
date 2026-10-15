import { GameState, bid as bidAction, bury as buryAction, declareTrump as declareTrumpAction, playCard as playCardAction } from '@yaozifen/game-core';
import { AiAction } from './types';

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
