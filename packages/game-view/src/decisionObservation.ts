/** 决策入口与 RPC 共用的运行时白名单；不保留 GameState 或输入对象的额外属性。 */
import { Card, RANKS, SUITS, Suit, cardPoints } from '@yaozifen/game-core/cards';
import { GameState, legalBids, partnerOf } from '@yaozifen/game-core';
import { PlayerObservation } from './contracts';
import { observePlayer } from './observation';

interface PhaseObservation {
  readonly seat: number;
  readonly ownHand: readonly Card[];
  readonly handCounts: readonly number[];
  readonly kittySize: number;
  readonly ruleId: 'basic-v1';
}
export interface BiddingObservation extends PhaseObservation {
  readonly phase: 'bidding';
  readonly highestBid: number;
  readonly highestBidder: number | null;
  readonly legalBids: readonly number[];
  readonly bidHistory: readonly { seat: number; bid: number | null }[];
  readonly minBid: number;
  readonly maxBid: number;
  readonly bidStep: number;
}
export interface TrumpObservation extends PhaseObservation {
  readonly phase: 'trump';
  readonly winningBid: number;
}
export interface BuryObservation extends PhaseObservation {
  readonly phase: 'bury';
  /** 已拿底的手牌；无需另传原底牌数组。 */
  readonly trump: Suit;
}
export type PlayingObservation = PlayerObservation & { readonly phase: 'playing' };
export type DecisionObservation = BiddingObservation | TrumpObservation | BuryObservation | PlayingObservation;

export function observeDecision(state: GameState, seat: number): DecisionObservation {
  if (state.phase === 'playing') return { phase: 'playing', ...observePlayer(state, seat) };
  if (state.rules.handSize !== 12 || state.rules.kittySize !== 4) throw new Error('仅支持 basic-v1 观察');
  const base = {
    seat, ownHand: state.hands[seat], handCounts: state.hands.map(hand => hand.length),
    kittySize: state.rules.kittySize, ruleId: 'basic-v1' as const,
  };
  switch (state.phase) {
    case 'bidding': return sanitizeDecisionObservation({ ...base, phase: 'bidding', highestBid: state.highestBid,
      highestBidder: state.highestBidder, legalBids: legalBids(state), bidHistory: state.bidding,
      minBid: state.rules.minBid, maxBid: state.rules.maxBid, bidStep: state.rules.bidStep });
    case 'trump': return sanitizeDecisionObservation({ ...base, phase: 'trump', winningBid: state.highestBid });
    case 'bury': {
      if (state.trump === null) throw new Error('扣底前必须定主');
      return sanitizeDecisionObservation({ ...base, phase: 'bury', trump: state.trump });
    }
    default: throw new Error(`不支持的决策阶段: ${state.phase}`);
  }
}

export function observeBidding(state: GameState, seat: number): BiddingObservation {
  const observation = observeDecision(state, seat);
  if (observation.phase !== 'bidding') throw new Error('只能投影叫分阶段');
  return observation;
}
export function observeTrump(state: GameState, seat: number): TrumpObservation {
  const observation = observeDecision(state, seat);
  if (observation.phase !== 'trump') throw new Error('只能投影定主阶段');
  return observation;
}
export function observeBury(state: GameState, seat: number): BuryObservation {
  const observation = observeDecision(state, seat);
  if (observation.phase !== 'bury') throw new Error('只能投影扣底阶段');
  return observation;
}

const fail = (): never => { throw new Error('非法决策观察'); };
function seatNumber(value: unknown): number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0 && value < 4 ? value : fail();
}
function number(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fail();
}
function suit(value: unknown): Suit {
  return SUITS.includes(value as Suit) ? value as Suit : fail();
}
function cards(value: unknown): Card[] {
  if (!Array.isArray(value)) return fail();
  return value.map(card => {
    if (!card || !RANKS.includes(card.rank)) return fail();
    return { suit: suit(card.suit), rank: card.rank };
  });
}
function counts(value: unknown): number[] {
  if (!Array.isArray(value) || value.length !== 4
    || value.some(n => !Number.isInteger(n) || n < 0 || n > 16)) return fail();
  return value.map(number);
}

/** 用于出牌接口/Worker 边界；逐字段复制，移除运行时夹带的暗牌或 seed。 */
export function sanitizePlayerObservation(input: PlayerObservation): PlayerObservation {
  if (!input || input.ruleId !== 'basic-v1' || input.kittySize !== 4) return fail();
  const seat = seatNumber(input.seat), declarer = seatNumber(input.declarer);
  const handCounts = counts(input.handCounts);
  const entries = (value: PlayerObservation['currentRound']) => {
    if (!Array.isArray(value)) return fail();
    return value.map(entry => ({ seat: seatNumber(entry.seat), card: cards([entry.card])[0] }));
  };
  if (!Array.isArray(input.completedRounds) || !Array.isArray(input.voidSuits) || input.voidSuits.length !== 4) return fail();
  const revealed = input.revealedHand;
  if (revealed && (input.bid !== 100 || revealed.seat !== partnerOf(declarer)
    || revealed.cards.length !== handCounts[revealed.seat])) return fail();
  if (input.knownBuriedCards && (seat !== declarer || input.knownBuriedCards.length !== input.kittySize
    || input.knownBuriedCards.some(card => cardPoints(card) !== 0))) return fail();
  return {
    seat, ownHand: cards(input.ownHand), handCounts, declarer, bid: number(input.bid), trump: suit(input.trump),
    leader: seatNumber(input.leader), roundNumber: number(input.roundNumber),
    currentRound: entries(input.currentRound),
    completedRounds: input.completedRounds.map(round => ({ trickNumber: number(round.trickNumber),
      winner: seatNumber(round.winner), points: number(round.points), cards: entries(round.cards) })),
    voidSuits: input.voidSuits.map(voids => {
      if (!Array.isArray(voids)) return fail();
      return voids.map(suit);
    }),
    declarerPoints: number(input.declarerPoints), defenderPoints: number(input.defenderPoints),
    kittySize: input.kittySize, ruleId: 'basic-v1',
    ...(revealed ? { revealedHand: { seat: revealed.seat, cards: cards(revealed.cards) } } : {}),
    ...(input.knownBuriedCards ? { knownBuriedCards: cards(input.knownBuriedCards) } : {}),
  };
}

export function sanitizeDecisionObservation(input: DecisionObservation): DecisionObservation {
  if (!input) return fail();
  if (input.phase === 'playing') return { phase: 'playing', ...sanitizePlayerObservation(input) };
  if (input.ruleId !== 'basic-v1' || input.kittySize !== 4) return fail();
  const base: PhaseObservation = { seat: seatNumber(input.seat), ownHand: cards(input.ownHand),
    handCounts: counts(input.handCounts), kittySize: input.kittySize, ruleId: 'basic-v1' };
  if (base.ownHand.length !== base.handCounts[base.seat]) return fail();
  switch (input.phase) {
    case 'bidding': {
      if (!Array.isArray(input.legalBids) || !Array.isArray(input.bidHistory)
        || input.bidStep <= 0 || input.maxBid < input.minBid) return fail();
      return { ...base, phase: 'bidding', highestBid: number(input.highestBid),
        highestBidder: input.highestBidder === null ? null : seatNumber(input.highestBidder),
        legalBids: input.legalBids.map(number), bidHistory: input.bidHistory.map(note => ({
          seat: seatNumber(note.seat), bid: note.bid === null ? null : number(note.bid),
        })), minBid: number(input.minBid), maxBid: number(input.maxBid), bidStep: number(input.bidStep) };
    }
    case 'trump': return { ...base, phase: 'trump', winningBid: number(input.winningBid) };
    case 'bury': return { ...base, phase: 'bury', trump: suit(input.trump) };
    default: return fail();
  }
}

export interface InputVisibility {
  ownHandCount: number;
  hiddenHandCount: number;
  revealedHand?: { seat: number; count: number };
  kitty: 'unknown' | 'in-hand' | 'known-buried';
  kittySize: number;
}
export function inputVisibility(observation: DecisionObservation): InputVisibility {
  const revealed = observation.phase === 'playing' ? observation.revealedHand : undefined;
  return { ownHandCount: observation.ownHand.length,
    hiddenHandCount: observation.handCounts.reduce((sum, count, seat) =>
      sum + (seat !== observation.seat && seat !== revealed?.seat ? count : 0), 0),
    ...(revealed ? { revealedHand: { seat: revealed.seat, count: revealed.cards.length } } : {}),
    kitty: observation.phase === 'bury' ? 'in-hand'
      : observation.phase === 'playing' && observation.knownBuriedCards ? 'known-buried' : 'unknown',
    kittySize: observation.kittySize };
}
