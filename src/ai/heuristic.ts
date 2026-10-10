/**
 * 启发式 AI（v1 策略，实现 PlayerAgent）：
 * - 叫分：按手牌分牌与大牌估值，够档才叫。
 * - 定主：选张数多、牌力强的花色。
 * - 扣底：优先垫掉短门低牌，保留分牌与主牌。
 * - 出牌：跟同门出最小；缺门时若墩上有分或轮到最后一家则用最小主杀，否则垫最小牌；
 *   领出时倾向出 A 赢墩或长门。
 */
import { Card, SUITS, Suit, cardPoints, cardValue, sortHand } from '../cards';
import {
  GameState, currentSeat, legalBids, legalMoves, sideOf, trickWinner,
} from '../engine';
import { PlayerAgent } from './types';

/** 估算一手牌的价值（分牌为主，A/K 加成） */
export function estimateHand(cards: readonly Card[]): number {
  let score = 0;
  for (const c of cards) {
    const pts = cardPoints(c);
    if (pts > 0) score += pts * 0.85; // 分牌未必都能吃到
    if (c.rank === 'A') score += 2;
    if (c.rank === 'K') score += 1;
  }
  return score;
}

export function aiBid(state: GameState, seat: number): number | null {
  const est = estimateHand(state.hands[seat]);
  const legal = legalBids(state);
  // 期望 = 自身估值 + 搭档对剩余分的预期贡献（约 35%），再留 5 分余量
  const expected = est + (100 - est) * 0.35 - 5;
  const target = Math.floor(expected / 5) * 5;
  const candidates = legal.filter((b) => b <= target);
  if (candidates.length === 0) return null;
  return candidates[candidates.length - 1];
}

export function aiTrump(state: GameState, seat: number): Suit {
  const hand = state.hands[seat];
  let best: Suit = SUITS[0];
  let bestScore = -Infinity;
  for (const s of SUITS) {
    const inSuit = hand.filter((c) => c.suit === s);
    const score =
      inSuit.length * 2 +
      inSuit.reduce((a, c) => a + cardValue(c), 0) / 13 +
      inSuit.filter((c) => cardPoints(c) > 0).length;
    if (score > bestScore) {
      bestScore = score;
      best = s;
    }
  }
  return best;
}

export function aiBury(state: GameState, seat: number): Card[] {
  const n = state.kitty.length;
  const hand = state.hands[seat];
  const trump = state.trump!;
  const counts = new Map<string, number>();
  for (const c of hand) counts.set(c.suit, (counts.get(c.suit) ?? 0) + 1);

  // 可扣：非分牌；优先级：短门优先、点数小优先、非主优先
  const candidates = hand
    .filter((c) => cardPoints(c) === 0)
    .sort((a, b) => {
      const lenA = counts.get(a.suit)!;
      const lenB = counts.get(b.suit)!;
      if (lenA !== lenB) return lenA - lenB; // 先垫短门
      const aT = a.suit === trump ? 1 : 0;
      const bT = b.suit === trump ? 1 : 0;
      if (aT !== bT) return aT - bT; // 保留主牌
      return cardValue(a) - cardValue(b); // 先垫小牌
    });
  if (candidates.length < n) {
    // 极端情况（分牌太多）：放宽到手牌中点数最小者
    return sortHand([...hand].sort((a, b) => cardPoints(a) - cardPoints(b)).slice(0, n));
  }
  return sortHand(candidates.slice(0, n));
}

export function aiPlay(state: GameState, seat: number): Card {
  const legal = legalMoves(state, seat);
  const hand = state.hands[seat];
  const trump = state.trump!;
  const sortedAsc = [...legal].sort((a, b) => cardValue(a) - cardValue(b));

  if (state.trick.length === 0) {
    // 领出：先出 A 赢墩，否则出最长门的最小牌
    const aces = sortedAsc.filter((c) => c.rank === 'A');
    if (aces.length > 0) return aces[0];
    const suitCount = new Map<string, number>();
    for (const c of hand) suitCount.set(c.suit, (suitCount.get(c.suit) ?? 0) + 1);
    const longest = [...legal].sort(
      (a, b) => (suitCount.get(b.suit) ?? 0) - (suitCount.get(a.suit) ?? 0) || cardValue(a) - cardValue(b),
    );
    return longest[0];
  }

  const led = state.trick[0].card.suit;
  const trickPts = state.trick.reduce((a, t) => a + cardPoints(t.card), 0);
  const best = trickWinner(state.trick, trump);
  const partnerWinning = sideOf(best.seat) === sideOf(seat);
  const isLast = state.trick.length === 3;

  if (legal[0].suit === led) {
    // 有同门：跟牌。若搭档已大且墩无分，垫最小；否则尝试用最小可压的牌
    const sortedByVal = [...legal].sort((a, b) => cardValue(a) - cardValue(b));
    if (partnerWinning && trickPts === 0) return sortedByVal[0];
    const winners = sortedByVal.filter((c) => {
      const trial = [...state.trick, { seat, card: c }];
      return trickWinner(trial, trump).seat === seat;
    });
    if (winners.length > 0 && (trickPts > 0 || isLast)) return winners[0];
    return sortedByVal[0];
  }

  // 缺门：墩上有分或我是最后一家 → 用最小主杀；否则垫最小的非分牌
  const trumpsInLegal = sortedAsc.filter((c) => c.suit === trump);
  if (trumpsInLegal.length > 0 && (trickPts > 0 || isLast)) return trumpsInLegal[0];
  const safe = sortedAsc.filter((c) => cardPoints(c) === 0);
  return safe.length > 0 ? safe[0] : sortedAsc[0];
}

/** 启发式决策函数集：便于单测与复用 */
export const heuristicDecisions = {
  bid: aiBid,
  trump: aiTrump,
  bury: aiBury,
  play: aiPlay,
} as const;

/** 默认启发式玩家代理 */
export const heuristicAgent: PlayerAgent = {
  nextAction(state) {
    const seat = currentSeat(state);
    if (seat < 0) return null;
    switch (state.phase) {
      case 'bidding':
        return { kind: 'bid', seat, bid: aiBid(state, seat) };
      case 'trump':
        return { kind: 'trump', seat, trump: aiTrump(state, seat) };
      case 'bury':
        return { kind: 'bury', seat, cards: aiBury(state, seat) };
      case 'playing':
        return { kind: 'play', seat, card: aiPlay(state, seat) };
      default:
        return null;
    }
  },
};
