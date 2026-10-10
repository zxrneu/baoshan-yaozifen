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
  INDEX_TO_SUIT,
  SUIT_INDEX,
} from './types';

export interface MoveEvaluation {
  card: Card;
  /** 胜率 (0..1) */
  winRate: number;
  /** 期望平均得分 (0..100) */
  expectedPoints: number;
  /** 评估世界样本数 */
  samples: number;
}

export interface BridgePimcDecision {
  card: Card;
  winRate: number;
  moves: MoveEvaluation[];
  worldsEvaluated: number;
  elapsedMs: number;
  diagnostic: string;
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

    // 唯一候选直接返回
    if (candidates.length === 1) {
      return {
        card: candidates[0],
        winRate: 1,
        moves: [{ card: candidates[0], winRate: 1, expectedPoints: 0, samples: 0 }],
        worldsEvaluated: 0,
        elapsedMs: 0,
        diagnostic: '唯一合法候选直接出牌',
      };
    }

    // 快速战术建议作为基线与兜底
    const heuristicAdvice = evaluateBridgeTactics(observation, candidates);
    const fallbackCard = heuristicAdvice.card;

    const deadline = started + this.config.timeLimitMs;
    const now = () => performance.now();
    const guard = deadlineGuard(now, deadline);

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
    const candidateMap = new Map<string, { card: Card; wins: number; totalPts: number; count: number }>();
    for (const c of candidates) {
      candidateMap.set(cardId(c), { card: c, wins: 0, totalPts: 0, count: 0 });
    }

    let worldsCount = 0;
    const random = independentSearchRandom();

    try {
      const source = this.worldsFactory.create(observation, guard);

      for (let w = 0; w < this.config.maxWorlds; w++) {
        if (signal?.aborted) break;
        guard.check();

        // 采样一个暗牌分布世界
        const world: HiddenWorld = source.sample(random, guard);
        const dealBb = dealToBitboard(world.hands);

        // 如果是中残局，使用全局精确求解；前中盘使用深度限制（如 2~3 轮前瞻）
        const ddsOptions = isEndgame
          ? { maxDepth: 0, nodeLimit: 8000 }
          : { maxDepth: 2, nodeLimit: 2000 };

        // 求解此世界中当前第一手的各候选牌得分
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
              }
            }
          }
        } else {
          // 兜底单结果
          const decWon = ddsResult.declarerWon;
          const iWon = isDeclarerSide ? decWon : !decWon;
          for (const item of candidateMap.values()) {
            item.wins += iWon ? 1 : 0;
            item.totalPts += ddsResult.declarerPoints;
            item.count++;
          }
        }

        // 达到最小采样世界数后，可做早停检查
        if (w >= this.config.minWorlds && now() >= deadline - 30) {
          break;
        }
      }
    } catch (e) {
      // 超时或中断，安全使用已有样本
    }

    // 汇总各候选牌胜率
    const moves: MoveEvaluation[] = [];
    for (const item of candidateMap.values()) {
      const samples = Math.max(1, item.count);
      moves.push({
        card: item.card,
        winRate: item.count > 0 ? item.wins / samples : 0.5,
        expectedPoints: item.count > 0 ? item.totalPts / samples : 50,
        samples: item.count,
      });
    }

    // 排序：胜率最高者优先，平局以期望得分高或专家规则建议打破
    moves.sort((a, b) => {
      const diff = b.winRate - a.winRate;
      if (Math.abs(diff) > 0.05) return diff;
      if (cardId(a.card) === cardId(fallbackCard)) return -1;
      if (cardId(b.card) === cardId(fallbackCard)) return 1;
      return b.expectedPoints - a.expectedPoints;
    });

    const bestMove = moves[0] ?? { card: fallbackCard, winRate: 0.5, expectedPoints: 50, samples: 0 };
    const elapsedMs = performance.now() - started;

    return {
      card: bestMove.card,
      winRate: bestMove.winRate,
      moves,
      worldsEvaluated: worldsCount,
      elapsedMs,
      diagnostic: `DDS-PIMC深度思考[${isEndgame ? '残局精准' : '前瞻搜索'}]: 采样 ${worldsCount} 世界, 胜率 ${(bestMove.winRate * 100).toFixed(1)}%, 战术: ${heuristicAdvice.intent}`,
    };
  }
}
