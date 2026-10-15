/**
 * T0.1 回归测试：扣底极端兜底绝不扣回分牌。
 *
 * 背景：当庄家 16 张手牌中非分牌不足 kittySize 张（极端构造局面）时，
 * `buryFromObservation`（smart.ts）与 `aiBury`（heuristic.ts）的兜底分支
 * 曾回退到"全手牌取点数最小者"，会返回 A/10/5，违反"分牌不能扣底"，
 * 导致 engine.bury 抛 IllegalActionError、该座位永远无法扣底。
 *
 * 本套件守护：兜底同样只在非分牌中选取；非分牌真不足时显式降级为"不足数"，
 * 绝不返回含分牌的非法动作。
 */
import { describe, expect, it, vi } from 'vitest';
import { Card, cardPoints } from '@yaozifen/game-core/cards';
import {
  GameState, bid, bury, createGame, currentSeat, declareTrump,
} from '@yaozifen/game-core';
import { aiBury } from '@yaozifen/ai-core/heuristic';
import { buryFromObservation } from '@yaozifen/ai-core/smart';

/**
 * 构造极端手牌：9 张分牌 + 3 张非分牌（共 12 张，kittySize = 4）。
 * 分牌：S A / H A / D A / C A / H 10 / D 10 / C 10 / H 5 / D 5
 * 非分牌：S K / H Q / C J
 */
const EXTREME_HAND: Card[] = [
  { suit: 'S', rank: 'A' }, { suit: 'H', rank: 'A' }, { suit: 'D', rank: 'A' }, { suit: 'C', rank: 'A' },
  { suit: 'H', rank: '10' }, { suit: 'D', rank: '10' }, { suit: 'C', rank: '10' },
  { suit: 'H', rank: '5' }, { suit: 'D', rank: '5' },
  { suit: 'S', rank: 'K' }, { suit: 'H', rank: 'Q' }, { suit: 'C', rank: 'J' },
];

const id = (c: Card) => `${c.rank}${c.suit}`;

/** 走到扣底阶段（庄家固定为主 D），可注入自定义手牌 */
function reachBury(seed = 3, trump: Card['suit'] = 'D', hand?: Card[]): GameState {
  let s = createGame(seed);
  const first = currentSeat(s);
  s = bid(s, first, 70);
  s = bid(s, currentSeat(s), null);
  s = bid(s, currentSeat(s), null);
  s = bid(s, currentSeat(s), null);
  const declarer = s.declarer!;
  s = declareTrump(s, declarer, trump);
  if (hand) {
    const patched = { ...s, hands: s.hands.map((h, i) => (i === declarer ? [...hand] : h)) };
    return patched;
  }
  return s;
}

/** 断言一组扣底牌不含分牌、无重复、且全部来自手牌 */
function expectLegalNonPointBury(cards: Card[], hand: Card[], kittySize: number) {
  expect(cards.some((c) => cardPoints(c) > 0)).toBe(false);
  expect(new Set(cards.map(id)).size).toBe(cards.length);
  const handIds = new Set(hand.map(id));
  expect(cards.every((c) => handIds.has(id(c)))).toBe(true);
  expect(cards.length).toBeLessThanOrEqual(kittySize);
}

describe('T0.1 极端扣底：兜底绝不扣回分牌', () => {
  it('buryFromObservation 在 9 分牌 + 3 非分牌时只返回非分牌', () => {
    const cards = buryFromObservation({ ownHand: EXTREME_HAND, trump: 'D', kittySize: 4 });
    expectLegalNonPointBury(cards, EXTREME_HAND, 4);
  });

  it('aiBury 在 9 分牌 + 3 非分牌时只返回非分牌', () => {
    const s = reachBury(3, 'D', EXTREME_HAND);
    const declarer = s.declarer!;
    const cards = aiBury(s, declarer);
    expectLegalNonPointBury(cards, EXTREME_HAND, s.kitty.length);
  });

  it('engine.bury 的失败原因不是"分牌不能扣回底牌"（而是张数不足，且绝不返回分牌）', () => {
    const s = reachBury(3, 'D', EXTREME_HAND);
    const declarer = s.declarer!;
    const cards = buryFromObservation({ ownHand: s.hands[declarer], trump: s.trump!, kittySize: s.rules.kittySize });

    // 核心不变量：绝不返回分牌（这正是修复前会失败的断言）
    expect(cards.some((c) => cardPoints(c) > 0)).toBe(false);

    // 非分牌不足 4 张 → 显式降级为不足数；引擎应因"张数不足"拒绝，而非因分牌非法
    expect(cards.length).toBe(3);
    expect(() => bury(s, declarer, cards)).toThrow(/需扣回恰好/);
    try {
      bury(s, declarer, cards);
      throw new Error('should have thrown');
    } catch (e) {
      expect((e as Error).message).not.toContain('分牌');
    }
  });

  it('非分牌为零张时返回空数组且不抛异常（理论不可达时的安全降级）', () => {
    const allPoints: Card[] = [
      { suit: 'S', rank: 'A' }, { suit: 'S', rank: '10' }, { suit: 'S', rank: '5' },
      { suit: 'H', rank: 'A' }, { suit: 'H', rank: '10' }, { suit: 'H', rank: '5' },
      { suit: 'D', rank: 'A' }, { suit: 'D', rank: '10' }, { suit: 'D', rank: '5' },
      { suit: 'C', rank: 'A' }, { suit: 'C', rank: '10' }, { suit: 'C', rank: '5' },
    ];
    expect(() => buryFromObservation({ ownHand: allPoints, trump: 'S', kittySize: 4 })).not.toThrow();
    const cards = buryFromObservation({ ownHand: allPoints, trump: 'S', kittySize: 4 });
    expect(cards).toHaveLength(0);
  });

  it('降级告警只输出一次，不随对局刷屏', () => {
    const spy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      // 该用例与前面的极端用例共用模块级一次性标志，故此处不再断言 warn 次数，
      // 只断言多次调用不抛异常、结果恒为合法非分牌。
      for (let i = 0; i < 5; i++) {
        const cards = buryFromObservation({ ownHand: EXTREME_HAND, trump: 'D', kittySize: 4 });
        expect(cards.some((c) => cardPoints(c) > 0)).toBe(false);
      }
      expect(spy.mock.calls.length).toBeLessThanOrEqual(1);
    } finally {
      spy.mockRestore();
    }
  });
});

describe('T0.1 常规路径行为不变（防回归）', () => {
  it('30 副正常发牌：扣底恰好 4 张、全为非分牌、来自手牌，引擎接受', () => {
    for (let seed = 1; seed <= 30; seed++) {
      for (const trump of ['S', 'H', 'D', 'C'] as const) {
        const s = reachBury(seed, trump);
        const declarer = s.declarer!;
        const hand = s.hands[declarer];
        const cards = buryFromObservation({ ownHand: hand, trump: s.trump!, kittySize: s.rules.kittySize });
        expect(cards).toHaveLength(4);
        expectLegalNonPointBury(cards, hand, 4);
        // 正常路径下引擎必须接受
        expect(() => bury(s, declarer, cards)).not.toThrow();
      }
    }
  });

  it('30 副正常发牌：启发式 aiBury 同样合法且被引擎接受', () => {
    for (let seed = 1; seed <= 30; seed++) {
      const s = reachBury(seed);
      const declarer = s.declarer!;
      const hand = s.hands[declarer];
      const cards = aiBury(s, declarer);
      expect(cards).toHaveLength(4);
      expectLegalNonPointBury(cards, hand, 4);
      expect(() => bury(s, declarer, cards)).not.toThrow();
    }
  });

  it('正常手牌中非分牌充足（≥4），兜底分支不会触发', () => {
    for (let seed = 1; seed <= 200; seed++) {
      const s = reachBury(seed);
      const declarer = s.declarer!;
      const nonPoints = s.hands[declarer].filter((c) => cardPoints(c) === 0).length;
      expect(nonPoints).toBeGreaterThanOrEqual(4);
    }
  });
});
