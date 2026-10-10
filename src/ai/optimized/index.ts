/** 组合根：默认实现只在这里装配，调用方可以替换小接口。 */
import { constrainedWorldFactory } from './belief';
import { DEFAULT_OPTIMIZED_BUDGET, OptimizedBudget, ObservationPolicy } from './contracts';
import { BeliefEndgameSolver } from './endgame';
import { PairedCardSelector, SearchDependencies } from './pairedSearch';
import { observationPolicy } from './policy';
import { BasicWorldEvaluator } from './simulator';

export * from './contracts';
export * from './computation';
export * from './observation';
export * from './belief';
export * from './policy';
export * from './simulator';
export * from './statistics';
export * from './endgame';
export * from './pairedSearch';

export interface OptimizedSelectorOptions {
  budget?: Partial<OptimizedBudget>;
  policy?: ObservationPolicy;
  dependencies?: Partial<SearchDependencies>;
}

export function createOptimizedSelector(options: OptimizedSelectorOptions = {}): PairedCardSelector {
  const budget = { ...DEFAULT_OPTIMIZED_BUDGET, ...options.budget };
  const policy = options.policy ?? observationPolicy;
  return new PairedCardSelector({
    worlds: constrainedWorldFactory,
    evaluator: new BasicWorldEvaluator(policy), fallback: policy,
    endgame: new BeliefEndgameSolver(policy, budget.endgameWorldLimit, budget.endgameCardLimit, budget.endgameNodeLimit),
    ...options.dependencies,
  }, budget);
}
