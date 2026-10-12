/**
 * 桥牌完美信息蒙特卡洛主引擎 (Bridge PIMC Engine)。
 * 严格遵循 SOLID 原则：
 * - S: 只负责基于可能世界的蒙特卡洛采样、DDS博弈树评估与胜率统计聚合；
 * - O: 可注入不同的采样器工厂、DDS 求解器与思考预算配置；
 * - L: 稳定输出各候选牌的评估赢副率；
 * - I: 暴露清晰的异步评估接口；
 * - D: 依赖 WorldSourceFactory 与 DoubleDummySolver 抽象接口。
 */
import { Card, cardId, cardValue } from '../../cards';
import { sideOf } from '../../engine';
import {
  HiddenWorld,
  PlayerObservation,
  WorldSourceFactory,
} from '../optimized/contracts';
import {
  deadlineGuard,
  independentSearchRandom,
} from '../optimized/computation';
import { constrainedWorldFactory } from '../optimized/belief';
import { dealToBitboard } from './bitboard';
import { AlphaBetaDdsSolver, DoubleDummySolver } from './dds';
import { evaluateBridgeTactics } from './heuristics';
import {
  BridgeThinkingConfig,
  DEFAULT_DEEP_THINKING_CONFIG,
  DdsOptions,
  INDEX_TO_SUIT,
  SUIT_INDEX,
} from './types';

/**
 * 无有效样本时的中性基线。
 * 语义明确为「未评估」，既不宣称必胜也不宣称必败；与之配套的期望得分取满分的一半。
 */
const FORCED_BASELINE_WIN_RATE = 0.5;
const FORCED_BASELINE_EXPECTED_POINTS = 50;

/**
 * 已取消则抛出取消原因。
 *
 * 取消是**控制流信号**，不是「搜索失败」：既不能继续求解，也不能静默落回中性基线。
 * 抛出的原因由调用方 `bridgeEngine.chooseCard` 的 `signal?.aborted` 分支原样上抛，
 * 保证「用户已取消」不会被伪装成「AI 算完了只是没算好」。
 */
function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) {
    throw signal.reason ?? new Error('已取消');
  }
}

export interface MoveEvaluation {
  card: Card;
  /** 胜率 (0..1)。处于 forced 状态时为中性基线 0.5，不具决策含义。 */
  winRate: number;
  /** 期望平均得分 (0..100)。处于 forced 状态时为中性基线 50，不具决策含义。 */
  expectedPoints: number;
  /** 评估世界样本数 */
  samples: number;
  exactSamples?: number;
  rolloutSamples?: number;
  /**
   * 被迫出牌：该候选是唯一合法动作，未经搜索评估。
   * 置位时 winRate/expectedPoints 仅为中性基线，消费方不得将其解读为胜率结论。
   */
  forced?: boolean;
}

export interface BridgePimcDecision {
  card: Card;
  winRate: number;
  moves: MoveEvaluation[];
  worldsEvaluated: number;
  elapsedMs: number;
  diagnostic: string;
  searchStatusCounts?: Record<string, number>;
  /** 本次决策为被迫出牌（唯一合法候选），未做任何搜索评估。 */
  forced?: boolean;
  /**
   * 本次决策**完全未评估**：世界源头构造或暗牌采样失败（观察非法等）。
   *
   * 与 `forced` 语义严格区分：`forced` 是「唯一合法动作」这一**确定性结论**，
   * 而本标记是**异常**——没有采样、没有 DDS 求解，`winRate`/`expectedPoints`
   * 只是中性基线。消费方（引擎、决策日志、UI）不得把中性基线解读为搜索结论。
   */
  unevaluated?: boolean;
}

export class BridgePimcEvaluator {
  private readonly worldsFactory: WorldSourceFactory;
  private readonly ddsSolver: DoubleDummySolver;
  private readonly config: BridgeThinkingConfig;

  constructor(
    options: {
      worldsFactory?: WorldSourceFactory;
      ddsSolver?: DoubleDummySolver;
      config?: BridgeThinkingConfig;
    } = {},
  ) {
    this.worldsFactory = options.worldsFactory ?? constrainedWorldFactory;
    this.ddsSolver = options.ddsSolver ?? new AlphaBetaDdsSolver();
    this.config = options.config ?? DEFAULT_DEEP_THINKING_CONFIG;
  }

  async evaluate(
    observation: PlayerObservation,
    candidates: readonly Card[],
    signal?: AbortSignal,
  ): Promise<BridgePimcDecision> {
    const started = performance.now();
    if (candidates.length === 0) throw new Error('候选牌集不能为空');

    // 唯一候选：被迫出牌。没有采样、没有 DDS 求解，故绝不能伪称必胜。
    // winRate/expectedPoints 取中性基线（与本文件 item.count === 0 分支同惯例），
    // 真正的语义由 forced 标记承载：这是「只能打这张」，不是「打了必胜」。
    if (candidates.length === 1) {
      return {
        card: candidates[0],
        winRate: FORCED_BASELINE_WIN_RATE,
        moves: [{
          card: candidates[0],
          winRate: FORCED_BASELINE_WIN_RATE,
          expectedPoints: FORCED_BASELINE_EXPECTED_POINTS,
          samples: 0,
          forced: true,
        }],
        worldsEvaluated: 0,
        elapsedMs: 0,
        forced: true,
        diagnostic: '唯一合法候选直接出牌（被迫出牌，无搜索评估）',
      };
    }

    // 快速战术建议作为基线与兜底
    const heuristicAdvice = evaluateBridgeTactics(observation, candidates);
    const fallbackCard = heuristicAdvice.card;

    const deadline = started + this.config.timeLimitMs;
    const now = () => performance.now();
    const guard = deadlineGuard(now, deadline);

    // 调用前已取消：必须抛出取消原因。既不能继续搜索，也不能静默返回一张牌
    // （否则上层 bridgeEngine 的 `if (signal?.aborted) throw error` 分支形同虚设）。
    throwIfAborted(signal);

    const trumpIdx = SUIT_INDEX[observation.trump];
    const declarerSide = sideOf(observation.declarer);
    const mySide = sideOf(observation.seat);
    const isDeclarerSide = mySide === declarerSide;
    const bid = observation.bid;
    const currentPoints: [number, number] = [
      observation.declarerPoints,
      observation.defenderPoints,
    ];

    // 计算当前剩余手牌张数
    const remainingCards = observation.ownHand.length;
    const isEndgame = remainingCards <= this.config.endgameCardLimit;

    // 候选牌统计跟踪
    const candidateMap = new Map<string, { card: Card; wins: number; totalPts: number; count: number; exact: number; rollout: number }>();
    for (const c of candidates) {
      candidateMap.set(cardId(c), { card: c, wins: 0, totalPts: 0, count: 0, exact: 0, rollout: 0 });
    }

    let worldsCount = 0;
    const searchStatusCounts: Record<string, number> = {};
    const random = independentSearchRandom();

    /**
     * 世界源头失败原因。置位表示「完全未评估」，与预算耗尽/取消严格区分：
     * - 预算耗尽（`deadlineGuard` 抛错）或达到 maxWorlds：已采样的世界仍有效，正常汇总；
     * - 世界源头构造/采样失败：一个世界都没建成，属于输入非法或内部异常，绝不能
     *   伪装成「评估出五五开」。
     */
    let worldFailure: string | undefined;

    try {
      const source = this.worldsFactory.create(observation, guard);

      for (let w = 0; w < this.config.maxWorlds; w++) {
        // 循环中途被取消：抛出原因（由下方 catch 的 signal?.aborted 分支原样上抛），
        // 而不是静默 break 后当成「预算耗尽」返回手中已有样本。
        throwIfAborted(signal);
        guard.check();

        // 采样一个暗牌分布世界
        const world: HiddenWorld = source.sample(random, guard);
        const dealBb = dealToBitboard(world.hands);

        // 映射当前墩已打出牌（保持顺时针领出顺序）
        const initialTrick = observation.currentRound.map((entry) => ({
          seat: entry.seat,
          suitIdx: SUIT_INDEX[entry.card.suit],
          rankVal: cardValue(entry.card),
        }));

        // 如果是中残局，使用全局精确求解；前中盘使用深度限制（如 2~3 轮前瞻）
        const ddsOptions: DdsOptions = {
          ...(isEndgame
            ? { maxDepth: 0, nodeLimit: 8000 }
            : { maxDepth: 2, nodeLimit: 2000 }),
          initialTrick,
          check: () => { guard.check(); if (signal?.aborted) throw signal.reason ?? new Error('已取消'); },
        };

        // 求解此世界中当前第一手/行动座位的各候选牌得分
        const ddsResult = this.ddsSolver.solve(
          dealBb,
          trumpIdx,
          observation.leader,
          declarerSide,
          bid,
          currentPoints,
          ddsOptions,
        );

        worldsCount++;
        searchStatusCounts[ddsResult.status] = (searchStatusCounts[ddsResult.status] ?? 0) + 1;

        if (ddsResult.moveScores && ddsResult.moveScores.length > 0) {
          for (const m of ddsResult.moveScores) {
            const suit = INDEX_TO_SUIT[m.suitIdx];
            for (const item of candidateMap.values()) {
              if (item.card.suit === suit && cardValue(item.card) === m.rankVal) {
                const decWon = m.score >= bid;
                const iWon = isDeclarerSide ? decWon : !decWon;
                item.wins += iWon ? 1 : 0;
                item.totalPts += m.score;
                item.count++;
                const status = m.status ?? ddsResult.status;
                if (status === 'exact' || status === 'target_cutoff') item.exact++;
                else item.rollout++;
              }
            }
          }
        }

        // 达到最小采样世界数后，可做早停检查
        if (w >= this.config.minWorlds && now() >= deadline - 30) {
          break;
        }
      }
    } catch (error) {
      if (signal?.aborted) throw error;
      // 采样预算耗尽（deadlineGuard 超时）或单世界求解异常：已采样世界仍然有效，
      // 安全使用已有样本继续汇总。真正的「零世界」失败在下方单独判定。
      worldFailure = error instanceof Error ? error.message : String(error);
    }

    // 一个世界都没建成 → 完全未评估。这既可能是观察非法（InconsistentObservationError），
    // 也可能是内部异常；无论哪种，都不能把中性基线伪装成搜索结论。
    const unevaluated = worldsCount === 0 && worldFailure !== undefined;

    // 汇总各候选牌胜率
    const moves: MoveEvaluation[] = [];
    for (const item of candidateMap.values()) {
      const samples = Math.max(1, item.count);
      moves.push({
        card: item.card,
        winRate: item.count > 0 ? item.wins / samples : FORCED_BASELINE_WIN_RATE,
        expectedPoints: item.count > 0 ? item.totalPts / samples : FORCED_BASELINE_EXPECTED_POINTS,
        samples: item.count,
        exactSamples: item.exact,
        rolloutSamples: item.rollout,
      });
    }

    // 排序：胜率最高者优先，平局以期望得分高或专家规则建议打破
    moves.sort((a, b) => {
      const diff = b.winRate - a.winRate;
      if (Math.abs(diff) > 0.05) return diff;
      if (cardId(a.card) === cardId(fallbackCard)) return -1;
      if (cardId(b.card) === cardId(fallbackCard)) return 1;
      return isDeclarerSide ? b.expectedPoints - a.expectedPoints : a.expectedPoints - b.expectedPoints;
    });

    const bestMove = moves[0] ?? { card: fallbackCard, winRate: FORCED_BASELINE_WIN_RATE, expectedPoints: FORCED_BASELINE_EXPECTED_POINTS, samples: 0 };
    const elapsedMs = performance.now() - started;
    const samplesDesc = moves
      .map((m) => `${m.card.rank}${m.card.suit}:${m.samples}w/${(m.winRate * 100).toFixed(0)}%`)
      .join(', ');

    const diagnostic = unevaluated
      ? `DDS-PIMC深度思考[${isEndgame ? '残局求解' : '前瞻搜索'}]: **未评估**（世界构造/采样失败，一个世界都未建成；${worldFailure}），已退化为专家规则建议，胜率/得分为中性基线非评估结论，战术: ${heuristicAdvice.intent}`
      : `DDS-PIMC深度思考[${isEndgame ? '残局求解' : '前瞻搜索'}]: 采样 ${worldsCount} 世界, 胜率 ${(bestMove.winRate * 100).toFixed(1)}%, 候选[${samplesDesc}], 停止原因 ${JSON.stringify(searchStatusCounts)}, 战术: ${heuristicAdvice.intent}`;

    return {
      card: bestMove.card,
      winRate: bestMove.winRate,
      moves,
      worldsEvaluated: worldsCount,
      elapsedMs,
      searchStatusCounts,
      ...(unevaluated ? { unevaluated: true } : {}),
      diagnostic,
    };
  }
}
