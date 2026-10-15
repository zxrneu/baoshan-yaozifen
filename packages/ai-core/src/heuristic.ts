/**
 * 启发式 AI（v1 策略，实现 PlayerAgent）：
 * - 叫分：按手牌分牌与大牌估值，够档才叫。
 * - 定主：选张数多、牌力强的花色。
 * - 扣底：优先垫掉短门低牌，保留分牌与主牌；兜底分支同样只在非分牌中选取。
 * - 出牌：跟同门出最小；缺门时若本轮有分或轮到最后一家则用最小主杀，否则垫最小牌；
 *   领出时倾向出 A 赢下本轮或长门。
 */
import { Card, SUITS, Suit, cardPoints, cardValue, sortHand } from '@yaozifen/game-core/cards';
import {
  basicScoring, GameState, currentSeat, legalBids, legalMoves, revealedPartnerSeat, sideOf, trickWinner,
} from '@yaozifen/game-core';
import { PlayerAgent } from './types';
import { observePlayer } from '@yaozifen/game-view/observation';
import { observationPolicy } from './optimized/policy';
import { isPartnerGuaranteedWinning } from './tactics';

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
  // 叫分门槛基于起叫分与手牌估值：基准手牌（约 21 分）达到起叫分，牌力更强则竞争叫更高档
  const expected = state.rules.minBid + (est - 21) * 1.6;
  const target = Math.floor(expected / state.rules.bidStep) * state.rules.bidStep;
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
  // 极端情况（分牌太多，非分牌不足 n 张）：兜底**仍只在非分牌中选**。
  // 绝不回退到"全手牌取点数最小者"——那会返回 A/10/5，违反"分牌不能扣底"，
  // 并让 engine.bury 抛 IllegalActionError，该座位将永远无法扣底。
  // 此处显式降级为"不足数"，让引擎在 bury 处以清晰错误暴露问题。
  if (candidates.length < n) return sortHand([...candidates]);
  return sortHand(candidates.slice(0, n));
}

export function aiPlay(state: GameState, seat: number): Card {
  if (revealedPartnerSeat(state) !== null && state.rules.scoring === basicScoring
    && state.rules.handSize === 12 && state.rules.kittySize === 4) {
    return observationPolicy.chooseCard(observePlayer(state, seat));
  }
  const legal = legalMoves(state, seat);
  const hand = state.hands[seat];
  const trump = state.trump!;
  const sortedAsc = [...legal].sort((a, b) => cardValue(a) - cardValue(b));

  if (state.trick.length === 0) {
    // 领出：先出 A 赢下本轮，否则出最长门的最小牌
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
  const observation = observePlayer(state, seat);
  const partnerGuaranteed =
    revealedPartnerSeat(state) === null &&
    state.trick.length > 0 &&
    isPartnerGuaranteedWinning(observation);

  /** 喂分优先级：10 > 5 > A，保护 A 控制牌，且优先送出易被压的大分牌 10 */
  const feedPriority = (c: Card): number => {
    if (c.rank === '10') return 3;
    if (c.rank === '5') return 2;
    if (c.rank === 'A') return 1;
    return 0;
  };
  const sortFeedCards = (cards: readonly Card[]): Card[] =>
    [...cards].sort((a, b) => {
      const diff = feedPriority(b) - feedPriority(a);
      if (diff !== 0) return diff;
      return cardValue(a) - cardValue(b);
    });

  if (legal[0].suit === led) {
    // 有同门：跟牌。
    const sortedByVal = [...legal].sort((a, b) => cardValue(a) - cardValue(b));
    if (partnerWinning) {
      // 搭档已大：绝不盲目超车搭档。优先在不超车的牌中选择安全喂分，否则跟最小牌保控制
      const nonOvertaking = sortedByVal.filter((c) => {
        const trial = [...state.trick, { seat, card: c }];
        return trickWinner(trial, trump).seat !== seat;
      });
      if (nonOvertaking.length > 0) {
        // 只有确认搭档稳赢时（第四手或搭档绝对大牌），才优先喂分（10 > 5 > A）
        if (partnerGuaranteed) {
          const pointCards = nonOvertaking.filter((c) => cardPoints(c) > 0);
          if (pointCards.length > 0) return sortFeedCards(pointCards)[0];
        }
        return nonOvertaking[0];
      }
      // 全部都会超车（被迫）：出最小牌
      return sortedByVal[0];
    }
    // 对手领先：若本轮有分或是最后一家，尝试用最小能压过的牌抢下
    const winners = sortedByVal.filter((c) => {
      const trial = [...state.trick, { seat, card: c }];
      return trickWinner(trial, trump).seat === seat;
    });
    if (winners.length > 0 && (trickPts > 0 || isLast)) return winners[0];
    return sortedByVal[0];
  }

  // 缺门
  if (partnerWinning) {
    // 搭档领先：绝不主动出主牌杀搭档！
    const nonTrumps = sortedAsc.filter((c) => c.suit !== trump);
    if (nonTrumps.length > 0) {
      // 只有搭档确定稳赢时，才优先垫非主分牌喂给搭档（10 > 5 > A）
      if (partnerGuaranteed) {
        const pointCards = nonTrumps.filter((c) => cardPoints(c) > 0);
        if (pointCards.length > 0) return sortFeedCards(pointCards)[0];
      }
      // 搭档非稳赢或无分牌：优先垫最小非分副牌保实力（避免送分给后手毙杀对手）
      const zeroPointNonTrumps = nonTrumps.filter((c) => cardPoints(c) === 0);
      if (zeroPointNonTrumps.length > 0) return zeroPointNonTrumps[0];
      return nonTrumps[0];
    }
    // 满手全是主牌（极少见被迫）：选不超车的最小主，否则出最小主
    const nonOvertakingTrumps = sortedAsc.filter((c) => {
      const trial = [...state.trick, { seat, card: c }];
      return trickWinner(trial, trump).seat !== seat;
    });
    return nonOvertakingTrumps[0] ?? sortedAsc[0];
  }

  // 对手领先：若本轮有分或我是最后一家，尝试用最小可赢主牌杀下
  const trumpsInLegal = sortedAsc.filter((c) => c.suit === trump);
  if (trumpsInLegal.length > 0 && (trickPts > 0 || isLast)) {
    const winningTrumps = trumpsInLegal.filter((c) => {
      const trial = [...state.trick, { seat, card: c }];
      return trickWinner(trial, trump).seat === seat;
    });
    if (winningTrumps.length > 0) return winningTrumps[0];
  }
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
