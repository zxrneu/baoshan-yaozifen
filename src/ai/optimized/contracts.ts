/** 小接口分别约束观察、采样、策略和模拟，搜索不依赖具体实现。 */
import { Card, Suit } from '../../cards';
import { CompletedTrick, TrickCard } from '../../engine';

export interface PlayerObservation {
  readonly seat: number;
  readonly ownHand: readonly Card[];
  /** 100 分扣底后公开的庄家搭档手牌；包含明牌玩家本人的观察。 */
  readonly revealedHand?: { readonly seat: number; readonly cards: readonly Card[] };
  readonly handCounts: readonly number[];
  readonly declarer: number;
  readonly bid: number;
  readonly trump: Suit;
  readonly leader: number;
  readonly roundNumber: number;
  readonly currentRound: readonly TrickCard[];
  readonly completedRounds: readonly CompletedTrick[];
  readonly voidSuits: readonly (readonly Suit[])[];
  readonly declarerPoints: number;
  readonly defenderPoints: number;
  readonly kittySize: number;
  readonly knownBuriedCards?: readonly Card[];
  readonly ruleId: 'basic-v1';
}

/** 提供均匀的 32 位随机数；生产与测试均使用独立于发牌的随机源。 */
export interface RandomSource { nextUint32(): number }
export interface ComputationGuard { check(): void }
/** 纯、确定性策略：相同观察必须返回同一张合法牌，不能保存牌局私有状态。 */
export interface ObservationPolicy { chooseCard(observation: PlayerObservation): Card }
export interface HiddenWorld {
  readonly hands: readonly (readonly Card[])[];
  readonly kitty: readonly Card[];
}
export interface WorldSource {
  /** 从本次搜索冻结的分布独立抽取；不修改观察或以前返回的样本。 */
  sample(random: RandomSource, guard: ComputationGuard): HiddenWorld;
}
export interface EnumerableWorldSource extends WorldSource {
  readonly count: bigint;
  /** 枚举均匀模型的全部唯一分配；超出 limit 返回 undefined。 */
  enumerate(limit: number, guard: ComputationGuard): HiddenWorld[] | undefined;
}
export interface WorldSourceFactory {
  create(observation: PlayerObservation, guard: ComputationGuard): WorldSource;
}
export interface WorldEvaluator {
  /** 同一观察、样本和候选的结果固定，不能修改输入；己方赢副为 1，否则为 0。 */
  evaluate(
    observation: PlayerObservation, world: HiddenWorld, card: Card,
    guard: ComputationGuard,
  ): 0 | 1;
}

export interface OptimizedBudget {
  readonly minWorlds: number;
  readonly maxWorlds: number;
  readonly timeLimitMs: number;
  readonly errorProbability: number;
  readonly conservative: boolean;
  readonly endgameWorldLimit: number;
  readonly endgameCardLimit: number;
  readonly endgameNodeLimit: number;
}
export interface MoveEstimate {
  readonly card: Card;
  readonly winRate: number;
  readonly samples: number;
  readonly active: boolean;
}
export interface PairEstimate {
  readonly a: string;
  readonly b: string;
  readonly samples: number;
  readonly difference: number;
  readonly lower: number;
  readonly upper: number;
}
export type DecisionStatus =
  | 'only-move' | 'locked' | 'budget' | 'separated' | 'inconsistent' | 'fallback' | 'exact';
export interface SearchDecision {
  readonly card: Card;
  readonly status: DecisionStatus;
  readonly moves: readonly MoveEstimate[];
  readonly comparisons: readonly PairEstimate[];
  readonly worlds: number;
  readonly elapsedMs: number;
  readonly diagnostic?: string;
}
export interface CardSelector { choose(observation: PlayerObservation): SearchDecision }
export interface AsyncCardSelector {
  choose(observation: PlayerObservation, signal?: AbortSignal): Promise<SearchDecision>;
}

export const DEFAULT_OPTIMIZED_BUDGET: OptimizedBudget = {
  minWorlds: 16, maxWorlds: 1024, timeLimitMs: 250, errorProbability: 0.05,
  conservative: true, endgameWorldLimit: 256, endgameCardLimit: 12, endgameNodeLimit: 5000,
};
export const FAST_OPTIMIZED_BUDGET: OptimizedBudget = {
  ...DEFAULT_OPTIMIZED_BUDGET, minWorlds: 8, maxWorlds: 32, timeLimitMs: 120,
  endgameNodeLimit: 2000,
};
