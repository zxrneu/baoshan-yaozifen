import { describe, expect, it } from 'vitest';
import {
  Card, TOTAL_POINTS, cardId, cardPoints, cardValue, freshDeck, makeRng, shuffle, sortHand,
} from '../src/cards';

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
});
