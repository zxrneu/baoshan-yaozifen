/**
 * 牌张定义：花色、点数、分牌与牌力。
 *
 * 幺子分使用一副无大小王的 52 张扑克牌。
 * 分牌为 A、10、5：A 与 10 各 10 分，5 为 5 分；
 * 每门花色 25 分，全副合计 100 分。
 * 牌力：A > K > Q > J > 10 > 9 > … > 2（同花色内比较，A 最大）。
 */

export type Suit = 'S' | 'H' | 'D' | 'C'; // ♠ 黑桃 / ♥ 红桃 / ♦ 方块 / ♣ 梅花
export type Rank =
  | '2' | '3' | '4' | '5' | '6' | '7' | '8' | '9' | '10' | 'J' | 'Q' | 'K' | 'A';

export interface Card {
  readonly suit: Suit;
  readonly rank: Rank;
}

export const SUITS: readonly Suit[] = ['S', 'H', 'D', 'C'] as const;

export const SUIT_SYMBOL: Record<Suit, string> = { S: '♠', H: '♥', D: '♦', C: '♣' };
export const SUIT_NAME: Record<Suit, string> = { S: '黑桃', H: '红桃', D: '方块', C: '梅花' };
export const RANK_NAME: Record<Rank, string> = {
  '2': '2', '3': '3', '4': '4', '5': '5', '6': '6', '7': '7', '8': '8', '9': '9',
  '10': '10', J: 'J', Q: 'Q', K: 'K', A: 'A',
};

/** 点数序列，索引即牌力（2 最小，A 最大） */
export const RANKS: readonly Rank[] = [
  '2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K', 'A',
] as const;

/** 分牌及其分值 */
export const POINT_RANKS: Readonly<Record<string, number>> = { A: 10, '10': 10, '5': 5 };

/** 全副分值合计（应为 100） */
export const TOTAL_POINTS =
  Object.values(POINT_RANKS).reduce((a, b) => a + b, 0) * SUITS.length;

/** 一张牌的分值：A/10 = 10，5 = 5，其余 0 */
export function cardPoints(card: Card): number {
  return POINT_RANKS[card.rank] ?? 0;
}

/** 牌力值（2=0 … A=12），仅同花色内有意义 */
export function cardValue(card: Card): number {
  const v = RANKS.indexOf(card.rank);
  if (v < 0) throw new Error(`非法点数: ${card.rank}`);
  return v;
}

export function cardId(card: Card): string {
  return `${card.rank}${card.suit}`;
}

export function cardLabel(card: Card): string {
  return `${SUIT_SYMBOL[card.suit]}${RANK_NAME[card.rank]}`;
}

export function makeCard(suit: Suit, rank: Rank): Card {
  return { suit, rank };
}

/** 一副完整的 52 张牌 */
export function freshDeck(): Card[] {
  return SUITS.flatMap((suit) => RANKS.map((rank) => ({ suit, rank })));
}

/** 理牌：花色按黑桃、红桃、梅花、方块交错分组，同花色内牌力降序（A 在前） */
export function sortHand(cards: readonly Card[]): Card[] {
  const suitOrder: Record<Suit, number> = { S: 0, H: 1, C: 2, D: 3 };
  return [...cards].sort((a, b) => {
    const s = suitOrder[a.suit] - suitOrder[b.suit];
    if (s !== 0) return s;
    return cardValue(b) - cardValue(a);
  });
}

/**
 * 可插入的可复现随机数生成器（mulberry32）。
 * 传入种子即可复现同一副牌，便于测试与回放。
 */
export type Rng = () => number;

export function makeRng(seed: number): Rng {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Fisher–Yates 洗牌（原地，返回同一数组） */
export function shuffle<T>(arr: T[], rng: Rng): T[] {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

export interface SuitGroup {
  readonly suit: Suit;
  readonly symbol: string;
  readonly name: string;
  readonly cards: Card[];
  readonly labels: string[];
  readonly count: number;
  readonly points: number;
  readonly honors: string[];
}

/** 按花色理牌并结构化分组（黑桃、红桃、梅花、方块降序排列） */
export function groupCardsBySuit(cards: readonly Card[]): Record<Suit, SuitGroup> {
  const sorted = sortHand(cards);
  const result: Record<Suit, SuitGroup> = {
    S: { suit: 'S', symbol: '♠', name: '黑桃', cards: [], labels: [], count: 0, points: 0, honors: [] },
    H: { suit: 'H', symbol: '♥', name: '红桃', cards: [], labels: [], count: 0, points: 0, honors: [] },
    C: { suit: 'C', symbol: '♣', name: '梅花', cards: [], labels: [], count: 0, points: 0, honors: [] },
    D: { suit: 'D', symbol: '♦', name: '方块', cards: [], labels: [], count: 0, points: 0, honors: [] },
  };

  for (const c of sorted) {
    const group = result[c.suit];
    group.cards.push(c);
    group.labels.push(cardLabel(c));
    (group as { count: number }).count++;
    (group as { points: number }).points += cardPoints(c);
    if (['A', 'K', 'Q', 'J'].includes(c.rank) && !group.honors.includes(c.rank)) {
      group.honors.push(c.rank);
    }
  }

  return result;
}

export interface HandSummary {
  readonly totalPoints: number;
  readonly pointCards: string[];
  readonly suitCounts: Record<Suit, number>;
  readonly longestSuit: { suit: Suit; symbol: string; name: string; count: number };
  readonly hasLongSuit: boolean; // >= 5 张
  readonly hcp: number; // A:4, K:3, Q:2, J:1
  readonly controlsCount: { A: number; K: number; Q: number; J: number };
  readonly shortSuits: Array<{ suit: Suit; symbol: string; name: string; count: number }>; // <= 2 张
}

/** 计算手牌全局特征快照（点数、控制力、长套、短门） */
export function analyzeHandFeatures(cards: readonly Card[]): HandSummary {
  const groups = groupCardsBySuit(cards);
  let totalPoints = 0;
  const pointCards: string[] = [];
  const suitCounts: Record<Suit, number> = { S: 0, H: 0, C: 0, D: 0 };
  const controlsCount = { A: 0, K: 0, Q: 0, J: 0 };
  let hcp = 0;

  let longestSuit: Suit = 'S';
  let maxCount = -1;
  const shortSuits: Array<{ suit: Suit; symbol: string; name: string; count: number }> = [];

  for (const suit of SUITS) {
    const g = groups[suit];
    suitCounts[suit] = g.count;
    totalPoints += g.points;

    for (const c of g.cards) {
      if (cardPoints(c) > 0) {
        pointCards.push(`${cardLabel(c)}(${cardPoints(c)}分)`);
      }
      if (c.rank === 'A') { controlsCount.A++; hcp += 4; }
      else if (c.rank === 'K') { controlsCount.K++; hcp += 3; }
      else if (c.rank === 'Q') { controlsCount.Q++; hcp += 2; }
      else if (c.rank === 'J') { controlsCount.J++; hcp += 1; }
    }

    if (g.count > maxCount) {
      maxCount = g.count;
      longestSuit = suit;
    }
    if (g.count <= 2) {
      shortSuits.push({ suit, symbol: g.symbol, name: g.name, count: g.count });
    }
  }

  return {
    totalPoints,
    pointCards,
    suitCounts,
    longestSuit: {
      suit: longestSuit,
      symbol: groups[longestSuit].symbol,
      name: groups[longestSuit].name,
      count: maxCount,
    },
    hasLongSuit: maxCount >= 5,
    hcp,
    controlsCount,
    shortSuits,
  };
}
