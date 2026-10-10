/** 唯一接触真实 GameState 的信息投影边界。 */
import { Card, Suit, cardId, cardValue, SUITS } from '../../cards';
import { basicScoring, CompletedTrick, GameState, revealedPartnerSeat, TrickCard } from '../../engine';
import { PlayerObservation } from './contracts';

export function inferVoidSuits(
  rounds: readonly CompletedTrick[], current: readonly TrickCard[],
): Suit[][] {
  const voids = Array.from({ length: 4 }, () => new Set<Suit>());
  for (const cards of [...rounds.map((r) => r.cards), current]) {
    if (cards.length === 0) continue;
    const led = cards[0].card.suit;
    for (const entry of cards.slice(1)) {
      if (entry.card.suit !== led) voids[entry.seat].add(led);
    }
  }
  return voids.map((suits) => SUITS.filter((suit) => suits.has(suit)));
}

export function observePlayer(state: GameState, seat: number): PlayerObservation {
  if (state.phase !== 'playing' || state.declarer === null || state.trump === null) {
    throw new Error('只能投影出牌阶段');
  }
  if (state.rules.scoring !== basicScoring || state.rules.handSize !== 12 || state.rules.kittySize !== 4) {
    throw new Error('优化策略仅支持 basic-v1 的 12 张手牌与 4 张底牌');
  }
  if (!Number.isInteger(seat) || seat < 0 || seat >= 4) throw new RangeError('非法座位');
  const cloneEntry = (entry: TrickCard): TrickCard => ({ seat: entry.seat, card: { ...entry.card } });
  const rounds = state.completedTricks.map((r) => ({ ...r, cards: r.cards.map(cloneEntry) }));
  const current = state.trick.map(cloneEntry);
  const revealed = revealedPartnerSeat(state);
  return {
    seat, ownHand: state.hands[seat].map((c) => ({ ...c })),
    ...(revealed !== null ? { revealedHand: {
      seat: revealed, cards: state.hands[revealed].map((c) => ({ ...c })),
    } } : {}),
    handCounts: state.hands.map((hand) => hand.length),
    declarer: state.declarer, bid: state.highestBid, trump: state.trump,
    leader: state.leader, roundNumber: state.trickNumber,
    currentRound: current, completedRounds: rounds, voidSuits: inferVoidSuits(rounds, current),
    declarerPoints: state.declarerTrickPoints, defenderPoints: state.defenderTrickPoints,
    kittySize: state.rules.kittySize,
    ...(seat === state.declarer ? { knownBuriedCards: state.kitty.map((c) => ({ ...c })) } : {}),
    ruleId: 'basic-v1',
  };
}

export function legalObservationCards(observation: PlayerObservation): Card[] {
  if ((observation.leader + observation.currentRound.length) % 4 !== observation.seat) return [];
  const led = observation.currentRound[0]?.card.suit;
  const follow = observation.ownHand.filter((card) => card.suit === led);
  return canonicalCards(follow.length ? follow : observation.ownHand);
}

export function canonicalCards(cards: readonly Card[]): Card[] {
  return [...cards].sort((a, b) => SUITS.indexOf(a.suit) - SUITS.indexOf(b.suit) || cardValue(a) - cardValue(b));
}

/** 完整可见历史参与信息键，保留玩家对已发生行动的记忆。 */
export function observationKey(observation: PlayerObservation): string {
  return JSON.stringify({
    ...observation,
    ownHand: canonicalCards(observation.ownHand).map(cardId),
    revealedHand: observation.revealedHand && {
      seat: observation.revealedHand.seat,
      cards: canonicalCards(observation.revealedHand.cards).map(cardId),
    },
    knownBuriedCards: observation.knownBuriedCards && canonicalCards(observation.knownBuriedCards).map(cardId),
  });
}
