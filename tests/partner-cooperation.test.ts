/**
 * AI 搭档配合出牌失误修复与战术协同回归测试（TDD 驱动）。
 * 遵循红 → 绿 → 重构原则，覆盖：
 * 1. 基础启发式（heuristic.ts）：缺门不杀搭档、安全喂分、跟门不浪费大牌压搭档；
 * 2. 蒙特卡洛搜索（search.ts）：消除“一律禁止超车”缺陷，解决反例 5 中的第三手盖牌保护；
 * 3. 算法策略（policy.ts）：提高无收益抢搭档惩罚，胜负线临界协同。
 */
import { describe, expect, it } from 'vitest';
import { Card, cardId, cardPoints, freshDeck, makeCard } from '@yaozifen/game-core/cards';
import {
  createGame, GameState, legalMoves,
} from '@yaozifen/game-core';
import { aiPlay } from '@yaozifen/ai-core/heuristic';
import { searchBestCard, FAST_BUDGET, DEFAULT_BUDGET } from '@yaozifen/ai-core/search';
import { seededSearchRandom } from '@yaozifen/ai-core/optimized/computation';
import { observePlayer } from '@yaozifen/game-view/observation';
import { observationPolicy } from '@yaozifen/ai-core/optimized/policy';
import { isPartnerGuaranteedWinning, pruneCandidates } from '@yaozifen/ai-core/tactics';

const c = makeCard;

/**
 * 辅助构造处于出牌阶段的游戏状态，保证全副 52 张牌守恒与合法观察一致。
 * 座位约定：0=东, 1=南, 2=西, 3=北。东西搭档(0与2)，南北搭档(1与3)。
 */
function makeFullValidState(opts: {
  declarer?: number;
  highestBid?: number;
  trump?: 'S' | 'H' | 'D' | 'C';
  leader: number;
  trick: Array<{ seat: number; card: Card }>;
  hands: [Card[], Card[], Card[], Card[]];
  declarerTrickPoints?: number;
  defenderTrickPoints?: number;
}): GameState {
  const base = createGame(1001);
  base.phase = 'playing';
  base.declarer = opts.declarer ?? 0;
  base.highestBid = opts.highestBid ?? 70;
  base.highestBidder = opts.declarer ?? 0;
  base.trump = opts.trump ?? 'S';
  base.leader = opts.leader;
  base.trick = [...opts.trick];
  base.hands = opts.hands.map((h) => [...h]) as [Card[], Card[], Card[], Card[]];
  base.declarerTrickPoints = opts.declarerTrickPoints ?? 0;
  base.defenderTrickPoints = opts.defenderTrickPoints ?? 0;
  base.buriedPoints = 0;

  const used = new Set<string>();
  for (const t of base.trick) used.add(cardId(t.card));
  for (const h of base.hands) {
    for (const card of h) used.add(cardId(card));
  }

  // 按照各花色剩余牌数模 4 的余数挑选 0 分底牌，使每门剩余张数均为 4 的倍数
  const bySuit = new Map<'S' | 'H' | 'D' | 'C', Card[]>();
  for (const s of ['S', 'H', 'D', 'C'] as const) bySuit.set(s, []);
  for (const card of freshDeck()) {
    if (!used.has(cardId(card))) bySuit.get(card.suit)!.push(card);
  }

  const kitty: Card[] = [];
  for (const [, list] of bySuit.entries()) {
    const rem = list.length % 4;
    const zeroCards = list.filter((c) => cardPoints(c) === 0);
    kitty.push(...zeroCards.slice(0, rem));
  }
  const allZero = freshDeck().filter(
    (c) => !used.has(cardId(c)) && cardPoints(c) === 0 && !kitty.some((k) => cardId(k) === cardId(c)),
  );
  while (kitty.length < 4 && allZero.length > 0) kitty.push(allZero.pop()!);
  base.kitty = kitty.slice(0, 4);
  for (const k of base.kitty) used.add(cardId(k));

  // 每门花色按 4 张一组构筑同门完成轮次，保证不触发虚假缺门
  base.completedTricks = [];
  let trickNum = 1;
  for (const s of ['S', 'H', 'D', 'C'] as const) {
    const suitCards = freshDeck().filter((c) => c.suit === s && !used.has(cardId(c)));
    for (let i = 0; i + 3 < suitCards.length; i += 4) {
      const chunk = suitCards.slice(i, i + 4);
      base.completedTricks.push({
        trickNumber: trickNum++,
        winner: 0,
        points: chunk.reduce((sum, card) => sum + cardPoints(card), 0),
        cards: chunk.map((card, idx) => ({ seat: idx, card })),
      });
      chunk.forEach((c) => used.add(cardId(c)));
    }
  }

  const leftover = freshDeck().filter((c) => !used.has(cardId(c)));
  for (let i = 0; i + 3 < leftover.length; i += 4) {
    const chunk = leftover.slice(i, i + 4);
    base.completedTricks.push({
      trickNumber: trickNum++,
      winner: 0,
      points: chunk.reduce((sum, card) => sum + cardPoints(card), 0),
      cards: chunk.map((card, idx) => ({ seat: idx, card })),
    });
  }
  base.trickNumber = base.completedTricks.length + 1;

  return base;
}

describe('AI 搭档配合：基础启发式 (heuristic.ts)', () => {
  it('缺门且搭档稳赢时（第四手确凿稳赢）：绝不能出主牌杀搭档，有非主分牌时必须喂分', () => {
    // 领出：南家(1,对手)出 ♥2，西家(2,搭档)出 ♥A，北家(3,对手)跟 ♥10
    // 第四手：轮到东家(0,己方)，红心缺门，手持主牌 ♠2, ♠3 以及副牌 ♦10, ♦2
    // 此时第四手后手已无任何对手，搭档红心 A 百分之百稳赢
    const state = makeFullValidState({
      leader: 1,
      trick: [
        { seat: 1, card: c('H', '2') },
        { seat: 2, card: c('H', 'A') },
        { seat: 3, card: c('H', '10') },
      ],
      hands: [
        [c('S', '2'), c('S', '3'), c('D', '10'), c('D', '2')], // 东家(0, 第四手)
        [c('D', '3'), c('C', '2'), c('C', '3')],
        [c('C', '4'), c('C', '5'), c('D', '4')],
        [c('C', '6'), c('C', '7'), c('D', '6')],
      ],
    });

    const chosen = aiPlay(state, 0);

    // 1. 铁律：绝不能用主牌杀搭档的赢牌
    expect(chosen.suit).not.toBe('S');
    // 2. 战术配合：搭档已稳赢，手中有分牌 ♦10 应该安全喂给搭档
    expect(chosen.suit).toBe('D');
    expect(chosen.rank).toBe('10');
  });

  it('缺门且搭档非稳赢时（第三手副牌且第四手对手有杀牌威胁）：绝不能喂分，垫最小0分副牌保实力', () => {
    // 领出：西家(2,搭档)出 ♥A，北家(3,对手)跟 ♥2
    // 第三手：东家(0,己方)红心缺门，手牌持有副牌分牌 ♦10 以及 0 分牌 ♦2，还有主牌 ♠2
    // 第四手：南家(1,对手)持主牌 ♠A 且缺红心（存在毙杀威胁）
    const state = makeFullValidState({
      leader: 2,
      trick: [
        { seat: 2, card: c('H', 'A') },
        { seat: 3, card: c('H', '2') },
      ],
      hands: [
        [c('S', '2'), c('D', '10'), c('D', '2')], // 东家(0, 第三手)
        [c('S', 'A'), c('D', '3'), c('C', '3')], // 南家(1, 第四手，持主牌 ♠A 缺红心)
        [c('C', '4'), c('C', '5')],
        [c('C', '6'), c('C', '7')],
      ],
    });

    const chosen = aiPlay(state, 0);

    // 绝不能把 ♦10 喂给尚未稳赢的搭档（否则第四手南家 ♠A 杀下会白送 30 分）！
    // 应当垫出 0 分副牌 ♦2 保留实力
    expect(chosen.suit).toBe('D');
    expect(chosen.rank).toBe('2');
  });

  it('跟门且搭档非稳赢时（第三手副牌且第四手对手有杀牌威胁）：绝不能喂分，跟最小牌保实力', () => {
    // 领出：西家(2,搭档)出 ♥A，北家(3,对手)跟 ♥2
    // 第三手：东家(0,己方)跟红心，持有 ♥10 与 ♥3
    // 第四手：南家(1,对手)缺红心持有主牌 ♠A（存在毙杀威胁）
    const state = makeFullValidState({
      leader: 2,
      trick: [
        { seat: 2, card: c('H', 'A') },
        { seat: 3, card: c('H', '2') },
      ],
      hands: [
        [c('H', '10'), c('H', '3')],              // 东家(0, 第三手)
        [c('S', 'A'), c('D', '3'), c('C', '3')], // 南家(1, 第四手，缺红心)
        [c('C', '4'), c('C', '5')],
        [c('C', '6'), c('C', '7')],
      ],
    });

    const chosen = aiPlay(state, 0);

    // 绝不能在搭档未稳赢时跟出 ♥10 喂分，必须跟最小牌 ♥3
    expect(chosen.suit).toBe('H');
    expect(chosen.rank).toBe('3');
  });

  it('缺门且搭档稳赢时喂分排序应为 10 > 5 > A：持有 ♦A 与 ♦5 时，优先喂 ♦5 保留控制牌 ♦A', () => {
    // 领出：南家(1,对手)出 ♥2，西家(2,搭档)出 ♥A，北家(3,对手)跟 ♥3
    // 第四手：东家(0)红心缺门，手持副牌分牌 ♦A 与 ♦5
    // 此时第四手搭档稳赢，东家应喂分，且优先送出 ♦5，保留关键控制牌 ♦A
    const state = makeFullValidState({
      leader: 1,
      trick: [
        { seat: 1, card: c('H', '2') },
        { seat: 2, card: c('H', 'A') },
        { seat: 3, card: c('H', '3') },
      ],
      hands: [
        [c('D', 'A'), c('D', '5')], // 东家(0, 第四手)
        [c('C', '2')],
        [c('C', '3')],
        [c('C', '4')],
      ],
    });

    const chosen = aiPlay(state, 0);

    // 优先喂 5，保留 A！
    expect(chosen.suit).toBe('D');
    expect(chosen.rank).toBe('5');
  });

  it('跟门且搭档稳赢时喂分排序应为 10 > 5 > A：持有同门不超车分牌时，优先喂 10 > 5', () => {
    // 领出：南家(1,对手)出 ♠3，西家(2,搭档)出 ♠A (主牌最大稳赢)，北家(3,对手)跟 ♠2
    // 第四手：东家(0)跟主牌，手持 ♠10 与 ♠5 (皆不超车 ♠A)
    const state = makeFullValidState({
      leader: 1,
      trump: 'S',
      trick: [
        { seat: 1, card: c('S', '3') },
        { seat: 2, card: c('S', 'A') }, // 主牌 A 稳赢
        { seat: 3, card: c('S', '2') },
      ],
      hands: [
        [c('S', '10'), c('S', '5')], // 东家(0, 第四手)
        [c('C', '2')],
        [c('C', '3')],
        [c('C', '4')],
      ],
    });

    const chosen = aiPlay(state, 0);

    // 10 分优先于 5 分送出
    expect(chosen.rank).toBe('10');
  });

  it('缺门且搭档稳赢时：无分牌时垫最小0分副牌保实力，绝不能出主牌', () => {
    // 西家(2,搭档)领出副牌 ♣A，北家(3,对手)跟 ♣2
    // 东家(0,己方)梅花缺门：手持主牌 ♠K, ♠2 以及副牌 ♦4, ♦2
    const state = makeFullValidState({
      leader: 2,
      trick: [
        { seat: 2, card: c('C', 'A') }, // 搭档领出梅花 A 稳赢
        { seat: 3, card: c('C', '2') },
      ],
      hands: [
        [c('S', 'K'), c('S', '2'), c('D', '4'), c('D', '2')], // 东家(0)
        [c('C', '3'), c('D', '3'), c('C', '8'), c('C', '9')],
        [c('D', '5'), c('D', '6'), c('C', '10')],
        [c('D', '7'), c('D', '8'), c('C', 'J')],
      ],
    });

    const chosen = aiPlay(state, 0);

    // 绝不出主牌杀搭档，应垫出最小副牌 ♦2
    expect(chosen.suit).toBe('D');
    expect(chosen.rank).toBe('2');
  });

  it('跟同门且搭档稳赢时：绝不出大牌压搭档，跟最小同门牌保控制', () => {
    // 西家(2,搭档)领出副牌 ♥K，北家(3,对手)跟 ♥5 (轮上有 5 分)
    // 东家(0,己方)手持 ♥Q, ♥2
    const state = makeFullValidState({
      leader: 2,
      trick: [
        { seat: 2, card: c('H', 'K') }, // 搭档红心 K 已经稳赢
        { seat: 3, card: c('H', '5') },
      ],
      hands: [
        [c('H', 'Q'), c('H', '2')], // 东家(0)
        [c('H', '8'), c('C', '2')],
        [c('C', '3')],
        [c('C', '5')],
      ],
    });

    const chosen = aiPlay(state, 0);

    // 搭档已大，绝不浪费 ♥Q 压搭档，出 ♥2
    expect(chosen.rank).toBe('2');
  });
});

describe('AI 搭档配合：蒙特卡洛搜索 (search.ts)', () => {
  it('反例5经典局面：第三手搭档非稳赢且面临第四手威胁时，绝不硬性禁止超车，候选保留且稳定选出 A 保护成局', () => {
    // 双方还各有两张牌，黑桃 S 为主；庄家方(东西)叫 70，已经吃 60 分，闲家 10 分。
    // 第一手：搭档西家(2)领出 ♥Q
    // 第二手：敌人北家(3)跟 ♥2
    // 第三手：东家(0)当前出牌，手牌持有 ♥A、♥3
    // 第四手：敌人南家(1)手牌持有 ♥K、♦K
    // 若出 ♥3，第四手南家出 ♥K 截获，随后出 ♦K 闲家吃够 30 分胜出；
    // 若出 ♥A 盖牌超车，本墩收走 10 分达到 70 分直接锁定成局！
    const state = makeFullValidState({
      declarer: 0,
      highestBid: 70,
      declarerTrickPoints: 60,
      defenderTrickPoints: 10,
      trump: 'S',
      leader: 2,
      trick: [
        { seat: 2, card: c('H', 'Q') }, // 搭档暂时领先
        { seat: 3, card: c('H', '2') },
      ],
      hands: [
        [c('H', 'A'), c('H', '3')], // 东家(0,己方，尚未出牌，2张)
        [c('H', 'K'), c('D', 'K')], // 南家(1,对手，尚未出牌，2张)
        [c('D', '10')],              // 西家(2,搭档，已出 ♥Q，剩1张)
        [c('D', 'A')],               // 北家(3,对手，已出 ♥2，剩1张)
      ],
    });

    // 1. 机制验证：确认可见观察判定搭档非稳赢，候选池未被误剪枝
    const obs = observePlayer(state, 0);
    expect(isPartnerGuaranteedWinning(obs)).toBe(false);
    const legal = legalMoves(state, 0);
    const pruned = pruneCandidates(obs, legal);
    expect(pruned.some((card) => card.suit === 'H' && card.rank === 'A')).toBe(true);
    expect(pruned.some((card) => card.suit === 'H' && card.rank === '3')).toBe(true);

    // 2. 决策验证：使用可复现的评估条件（注入固定随机源与充足预算），验证稳定选牌
    // 固定注入采样随机源（seed = 42），对相同评估条件重复运行，确保结果绝对确定可复现
    for (let i = 0; i < 10; i++) {
      const rng = seededSearchRandom(42);
      const chosen = searchBestCard(state, 0, undefined, DEFAULT_BUDGET, rng);
      expect(chosen.suit).toBe('H');
      expect(chosen.rank).toBe('A');
    }
  });

  it('第四手搭档稳赢时：searchBestCard 绝不浪费大牌超车', () => {
    // 领出：南家(1,对手)出 ♠4
    // 第二手：搭档西家(2)出 ♠A (主牌最大牌，稳赢)
    // 第三手：北家(3,对手)跟 ♠3
    // 第四手：当前东家(0)出牌，持 ♠K 与 ♠2，后手已无任何人，搭档百分百稳赢
    const state = makeFullValidState({
      leader: 1,
      trump: 'S',
      trick: [
        { seat: 1, card: c('S', '4') },
        { seat: 2, card: c('S', 'A') },
        { seat: 3, card: c('S', '3') },
      ],
      hands: [
        [c('S', 'K'), c('S', '2')], // 东家(0, 剩2张)
        [c('C', '2')],              // 南家(1, 剩1张)
        [c('C', '3')],              // 西家(2, 剩1张)
        [c('C', '4')],              // 北家(3, 剩1张)
      ],
    });

    const chosen = searchBestCard(state, 0, undefined, FAST_BUDGET);

    // 第四手必须出 ♠2，绝不出 ♠K 浪费主牌大控制
    expect(chosen.rank).toBe('2');
  });
});

describe('AI 搭档配合：算法观察策略 (policy.ts)', () => {
  it('搭档已大时，算法策略不应因为大牌点数高而错误超车搭档', () => {
    // 搭档西家(2)出 ♥A 稳赢，北家跟 ♥2
    // 东家(0)持 ♥K (0分) 和 ♥2 (0分)，跟牌不能超车 ♥A
    const state = makeFullValidState({
      leader: 2,
      trick: [
        { seat: 2, card: c('H', 'A') },
        { seat: 3, card: c('H', '2') },
      ],
      hands: [
        [c('H', 'K'), c('H', '2')], // 东家(0)
        [c('H', '3')],
        [c('C', '2')],
        [c('C', '3')],
      ],
    });

    const obs = observePlayer(state, 0);
    const chosen = observationPolicy.chooseCard(obs);

    expect(chosen.rank).toBe('2');
  });

  it('第四手搭档已大，手中持有分牌时，算法策略优先安全喂分', () => {
    // 领出：南家(1,对手)出 ♠3
    // 第二手：西家(2,搭档)出 ♠A 稳赢
    // 第三手：北家(3,对手)出 ♠2
    // 第四手：东家(0)持 ♠10 (10分) 与 ♠4 (0分)
    const state = makeFullValidState({
      leader: 1,
      trump: 'S',
      trick: [
        { seat: 1, card: c('S', '3') },
        { seat: 2, card: c('S', 'A') },
        { seat: 3, card: c('S', '2') },
      ],
      hands: [
        [c('S', '10'), c('S', '4')], // 东家(0)
        [c('C', '2')],
        [c('C', '3')],
        [c('C', '4')],
      ],
    });

    const obs = observePlayer(state, 0);
    const chosen = observationPolicy.chooseCard(obs);

    // 安全送分入账
    expect(chosen.rank).toBe('10');
  });
});
