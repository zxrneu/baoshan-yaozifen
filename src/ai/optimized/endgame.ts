/** 枚举小信念状态；只有当前玩家优化未来动作，其他座位按各自观察策略行动。 */
import { Card, cardId } from '../../cards';
import { sideOf } from '../../engine';
import {
  ComputationGuard, EnumerableWorldSource, ObservationPolicy, PlayerObservation,
  SearchDecision, WorldSource,
} from './contracts';
import { BudgetExceededError } from './computation';
import { canonicalCards, legalObservationCards, observationKey } from './observation';
import {
  advanceSimulation, cloneSimulation, createSimulation, lockedWinner,
  observeSimulation, simulationSeat, SimulationState,
} from './simulator';

export interface EndgameSolver {
  solve(observation: PlayerObservation, source: WorldSource, guard: ComputationGuard): SearchDecision | undefined;
}
class EndgameNodeLimit extends Error {}

function canEnumerate(source: WorldSource): source is EnumerableWorldSource {
  return 'count' in source && 'enumerate' in source && typeof source.enumerate === 'function';
}

export class BeliefEndgameSolver implements EndgameSolver {
  constructor(
    private readonly policy: ObservationPolicy,
    private readonly worldLimit: number,
    private readonly cardLimit: number,
    private readonly nodeLimit: number,
  ) {}

  solve(observation: PlayerObservation, source: WorldSource, guard: ComputationGuard): SearchDecision | undefined {
    if (!canEnumerate(source) || observation.handCounts.reduce((sum, n) => sum + n, 0) > this.cardLimit
      || source.count > BigInt(this.worldLimit) || this.nodeLimit <= 0) return undefined;
    try {
      const worlds = source.enumerate(this.worldLimit, guard);
      if (!worlds?.length) return undefined;
      const states = worlds.map((world) => createSimulation(observation, world));
      const memo = new Map<string, number>();
      let nodes = 0;
      const splitValue = (next: SimulationState[]): number => {
        const groups = new Map<string, SimulationState[]>();
        for (const state of next) {
          guard.check();
          const key = observationKey(observeSimulation(state, observation.seat));
          const group = groups.get(key) ?? [];
          group.push(state);
          groups.set(key, group);
        }
        let expected = 0;
        for (const group of groups.values()) expected += group.length / next.length * value(group);
        return expected;
      };
      const afterAction = (belief: SimulationState[], card: Card): number => splitValue(belief.map((state) => {
        const next = cloneSimulation(state);
        advanceSimulation(next, card);
        return next;
      }));
      const value = (belief: SimulationState[]): number => {
        guard.check();
        if (++nodes > this.nodeLimit) throw new EndgameNodeLimit();
        const first = belief[0];
        const winner = lockedWinner(first);
        if (winner !== undefined) return winner === sideOf(observation.seat) ? 1 : 0;
        if (first.hands.every((hand) => hand.length === 0)) throw new Error('残局终局分数不守恒');
        const key = observationKey(observeSimulation(first, observation.seat)) + '|' + belief.map((state) =>
          state.hands.map((hand) => canonicalCards(hand).map(cardId).join(',')).join('/')
          + ':' + canonicalCards(state.kitty).map(cardId).join(',')).sort().join(';');
        const cached = memo.get(key);
        if (cached !== undefined) return cached;
        const actor = simulationSeat(first);
        let result: number;
        if (actor === observation.seat) {
          const legal = legalObservationCards(observeSimulation(first, actor));
          result = Math.max(...legal.map((card) => afterAction(belief, card)));
        } else {
          // 同一根节点观察下的各个暗牌，按行动者自己的观察选择，再按可观察结果分组。
          result = splitValue(belief.map((state) => {
            guard.check();
            const next = cloneSimulation(state);
            const card = this.policy.chooseCard(observeSimulation(next, actor));
            advanceSimulation(next, card);
            return next;
          }));
        }
        memo.set(key, result);
        return result;
      };
      const fallback = this.policy.chooseCard(observation);
      const moves = legalObservationCards(observation).map((card) => ({
        card, winRate: afterAction(states, card), samples: worlds.length, active: true,
      }));
      moves.sort((a, b) => b.winRate - a.winRate
        || Number(cardId(b.card) === cardId(fallback)) - Number(cardId(a.card) === cardId(fallback)));
      return { card: moves[0].card, status: 'exact', moves, comparisons: [], worlds: worlds.length, elapsedMs: 0 };
    } catch (error) {
      if (error instanceof BudgetExceededError || error instanceof EndgameNodeLimit) return undefined;
      throw error;
    }
  }
}
