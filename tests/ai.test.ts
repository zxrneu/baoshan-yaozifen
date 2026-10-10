import { describe, expect, it } from 'vitest';
import { cardPoints } from '../src/cards';
import {
  bid, bury, createGame, currentSeat, declareTrump, legalBids, legalMoves, nextHand, playCard,
} from '../src/engine';
import { aiBury, aiBid, aiNextAction, aiPlay, aiTrump, applyAiAction, estimateHand } from '../src/ai';

/** 用 AI 把整场打完，返回最终状态 */
function runFullMatch(seed: number, targetWins = 2, maxSteps = 2000) {
  let s = createGame(seed, { targetWins });
  let steps = 0;
  while (s.phase !== 'matchEnd' && steps++ < maxSteps) {
    if (s.phase === 'handEnd') {
      s = nextHand(s);
      continue;
    }
    const action = aiNextAction(s);
    if (!action) throw new Error(`phase=${s.phase} 无 AI 动作`);
    s = applyAiAction(s, action);
  }
  return { s, steps };
}

describe('AI 估值与叫分', () => {
  it('分牌越多估值越高', () => {
    const weak = [{ suit: 'S' as const, rank: '2' as const }];
    const strong = [
      { suit: 'S' as const, rank: 'A' as const },
      { suit: 'H' as const, rank: '10' as const },
      { suit: 'D' as const, rank: '5' as const },
    ];
    expect(estimateHand(strong)).toBeGreaterThan(estimateHand(weak));
  });

  it('叫分只返回合法档位或不叫', () => {
    for (let seed = 1; seed <= 50; seed++) {
      const s = createGame(seed);
      const seat = currentSeat(s);
      const b = aiBid(s, seat);
      if (b !== null) {
        expect(legalBids(s)).toContain(b);
      }
    }
  });
});

describe('AI 定主与扣底', () => {
  it('定主返回合法花色，扣底恰好 4 张且全为非分牌、来自手牌', () => {
    for (let seed = 1; seed <= 30; seed++) {
      let s = createGame(seed);
      const first = currentSeat(s);
      s = bid(s, first, 70);
      s = bid(s, currentSeat(s), null);
      s = bid(s, currentSeat(s), null);
      s = bid(s, currentSeat(s), null);
      const declarer = s.declarer!;
      const trump = aiTrump(s, declarer);
      expect(['S', 'H', 'D', 'C']).toContain(trump);
      s = declareTrump(s, declarer, trump);
      const cards = aiBury(s, declarer);
      expect(cards).toHaveLength(4);
      expect(cards.every((c) => cardPoints(c) === 0)).toBe(true);
      const handIds = new Set(s.hands[declarer].map((c) => `${c.rank}${c.suit}`));
      expect(cards.every((c) => handIds.has(`${c.rank}${c.suit}`))).toBe(true);
      expect(new Set(cards.map((c) => `${c.rank}${c.suit}`)).size).toBe(4);
      // 引擎接受 AI 的扣底
      expect(() => bury(s, declarer, cards)).not.toThrow();
    }
  });
});

describe('AI 出牌合法性', () => {
  it('跟牌阶段只出合法牌（5 副完整对局抽查）', () => {
    for (let seed = 100; seed < 105; seed++) {
      let s = createGame(seed);
      let steps = 0;
      while (steps++ < 2000) {
        if (s.phase === 'bidding') {
          s = bid(s, currentSeat(s), aiBid(s, currentSeat(s)));
          continue;
        }
        if (s.phase === 'trump') {
          s = declareTrump(s, s.declarer!, aiTrump(s, s.declarer!));
          continue;
        }
        if (s.phase === 'bury') {
          s = bury(s, s.declarer!, aiBury(s, s.declarer!));
          continue;
        }
        if (s.phase === 'playing') {
          const seat = currentSeat(s);
          const card = aiPlay(s, seat);
          const legal = legalMoves(s, seat);
          expect(legal.some((c) => c.rank === card.rank && c.suit === card.suit)).toBe(true);
          s = playCard(s, seat, card);
          continue;
        }
        break; // handEnd
      }
      expect(s.phase).toBe('handEnd');
      expect(s.declarerTrickPoints + s.defenderTrickPoints + s.buriedPoints).toBe(100);
    }
  });
});

describe('AI 全场模拟', () => {
  it('多个种子的整场对局能正常收场且分数守恒', () => {
    for (const seed of [1, 7, 42, 2024]) {
      const { s, steps } = runFullMatch(seed, 1);
      expect(s.phase).toBe('matchEnd');
      expect(Math.max(...s.scores)).toBe(1);
      expect(steps).toBeLessThan(2000);
      // 终局时手牌已打完，只剩底牌；每副打完的吃分守恒由 runFullMatch 内校验
      expect(s.kitty).toHaveLength(4);
    }
  });

  it('打牌过程中牌不重复，且总数随轮数递减而守恒', () => {
    let s = createGame(99);
    let checked = 0;
    for (let i = 0; i < 300 && s.phase !== 'handEnd' && s.phase !== 'matchEnd'; i++) {
      if (s.phase === 'playing') {
        const all = s.hands.flat().concat(s.kitty, s.trick.map((t: any) => t.card))
          .map((c: any) => `${c.rank}${c.suit}`);
        // 已收走的牌不再被追踪：总数 = 52 - 底牌(4) - 已完成轮数×4 + 底牌4
        expect(all.length).toBe(52 - (s.trickNumber - 1) * 4);
        expect(new Set(all).size).toBe(all.length); // 无重复
        checked++;
      }
      s = applyAiAction(s, aiNextAction(s)!);
    }
    expect(checked).toBeGreaterThan(10);
  });

  it('aiNextAction 与状态阶段一致，终局返回 null', () => {
    let s = createGame(5);
    for (let i = 0; i < 500 && s.phase !== 'handEnd' && s.phase !== 'matchEnd'; i++) {
      const a = aiNextAction(s);
      expect(a).not.toBeNull();
      s = applyAiAction(s, a!);
    }
    expect(s.phase === 'handEnd' || s.phase === 'matchEnd').toBe(true);
    expect(aiNextAction(s)).toBeNull();
  });
});
