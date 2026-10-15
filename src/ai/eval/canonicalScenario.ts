/**
 * 评估场景等价变换族与规范型计算模块 (src/ai/eval/canonicalScenario.ts)。
 * 遵循单一职责原则 (SRP) 与开闭原则 (OCP)，
 * 实现保山幺子分评测场景在四人座位旋转 (0..3) 与四花色置换群 (S4) 下的同构归一化，
 * 用于防过拟合检验、跨集合（开发集与保留集）完全独立性审计及样本去重。
 */
import { EvalScenario, ScenarioDefinition } from './types';
import { Card, Suit } from '../../cards';
import { DecisionObservation, observeDecision, sanitizePlayerObservation } from '../decisionObservation';
import { PlayerObservation } from '../optimized/contracts';
import { loadScenarios } from './scenarioLoader';

const SUITS: readonly Suit[] = ['S', 'H', 'C', 'D'];

// 生成四花色置换群 S4 的全部 24 个排列映射
const PERMUTATIONS: Array<Record<Suit, Suit>> = (() => {
  const result: Array<Record<Suit, Suit>> = [];
  const permute = (arr: Suit[], m: Suit[] = []) => {
    if (arr.length === 0) {
      const mapping = {} as Record<Suit, Suit>;
      SUITS.forEach((s, idx) => {
        mapping[s] = m[idx];
      });
      result.push(mapping);
    } else {
      for (let i = 0; i < arr.length; i++) {
        const curr = arr.slice();
        const next = curr.splice(i, 1);
        permute(curr.slice(), m.concat(next));
      }
    }
  };
  permute([...SUITS]);
  return result;
})();

/** 使用与运行器相同的观察投影，统一默认值、历史推导和信息可见性。 */
function getObservation(input: EvalScenario | ScenarioDefinition): DecisionObservation {
  const scenario = 'expectedCriteria' in input ? input : loadScenarios([input])[0];
  const { state, observation, seat } = scenario.setup();
  if (observation) return { phase: 'playing', ...sanitizePlayerObservation(observation) };
  if (state) return observeDecision(state, seat);
  throw new Error(`场景 ${scenario.id} 没有决策观察`);
}

/** 只对可见信息做变换；手牌、绝门按集合归一化，出牌和叫分顺序保持不变。 */
function transformObservation(
  obs: DecisionObservation,
  r: number,
  pi: Record<Suit, Suit>,
): Record<string, unknown> {
  const seat = (value: number) => (value + r) % 4;
  const card = (value: Card) => `${value.rank}${pi[value.suit]}`;
  const hand = (values: readonly Card[]) => values.map(card).sort();
  const entries = (values: PlayerObservation['currentRound']) =>
    values.map(entry => ({ seat: seat(entry.seat), card: card(entry.card) }));
  const rotate = <T>(values: readonly T[]) => Array.from({ length: 4 }, (_, i) => values[(i - r + 4) % 4]);
  const base = {
    phase: obs.phase, seat: seat(obs.seat), ownHand: hand(obs.ownHand),
    handCounts: rotate(obs.handCounts), kittySize: obs.kittySize, ruleId: obs.ruleId,
  };
  switch (obs.phase) {
    case 'bidding': return {
      ...base, highestBid: obs.highestBid,
      highestBidder: obs.highestBidder === null ? null : seat(obs.highestBidder),
      legalBids: [...obs.legalBids],
      bidHistory: obs.bidHistory.map(note => ({ seat: seat(note.seat), bid: note.bid })),
      minBid: obs.minBid, maxBid: obs.maxBid, bidStep: obs.bidStep,
    };
    case 'trump': return { ...base, winningBid: obs.winningBid };
    case 'bury': return { ...base, trump: pi[obs.trump] };
    case 'playing': return {
      ...base, trump: pi[obs.trump], declarer: seat(obs.declarer), leader: seat(obs.leader),
      roundNumber: obs.roundNumber, bid: obs.bid,
      declarerPoints: obs.declarerPoints, defenderPoints: obs.defenderPoints,
      currentRound: entries(obs.currentRound),
      completedRounds: obs.completedRounds.map(round => ({
        trickNumber: round.trickNumber, winner: seat(round.winner), points: round.points,
        cards: entries(round.cards),
      })),
      voidSuits: rotate(obs.voidSuits).map(voids => [...new Set(voids.map(suit => pi[suit]))].sort()),
      knownBuriedCards: hand(obs.knownBuriedCards ?? []),
      revealedHand: obs.revealedHand
        ? { seat: seat(obs.revealedHand.seat), cards: hand(obs.revealedHand.cards) } : null,
    };
  }
}

/**
 * 计算给定场景在所有 96 种等价变换 (4 座位旋转 × 24 花色置换) 下的字典序最小规范型 Key。
 * 两个场景若互为同构变换（换皮/旋转/置换花色），其 Canonical Key 严格相等。
 */
export function getScenarioCanonicalKey(scenario: EvalScenario | ScenarioDefinition): string {
  const observation = getObservation(scenario);
  let minKey: string | null = null;

  for (let r = 0; r < 4; r++) {
    for (const pi of PERMUTATIONS) {
      const transformed = transformObservation(observation, r, pi);
      const serialized = JSON.stringify(transformed);
      if (minKey === null || serialized < minKey) {
        minKey = serialized;
      }
    }
  }

  return minKey!;
}

/**
 * 严格判断两个场景在等价变换族（座位旋转 + 花色置换）下是否同构等价。
 */
export function areScenariosEquivalent(
  s1: EvalScenario | ScenarioDefinition,
  s2: EvalScenario | ScenarioDefinition,
): boolean {
  return getScenarioCanonicalKey(s1) === getScenarioCanonicalKey(s2);
}
