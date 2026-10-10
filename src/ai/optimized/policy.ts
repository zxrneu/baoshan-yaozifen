/** 信息受限的快速策略。只排序合法牌，不作为搜索层的硬剪枝。 */
import { Card, cardId, cardPoints, cardValue, freshDeck } from '../../cards';
import { beats, partnerOf, sideOf, trickWinner } from '../../engine';
import { ObservationPolicy, PlayerObservation } from './contracts';
import { legalObservationCards } from './observation';
import { pruneCandidates } from '../tactics';

const deck = freshDeck();

function unseenCards(observation: PlayerObservation): Card[] {
  const known = new Set(observation.ownHand.map(cardId));
  for (const round of observation.completedRounds) for (const entry of round.cards) known.add(cardId(entry.card));
  for (const entry of observation.currentRound) known.add(cardId(entry.card));
  observation.knownBuriedCards?.forEach((card) => known.add(cardId(card)));
  observation.revealedHand?.cards.forEach((card) => known.add(cardId(card)));
  return deck.filter((card) => !known.has(cardId(card)));
}

function possibleSeatCards(observation: PlayerObservation, seat: number, unseen: readonly Card[]): readonly Card[] {
  return observation.revealedHand?.seat === seat ? observation.revealedHand.cards
    : unseen.filter((card) => !observation.voidSuits[seat].includes(card.suit));
}

/** 根据可见缺门及剩余牌估计后手敌人压牌风险；不是真实手牌查询。 */
function enemyThreat(
  observation: PlayerObservation, best: Card, unseen: readonly Card[],
): number {
  const led = observation.currentRound[0].card.suit;
  let survival = 1;
  for (let offset = observation.currentRound.length + 1; offset < 4; offset++) {
    const seat = (observation.leader + offset) % 4;
    if (sideOf(seat) === sideOf(observation.seat)) continue;
    const eligible = possibleSeatCards(observation, seat, unseen);
    if (observation.revealedHand?.seat === seat) {
      // 明牌按真实跟牌约束判断威胁：有同门时不能用主牌杀。
      const follow = eligible.filter((card) => card.suit === led);
      if ((follow.length ? follow : eligible).some((card) => beats(card, best, observation.trump))) return 1;
      continue;
    }
    const threatening = eligible.filter((card) => beats(card, best, observation.trump)
      && (card.suit === led || (card.suit === observation.trump
        && (best.suit === observation.trump || observation.voidSuits[seat].includes(led))))).length;
    let noThreat = 1;
    const draws = Math.min(observation.handCounts[seat], eligible.length);
    for (let i = 0; i < draws; i++) {
      noThreat *= Math.max(0, eligible.length - threatening - i) / (eligible.length - i);
    }
    survival *= noThreat;
  }
  return 1 - survival;
}

function resourceCost(card: Card, observation: PlayerObservation, unseen: readonly Card[]): number {
  const isTrump = card.suit === observation.trump;
  const larger = unseen.filter((c) => c.suit === card.suit && cardValue(c) > cardValue(card)).length;
  return cardValue(card) * 0.12 + (isTrump ? 2.0 : 0) + (larger === 0 ? (isTrump ? 5.0 : 2.5) : 0);
}

export const observationPolicy: ObservationPolicy = {
  chooseCard(observation) {
    const rawLegal = legalObservationCards(observation);
    if (rawLegal.length === 0) throw new Error('观察中没有合法牌');
    if (rawLegal.length === 1) return rawLegal[0];
    const legal = pruneCandidates(observation, rawLegal);
    if (legal.length === 1) return legal[0];
    const unseen = unseenCards(observation);
    const others = observation.revealedHand && observation.revealedHand.seat !== observation.seat
      ? [...unseen, ...observation.revealedHand.cards] : unseen;
    const goal = sideOf(observation.seat) === sideOf(observation.declarer)
      ? observation.bid : 105 - observation.bid;
    const collected = sideOf(observation.seat) === sideOf(observation.declarer)
      ? observation.declarerPoints : observation.defenderPoints;
    const lengths = new Map<string, number>();
    for (const card of observation.ownHand) lengths.set(card.suit, (lengths.get(card.suit) ?? 0) + 1);
    const leading = observation.currentRound.length === 0;
    const current = leading ? undefined : trickWinner([...observation.currentRound], observation.trump);
    const points = observation.currentRound.reduce((sum, entry) => sum + cardPoints(entry.card), 0);
    let best = legal[0];
    let bestScore = -Infinity;
    for (const card of legal) {
      let score: number;
      if (leading) {
        const larger = others.filter((c) => c.suit === card.suit && cardValue(c) > cardValue(card)).length;
        const enemies = [0, 1, 2, 3].filter((seat) => sideOf(seat) !== sideOf(observation.seat));
        const exposed = card.suit !== observation.trump && enemies.some((seat) => {
          const cards = possibleSeatCards(observation, seat, unseen);
          const voidInLed = observation.revealedHand?.seat === seat
            ? !cards.some((c) => c.suit === card.suit) : observation.voidSuits[seat].includes(card.suit);
          return voidInLed && cards.some((c) => c.suit === observation.trump);
        });
        score = (larger === 0 ? 18 + cardPoints(card) : 0)
          + (lengths.get(card.suit) ?? 0) * 0.7 - cardValue(card) * 0.3
          - (exposed ? 22 : 0) - (card.suit === observation.trump ? 3 : 0);
      } else {
        const winner = trickWinner([...observation.currentRound, { seat: observation.seat, card }], observation.trump);
        const friendly = sideOf(winner.seat) === sideOf(observation.seat);
        const probability = friendly ? 1 - enemyThreat(observation, winner.card, unseen) : 0;
        const available = points + cardPoints(card);
        score = (2 * probability - 1) * available * 3 - resourceCost(card, observation, others);
        if (collected + available >= goal) score += probability * 100;
        if (current?.seat === partnerOf(observation.seat) && winner.seat === observation.seat) score -= 1;
      }
      if (score > bestScore) { best = card; bestScore = score; }
    }
    return best;
  },
};
