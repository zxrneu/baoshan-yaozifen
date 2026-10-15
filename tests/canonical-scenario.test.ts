/**
 * 评估场景等价变换族与规范型测试 (tests/canonical-scenario.test.ts)。
 * 遵循单一职责原则 (SRP)，验证规范化算法在座位旋转 (0..3) 和花色置换 (S4) 下的同构识别与区分度。
 */
import { describe, expect, it } from 'vitest';
import { getScenarioCanonicalKey, areScenariosEquivalent } from '../src/ai/eval/canonicalScenario';
import { ALL_BENCHMARK_SCENARIOS, loadScenarios } from '../src/ai/eval/scenarios';
import { scenarioObservation } from '../src/ai/eval/fingerprint';
import { Card, Suit, SUITS } from '../src/cards';
import { PlayerObservation } from '../src/ai/optimized/contracts';
import { CardNotation } from '../src/ai/eval/types';
import { c } from '../src/ai/eval/deckHelper';

const permutations = (suits: readonly Suit[]): Suit[][] => suits.length === 0 ? [[]]
  : suits.flatMap(suit => permutations(suits.filter(other => other !== suit)).map(rest => [suit, ...rest]));

const swapSH = (notation: CardNotation): CardNotation => {
  const { rank, suit } = c(notation);
  return `${rank}${suit === 'S' ? 'H' : suit === 'H' ? 'S' : suit}`;
};

describe('评估场景等价变换族与规范型 (Canonical Representation)', () => {
  const sampleBid = ALL_BENCHMARK_SCENARIOS.find(s => s.phase === 'bidding')!;
  const sampleTrump = ALL_BENCHMARK_SCENARIOS.find(s => s.phase === 'trump')!;

  it('叫分场景：座位旋转 (seat + 1 mod 4) 产生完全相同的规范型 Key', () => {
    const origKey = getScenarioCanonicalKey(sampleBid);
    const def = sampleBid.definition!;
    if (def.phase !== 'bidding') throw new Error('预期叫分样本');
    const rotatedDef = {
      ...def,
      setup: {
        ...def.setup,
        seat: (def.setup.seat + 1) % 4,
        highestBidder: def.setup.highestBidder !== undefined && def.setup.highestBidder !== null
          ? (def.setup.highestBidder + 1) % 4
          : null,
      },
    };
    const rotatedKey = getScenarioCanonicalKey(rotatedDef);
    expect(rotatedKey).toBe(origKey);
  });

  it('定主场景：花色置换产生完全相同的规范型 Key', () => {
    const origKey = getScenarioCanonicalKey(sampleTrump);
    const def = sampleTrump.definition!;
    if (def.phase !== 'trump') throw new Error('预期定主样本');
    // 置换 S <-> H
    const swappedDef = {
      ...def,
      setup: {
        ...def.setup,
        hand: def.setup.hand.map(swapSH),
      },
    };
    const swappedKey = getScenarioCanonicalKey(swappedDef);
    expect(swappedKey).toBe(origKey);
  });

  it('出牌场景：旋转与花色置换同构识别 (play-lead-draw-trumps)', () => {
    const leadDraw = ALL_BENCHMARK_SCENARIOS.find(s => s.id === 'play-lead-draw-trumps')!;
    const def = leadDraw.definition!;
    if (def.phase !== 'playing') throw new Error('预期出牌样本');
    // 旋转座位 1 -> 0，主牌 S -> H
    const transformed = {
      ...def,
      id: 'test-transformed-lead-draw',
      setup: {
        ...def.setup,
        seat: 0,
        declarer: 0,
        leader: 0,
        trump: 'H' as const,
        ownHand: def.setup.ownHand.map(swapSH),
      },
    };
    expect(areScenariosEquivalent(leadDraw, transformed)).toBe(true);
    expect(getScenarioCanonicalKey(transformed)).toBe(getScenarioCanonicalKey(leadDraw));
  });

  it('不同结构的场景产生不同的规范型 Key', () => {
    const bid1 = ALL_BENCHMARK_SCENARIOS.filter(s => s.phase === 'bidding')[0];
    const bid2 = ALL_BENCHMARK_SCENARIOS.filter(s => s.phase === 'bidding')[1];
    expect(getScenarioCanonicalKey(bid1)).not.toBe(getScenarioCanonicalKey(bid2));
  });

  it('省略定主合同与显式使用实际默认合同 75 时规范型相同', () => {
    const def = structuredClone(sampleTrump.definition!);
    if (def.phase !== 'trump') throw new Error('预期定主样本');
    delete def.setup.winningBid;
    const implicit = loadScenarios([def])[0];
    const explicit = loadScenarios([{ ...def, setup: { ...def.setup, winningBid: 75 } }])[0];
    expect(scenarioObservation(implicit)).toEqual(scenarioObservation(explicit));
    expect(areScenariosEquivalent(implicit, explicit)).toBe(true);
    expect(areScenariosEquivalent(def, explicit)).toBe(true);
  });

  it('公开绝门改变合法暗牌补全时不能合并为同一个规范型', () => {
    const base = ALL_BENCHMARK_SCENARIOS.find(s => s.id === 'play-lead-draw-trumps')!;
    const def = structuredClone(base.definition!);
    if (def.phase !== 'playing') throw new Error('预期出牌样本');
    def.setup.voidSuits = [[], [], ['H'], []];
    const changed = loadScenarios([def])[0];
    expect(scenarioObservation(changed)).not.toEqual(scenarioObservation(base));
    expect(areScenariosEquivalent(changed, base)).toBe(false);
  });

  it('历史推导的绝门与重复显式声明同一绝门时规范型相同', () => {
    const base = ALL_BENCHMARK_SCENARIOS.find(s => s.id === 'play-mid-round6-partner-lead-void')!;
    const obs = base.setup().observation!;
    expect(obs.voidSuits[0]).toContain('D');
    const def = structuredClone(base.definition!);
    if (def.phase !== 'playing') throw new Error('预期出牌样本');
    def.setup.voidSuits = obs.voidSuits.map(voids => [...voids].reverse());
    expect(areScenariosEquivalent(def, base)).toBe(true);
  });

  it.each([
    'play-open-declarer-draw-diamonds',
    'play-late-declarer-feed-five',
    'play-feed-partner-void',
  ])('%s：实际观察在全部 96 种变换下等价，覆盖明牌、底牌、历史与绝门', id => {
    const base = ALL_BENCHMARK_SCENARIOS.find(s => s.id === id)!;
    const obs = base.setup().observation!;
    const key = getScenarioCanonicalKey(base);
    for (let r = 0; r < 4; r++) {
      for (const permutation of permutations(SUITS)) {
        const suit = (s: Suit) => permutation[SUITS.indexOf(s)];
        const card = (c: Card): Card => ({ rank: c.rank, suit: suit(c.suit) });
        const seat = (s: number) => (s + r) % 4;
        const entries = (xs: PlayerObservation['currentRound']) => xs.map(x => ({ seat: seat(x.seat), card: card(x.card) }));
        const transformed: PlayerObservation = {
          ...obs, seat: seat(obs.seat), ownHand: obs.ownHand.map(card).reverse(),
          declarer: seat(obs.declarer), leader: seat(obs.leader), trump: suit(obs.trump),
          handCounts: Array.from({ length: 4 }, (_, i) => obs.handCounts[(i - r + 4) % 4]),
          currentRound: entries(obs.currentRound),
          completedRounds: obs.completedRounds.map(round => ({ ...round, winner: seat(round.winner), cards: entries(round.cards) })),
          voidSuits: Array.from({ length: 4 }, (_, i) => obs.voidSuits[(i - r + 4) % 4].map(suit).reverse()),
          knownBuriedCards: obs.knownBuriedCards?.map(card).reverse(),
          revealedHand: obs.revealedHand ? { seat: seat(obs.revealedHand.seat), cards: obs.revealedHand.cards.map(card).reverse() } : undefined,
        };
        // 保留同一 definition，确认规范型使用实际执行的 setup 观察。
        expect(getScenarioCanonicalKey({ ...base, setup: () => ({ seat: transformed.seat, observation: transformed }) })).toBe(key);
      }
    }
  });

  it('规范型不受其他座位暗牌排列与未知底牌排列影响', () => {
    const changed = { ...sampleTrump, setup: () => {
      const result = sampleTrump.setup();
      result.state!.hands[(result.seat + 1) % 4].reverse();
      result.state!.kitty.reverse();
      return result;
    } };
    expect(areScenariosEquivalent(sampleTrump, changed)).toBe(true);
  });
});
