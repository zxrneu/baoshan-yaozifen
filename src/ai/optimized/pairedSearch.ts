/** 搜索协调器依赖采样、评估、兜底与残局接口；不实现牌局生成或走牌规则。 */
import { cardId } from '../../cards';
import {
  CardSelector, DEFAULT_OPTIMIZED_BUDGET, ObservationPolicy, OptimizedBudget,
  PlayerObservation, RandomSource, SearchDecision, WorldEvaluator, WorldSourceFactory,
} from './contracts';
import {
  BudgetExceededError, deadlineGuard, independentSearchRandom, InconsistentObservationError,
} from './computation';
import { EndgameSolver } from './endgame';
import { legalObservationCards } from './observation';
import { lockedWinner } from './simulator';
import { comparisonFor, PairedStatistics } from './statistics';

export interface SearchDependencies {
  readonly worlds: WorldSourceFactory;
  readonly evaluator: WorldEvaluator;
  readonly fallback: ObservationPolicy;
  readonly endgame?: EndgameSolver;
  readonly random?: () => RandomSource;
  readonly now?: () => number;
}

export function searchCheckpoints(minimum: number, maximum: number): number[] {
  const result: number[] = [];
  for (let n = Math.min(minimum, maximum); n < maximum; n *= 2) result.push(n);
  result.push(maximum);
  return result;
}

export class PairedCardSelector implements CardSelector {
  private readonly budget: OptimizedBudget;

  constructor(private readonly dependencies: SearchDependencies, budget: Partial<OptimizedBudget> = {}) {
    this.budget = { ...DEFAULT_OPTIMIZED_BUDGET, ...budget };
    const b = this.budget;
    if (![b.minWorlds, b.maxWorlds, b.endgameWorldLimit, b.endgameCardLimit, b.endgameNodeLimit]
      .every((n) => Number.isInteger(n) && n >= 0)
      || b.minWorlds < 1 || b.maxWorlds < 1 || !(b.timeLimitMs >= 0)
      || !(b.errorProbability > 0 && b.errorProbability < 1)) throw new RangeError('非法搜索预算');
  }

  choose(observation: PlayerObservation): SearchDecision {
    const now = this.dependencies.now ?? (() => performance.now());
    const start = now();
    const guard = deadlineGuard(now, start + this.budget.timeLimitMs);
    const legal = legalObservationCards(observation);
    if (legal.length === 0) throw new Error('当前玩家没有合法出牌');
    const suggested = this.dependencies.fallback.chooseCard(observation);
    const fallback = legal.find((card) => cardId(card) === cardId(suggested)) ?? legal[0];
    const basic = (status: SearchDecision['status'], diagnostic?: string): SearchDecision => ({
      card: fallback, status, moves: [], comparisons: [], worlds: 0,
      elapsedMs: now() - start, ...(diagnostic ? { diagnostic } : {}),
    });
    if (legal.length === 1) return { ...basic('only-move'), card: legal[0] };
    if (lockedWinner(observation) !== undefined) return basic('locked');
    let committed: SearchDecision | undefined;
    try {
      guard.check();
      const source = this.dependencies.worlds.create(observation, guard);
      if (this.dependencies.endgame) {
        // 留出预算给普通模拟；残局未完成不会污染配对统计。
        const endgameDeadline = Math.min(start + this.budget.timeLimitMs, now() + Math.min(50, this.budget.timeLimitMs / 4));
        const exact = this.dependencies.endgame.solve(observation, source, deadlineGuard(now, endgameDeadline));
        if (exact) return { ...exact, elapsedMs: now() - start };
      }
      const random = (this.dependencies.random ?? independentSearchRandom)();
      const checkpoints = searchCheckpoints(this.budget.minWorlds, this.budget.maxWorlds);
      let active = new Set(legal.map(cardId));
      let stats = new PairedStatistics(legal);
      let completedWorlds = 0;
      for (const target of checkpoints) {
        const pending = stats.copy();
        for (let w = completedWorlds; w < target; w++) {
          guard.check();
          const world = source.sample(random, guard);
          const row = new Map<string, 0 | 1>();
          for (const card of legal) {
            if (!active.has(cardId(card))) continue;
            guard.check();
            row.set(cardId(card), this.dependencies.evaluator.evaluate(observation, world, card, guard));
          }
          guard.check();
          pending.record(row);
        }
        stats = pending;
        completedWorlds = target;
        const comparisons = stats.comparisons(checkpoints.length, this.budget.errorProbability);
        const survivors = new Set(active);
        for (const a of active) {
          if (this.budget.conservative && a === cardId(fallback)) continue;
          if ([...active].some((b) => a !== b && (comparisonFor(comparisons, a, b)?.upper ?? 1) < 0)) survivors.delete(a);
        }
        active = survivors;
        const moves = stats.estimates(active);
        const ranked = moves.filter((move) => move.active).sort((a, b) => b.winRate - a.winRate
          || Number(cardId(b.card) === cardId(fallback)) - Number(cardId(a.card) === cardId(fallback)));
        let card = ranked[0].card;
        if (this.budget.conservative && cardId(card) !== cardId(fallback)
          && (comparisonFor(comparisons, cardId(card), cardId(fallback))?.lower ?? -1) <= 0) card = fallback;
        const separated = [...active].every((other) => other === cardId(card)
          || (comparisonFor(comparisons, cardId(card), other)?.lower ?? -1) > 0);
        committed = {
          card, status: separated ? 'separated' : 'budget', moves, comparisons,
          worlds: target, elapsedMs: now() - start,
        };
        if (separated) return committed;
      }
      return committed!;
    } catch (error) {
      if (error instanceof BudgetExceededError) return committed
        ? { ...committed, elapsedMs: now() - start } : basic('fallback', '预算不足以完成共同热身');
      if (error instanceof InconsistentObservationError) return basic('inconsistent', error.message);
      throw error;
    }
  }
}
