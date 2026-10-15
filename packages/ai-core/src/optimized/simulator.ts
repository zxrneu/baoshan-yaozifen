/** 轻量出牌模拟。比较大小复用引擎，策略只接收投影后的观察。 */
import { Card, Suit, cardId, cardPoints, SUITS } from '@yaozifen/game-core/cards';
import { CompletedTrick, sideOf, TrickCard, trickWinner } from '@yaozifen/game-core';
import {
  ComputationGuard, HiddenWorld, ObservationPolicy, PlayerObservation, WorldEvaluator,
} from './contracts';

export interface SimulationState {
  hands: Card[][];
  readonly kitty: readonly Card[];
  readonly declarer: number;
  readonly bid: number;
  readonly revealedSeat?: number;
  readonly trump: Suit;
  leader: number;
  roundNumber: number;
  currentRound: TrickCard[];
  completedRounds: CompletedTrick[];
  voidSuits: Suit[][];
  declarerPoints: number;
  defenderPoints: number;
}

export function createSimulation(observation: PlayerObservation, world: HiddenWorld): SimulationState {
  return {
    hands: world.hands.map((hand) => [...hand]), kitty: [...world.kitty],
    declarer: observation.declarer, bid: observation.bid, trump: observation.trump,
    revealedSeat: observation.revealedHand?.seat,
    leader: observation.leader, roundNumber: observation.roundNumber,
    currentRound: [...observation.currentRound], completedRounds: [...observation.completedRounds],
    voidSuits: observation.voidSuits.map((suits) => [...suits]),
    declarerPoints: observation.declarerPoints, defenderPoints: observation.defenderPoints,
  };
}

export function cloneSimulation(state: SimulationState): SimulationState {
  return {
    ...state, hands: state.hands.map((hand) => [...hand]),
    currentRound: [...state.currentRound], completedRounds: [...state.completedRounds],
    voidSuits: state.voidSuits.map((suits) => [...suits]),
  };
}

export function simulationSeat(state: SimulationState): number {
  return (state.leader + state.currentRound.length) % 4;
}

export function observeSimulation(state: SimulationState, seat: number): PlayerObservation {
  return {
    seat, ownHand: state.hands[seat], handCounts: state.hands.map((hand) => hand.length),
    ...(state.revealedSeat !== undefined ? { revealedHand: {
      seat: state.revealedSeat, cards: state.hands[state.revealedSeat],
    } } : {}),
    declarer: state.declarer, bid: state.bid, trump: state.trump,
    leader: state.leader, roundNumber: state.roundNumber,
    currentRound: state.currentRound, completedRounds: state.completedRounds,
    voidSuits: state.voidSuits, declarerPoints: state.declarerPoints,
    defenderPoints: state.defenderPoints, kittySize: state.kitty.length,
    ...(seat === state.declarer ? { knownBuriedCards: state.kitty } : {}), ruleId: 'basic-v1',
  };
}

export function lockedWinner(state: Pick<SimulationState, 'declarer' | 'bid' | 'declarerPoints' | 'defenderPoints'>): number | undefined {
  if (state.declarerPoints >= state.bid) return sideOf(state.declarer);
  // 闲家锁定线 105 - bid 为精确阈值（分值粒度为 5，见 engine/game.ts 提前结算处推导）。
  if (state.defenderPoints >= 105 - state.bid) return 1 - sideOf(state.declarer);
  return undefined;
}

export function advanceSimulation(state: SimulationState, card: Card): void {
  const seat = simulationSeat(state);
  const hand = state.hands[seat];
  const index = hand.findIndex((candidate) => cardId(candidate) === cardId(card));
  const led = state.currentRound[0]?.card.suit;
  if (index < 0 || (led && card.suit !== led && hand.some((c) => c.suit === led))) {
    throw new Error('模拟策略返回非法牌');
  }
  if (led && card.suit !== led && !state.voidSuits[seat].includes(led)) {
    state.voidSuits[seat].push(led);
    state.voidSuits[seat].sort((a, b) => SUITS.indexOf(a) - SUITS.indexOf(b));
  }
  hand.splice(index, 1);
  state.currentRound.push({ seat, card });
  if (state.currentRound.length < 4) return;
  const winner = trickWinner(state.currentRound, state.trump).seat;
  const points = state.currentRound.reduce((total, entry) => total + cardPoints(entry.card), 0);
  if (sideOf(winner) === sideOf(state.declarer)) state.declarerPoints += points;
  else state.defenderPoints += points;
  state.completedRounds.push({
    trickNumber: state.roundNumber, winner, points, cards: [...state.currentRound],
  });
  state.currentRound = [];
  state.leader = winner;
  state.roundNumber++;
}

export class BasicWorldEvaluator implements WorldEvaluator {
  constructor(private readonly policy: ObservationPolicy) {}

  evaluate(observation: PlayerObservation, world: HiddenWorld, card: Card, guard: ComputationGuard): 0 | 1 {
    const state = createSimulation(observation, world);
    advanceSimulation(state, card);
    for (let steps = 0; steps <= 48; steps++) {
      guard.check();
      const winner = lockedWinner(state);
      if (winner !== undefined) return winner === sideOf(observation.seat) ? 1 : 0;
      if (state.hands.every((hand) => hand.length === 0)) throw new Error('模拟终局分数不守恒');
      const actor = simulationSeat(state);
      advanceSimulation(state, this.policy.chooseCard(observeSimulation(state, actor)));
    }
    throw new Error('模拟步数超出一副牌的上限');
  }
}
