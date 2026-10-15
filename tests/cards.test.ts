import { describe, expect, it } from 'vitest';
import {
  Card, TOTAL_POINTS, cardId, cardPoints, cardValue, freshDeck, makeRng, shuffle, sortHand,
  groupCardsBySuit, analyzeHandFeatures,
} from '@yaozifen/game-core/cards';

describe('cards', () => {
  it('一副牌 52 张，点数花色各不相同', () => {
    const deck = freshDeck();
    expect(deck).toHaveLength(52);
    expect(new Set(deck.map(cardId)).size).toBe(52);
  });

  it('分牌分值：A/10=10，5=5，其余 0，全副 100 分', () => {
    const deck = freshDeck();
    expect(cardPoints({ suit: 'S', rank: 'A' })).toBe(10);
    expect(cardPoints({ suit: 'H', rank: '10' })).toBe(10);
    expect(cardPoints({ suit: 'D', rank: '5' })).toBe(5);
    expect(cardPoints({ suit: 'C', rank: 'K' })).toBe(0);
    const total = deck.reduce((a, c) => a + cardPoints(c), 0);
    expect(total).toBe(100);
    expect(TOTAL_POINTS).toBe(100);
  });

  it('牌力：2 < 10 < J < K < A', () => {
    expect(cardValue({ suit: 'S', rank: '2' })).toBeLessThan(cardValue({ suit: 'S', rank: '10' }));
    expect(cardValue({ suit: 'S', rank: '10' })).toBeLessThan(cardValue({ suit: 'S', rank: 'J' }));
    expect(cardValue({ suit: 'S', rank: 'K' })).toBeLessThan(cardValue({ suit: 'S', rank: 'A' }));
  });

  it('理牌按黑红黑红花色分组、组内 A 在前', () => {
    const hand: Card[] = [
      { suit: 'C', rank: '7' }, { suit: 'S', rank: '2' },
      { suit: 'S', rank: 'A' }, { suit: 'H', rank: '5' },
      { suit: 'D', rank: '10' },
    ];
    const sorted = sortHand(hand);
    expect(sorted.map((c) => c.suit)).toEqual(['S', 'S', 'H', 'C', 'D']);
    expect(sorted[0].rank).toBe('A');
    expect(sorted[1].rank).toBe('2');
  });

  it('同种子 RNG 可复现，洗牌不改变牌集合', () => {
    const a = shuffle(freshDeck(), makeRng(42));
    const b = shuffle(freshDeck(), makeRng(42));
    expect(a).toEqual(b);
    const c = shuffle(freshDeck(), makeRng(43));
    expect(a).not.toEqual(c);
    expect(new Set(a.map(cardId)).size).toBe(52);
  });

  it('用户真实案例手牌：分花色分组与特征统计完全精确 (无需LLM心算)', () => {
    const userHand: Card[] = [
      { suit: 'C', rank: 'K' }, { suit: 'H', rank: '10' }, { suit: 'S', rank: 'J' },
      { suit: 'C', rank: '5' }, { suit: 'D', rank: '8' }, { suit: 'S', rank: '10' },
      { suit: 'H', rank: '2' }, { suit: 'D', rank: 'K' }, { suit: 'S', rank: 'A' },
      { suit: 'S', rank: '2' }, { suit: 'C', rank: '8' }, { suit: 'D', rank: 'Q' },
    ];

    const groups = groupCardsBySuit(userHand);
    expect(groups.S.count).toBe(4);
    expect(groups.S.labels).toEqual(['♠A', '♠J', '♠10', '♠2']);
    expect(groups.S.points).toBe(20);
    expect(groups.S.honors).toEqual(['A', 'J']);

    expect(groups.H.count).toBe(2);
    expect(groups.H.labels).toEqual(['♥10', '♥2']);
    expect(groups.H.points).toBe(10);

    expect(groups.C.count).toBe(3);
    expect(groups.C.labels).toEqual(['♣K', '♣8', '♣5']);
    expect(groups.C.points).toBe(5);
    expect(groups.C.honors).toEqual(['K']);

    expect(groups.D.count).toBe(3);
    expect(groups.D.labels).toEqual(['♦K', '♦Q', '♦8']);
    expect(groups.D.points).toBe(0);
    expect(groups.D.honors).toEqual(['K', 'Q']);

    const summary = analyzeHandFeatures(userHand);
    expect(summary.totalPoints).toBe(35);
    expect(summary.longestSuit.suit).toBe('S');
    expect(summary.longestSuit.count).toBe(4);
    expect(summary.hasLongSuit).toBe(false); // 无 >= 5 张长套
    expect(summary.hcp).toBe(13); // A(4) + K(3)*2 + Q(2) + J(1) = 13
    expect(summary.controlsCount).toEqual({ A: 1, K: 2, Q: 1, J: 1 });
    expect(summary.shortSuits.map((s) => s.suit)).toContain('H');
  });
});

