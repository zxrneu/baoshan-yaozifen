/** 历史测试样本（SRP）：通过真实规则动作构造各阶段，不手造结算或得分。 */
import { cardPoints } from '@yaozifen/game-core/cards';
import { bid, bury, createGame, currentSeat, declareTrump, legalMoves, playCard } from '@yaozifen/game-core';
import type { GameState } from '@yaozifen/game-core';

export function historyPlayingState(amount = 70): GameState {
  let state = createGame(731);
  for (let i = 0; i < 4; i++) state = bid(state, currentSeat(state), i === 0 ? amount : null);
  state = declareTrump(state, currentSeat(state), 'S');
  return bury(state, currentSeat(state), state.hands[currentSeat(state)].filter(card => cardPoints(card) === 0).slice(0, 4));
}

export function historyEndingAction() {
  let state = historyPlayingState();
  while (state.phase === 'playing') {
    const before = state;
    const command = { kind: 'play' as const, seat: currentSeat(state), card: legalMoves(state, currentSeat(state))[0] };
    state = playCard(state, command.seat, command.card);
    if (state.result) return { before, command, after: state };
  }
  throw new Error('样本未进入副结算');
}
