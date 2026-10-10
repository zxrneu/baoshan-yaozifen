/**
 * 基础 AI（启发式，v1）：
 * - 叫分：按手牌分牌与大牌估值，够档才叫。
 * - 定主：选张数多、牌力强的花色。
 * - 扣底：优先垫掉短门低牌，保留分牌与主牌。
 * - 出牌：跟同门出最小；缺门时若墩上有分或轮到最后一家则用最小主杀，否则垫最小牌；
 *   领出时倾向出 A 赢墩或长门。
 */

import { Card, SUITS, Suit, cardPoints, cardValue, sortHand } from './cards';
import {
  GameState, SEAT_NAMES, bid as bidAction, bury as buryAction,
  currentSeat, declareTrump as declareTrumpAction, legalBids, legalMoves,
  playCard as playCardAction, sideOf, trickWinner,
} from './engine';

export interface AIAction {
  kind: 'bid' | 'trump' | 'bury' | 'play';
  seat: number;
  /** 叫分用：分数；null = 不叫 */
  bid?: number | null;
  /** 定主用 */
  trump?: Suit;
  /** 扣底 / 出牌用 */
  cards?: Card[];
  card?: Card;
  /** 供 UI 展示的一句话说明 */
  note: string;
}

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

/** 生成 AI 的下一步动作；对局结束返回 null */
export function aiNextAction(state: GameState): AIAction | null {
  const seat = currentSeat(state);
  if (seat < 0) return null;
  switch (state.phase) {
    case 'bidding': {
      const b = aiBid(state, seat);
      return {
        kind: 'bid', seat, bid: b, note: b === null ? `${SEAT_NAMES[seat]} 不叫` : `${SEAT_NAMES[seat]} 叫 ${b} 分`,
      };
    }
    case 'trump': {
      const t = aiTrump(state, seat);
      return { kind: 'trump', seat, trump: t, note: `${SEAT_NAMES[seat]} 定主 ${t}` };
    }
    case 'bury': {
      const cards = aiBury(state, seat);
      return { kind: 'bury', seat, cards, note: `${SEAT_NAMES[seat]} 扣回 ${cards.length} 张底牌` };
    }
    case 'playing': {
      const card = aiPlay(state, seat);
      return {
        kind: 'play', seat, card, note: `${SEAT_NAMES[seat]} 出 ${card.rank}${card.suit}`,
      };
    }
    default:
      return null;
  }
}

/** 执行 AI 动作，返回新状态（与人工入口共用引擎校验） */
export function applyAiAction(state: GameState, action: AIAction): GameState {
  switch (action.kind) {
    case 'bid':
      return bidAction(state, action.seat, action.bid ?? null);
    case 'trump':
      return declareTrumpAction(state, action.seat, action.trump!);
    case 'bury':
      return buryAction(state, action.seat, action.cards!);
    case 'play':
      return playCardAction(state, action.seat, action.card!);
  }
}

// re-export 供 UI 使用
export { currentSeat };
