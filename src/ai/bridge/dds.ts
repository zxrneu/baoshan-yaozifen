/**
 * 完美信息双明手求解器 (Double Dummy Solver, DDS)。
 * 遵循 SOLID 原则：
 * - S: 只负责已知全明牌手牌分布下的博弈树极小化极大 (Minimax) 与 Alpha-Beta 剪枝求解；
 * - O: 求解接口可扩展，支持自定义置换表大小、深度限制与启发式评估；
 * - L: 任何求解实现均保证在合法牌局下返回合法博弈论值；
 * - I: 暴露精简的 DoubleDummySolver 接口；
 * - D: 高层调用依赖 DoubleDummySolver 抽象接口。
 */
import { sideOf } from '../../engine';
import {
  bitboardLegalMoves,
  bitboardTrickWinner,
  cloneDeal,
  popcount,
} from './bitboard';
import { DealBitboard, DdsOptions } from './types';

export interface DdsResult {
  /** 庄家方在双明手最优对抗下的期望总得分 (0..100) */
  declarerPoints: number;
  /** 庄家方是否达成叫分目标 */
  declarerWon: boolean;
  /** 推荐的首发牌（当且仅当当前处于某轮第一手领出时有效） */
  bestMove?: { suitIdx: number; rankVal: number };
  /** 各合法第一手候选牌的博弈论得分 */
  moveScores?: { suitIdx: number; rankVal: number; score: number }[];
  /** 遍历节点数 */
  nodes: number;
  /** 终止原因 */
  status: 'exact' | 'target_cutoff' | 'node_limit' | 'depth_limit';
}

/**
 * 双明手求解器抽象接口 (ISP / DIP)
 */
export interface DoubleDummySolver {
  solve(
    deal: DealBitboard,
    trumpIdx: number,
    leader: number,
    declarerSide: number,
    bid: number,
    currentPoints: [number, number],
    options?: DdsOptions,
  ): DdsResult;
}

/**
 * 经典 Alpha-Beta 双明手求解器实现
 */
export class AlphaBetaDdsSolver implements DoubleDummySolver {
  private static readonly DEFAULT_NODE_LIMIT = 50000;
  private readonly defaultNodeLimit: number;

  constructor(nodeLimit = AlphaBetaDdsSolver.DEFAULT_NODE_LIMIT) {
    this.defaultNodeLimit = nodeLimit;
  }

  solve(
    deal: DealBitboard,
    trumpIdx: number,
    leader: number,
    declarerSide: number,
    bid: number,
    currentPoints: [number, number],
    options: DdsOptions = {},
  ): DdsResult {
    const nodeLimit = options.nodeLimit ?? this.defaultNodeLimit;
    const maxDepth = options.maxDepth ?? 0; // 0 表示不限深度穷举
    let nodes = 0;
    let hitNodeLimit = false;

    // 置换表缓存：键 -> { score, flag } (0=EXACT, 1=LOWER, 2=UPPER)
    const tt = options.useTransposition !== false ? new Map<string, { score: number; flag: 0 | 1 | 2 }>() : null;

    const workingDeal = cloneDeal(deal);
    const currentTrick: { seat: number; suitIdx: number; rankVal: number }[] = [];

    const ttKey = (
      trick: readonly { seat: number; suitIdx: number; rankVal: number }[],
      turn: number,
      pts: readonly [number, number],
    ): string => {
      // 快速哈希键：16个花色掩码 + 轮内牌 + 当前双方累积得分（消除中间数组 join 内存分配）
      let k = `${turn}:${workingDeal[0][0]},${workingDeal[0][1]},${workingDeal[0][2]},${workingDeal[0][3]}|${workingDeal[1][0]},${workingDeal[1][1]},${workingDeal[1][2]},${workingDeal[1][3]}|${workingDeal[2][0]},${workingDeal[2][1]},${workingDeal[2][2]},${workingDeal[2][3]}|${workingDeal[3][0]},${workingDeal[3][1]},${workingDeal[3][2]},${workingDeal[3][3]}@${pts[0]},${pts[1]}`;
      if (trick.length > 0) {
        k += '#' + trick.map((t) => `${t.seat},${t.suitIdx},${t.rankVal}`).join(';');
      }
      return k;
    };

    /**
     * Alpha-Beta 递归函数
     * 返回：以庄家方视角评估的最终得分
     */
    const alphabeta = (
      trick: { seat: number; suitIdx: number; rankVal: number }[],
      trickLeader: number,
      pts: [number, number],
      alpha: number,
      beta: number,
      depth: number,
    ): number => {
      nodes++;
      if (nodes >= nodeLimit) {
        hitNodeLimit = true;
        return pts[0];
      }

      // 获胜线硬截断 (Target Pruning)
      // 1. 庄家方吃分已达标
      if (pts[0] >= bid) return 100;
      // 2. 闲家方吃分已达标（庄家无法成局）
      if (pts[1] >= 105 - bid) return 0;

      // 一轮四家出牌结束
      if (trick.length === 4) {
        const { winnerSeat, points } = bitboardTrickWinner(trick, trumpIdx);
        const winSide = sideOf(winnerSeat);
        const nextPts: [number, number] =
          winSide === declarerSide
            ? [pts[0] + points, pts[1]]
            : [pts[0], pts[1] + points];

        // 检查全局是否出尽手牌
        const remaining =
          popcount(workingDeal[0][0]) +
          popcount(workingDeal[0][1]) +
          popcount(workingDeal[0][2]) +
          popcount(workingDeal[0][3]);

        if (remaining === 0) return nextPts[0];

        // 深度限制截断
        if (maxDepth > 0 && depth >= maxDepth) return nextPts[0];

        // 递归进入下一轮
        return alphabeta([], winnerSeat, nextPts, alpha, beta, depth + 1);
      }

      const actor = (trickLeader + trick.length) % 4;
      const actorSide = sideOf(actor);
      const isMaximizer = actorSide === declarerSide;

      // 置换表查找与边界校验 (Exact / Lower / Upper Bound)
      const key = tt ? ttKey(trick, actor, pts) : '';
      if (tt) {
        const entry = tt.get(key);
        if (entry) {
          if (entry.flag === 0) {
            return entry.score; // 精确值直接命中返回
          } else if (entry.flag === 1) {
            // 下界 (beta cutoff)
            if (entry.score >= beta) return entry.score;
            if (entry.score > alpha) alpha = entry.score;
          } else if (entry.flag === 2) {
            // 上界 (alpha cutoff)
            if (entry.score <= alpha) return entry.score;
            if (entry.score < beta) beta = entry.score;
          }
          if (alpha >= beta) return entry.score;
        }
      }

      const origAlpha = alpha;
      const origBeta = beta;
      const ledSuit = trick.length > 0 ? trick[0].suitIdx : -1;
      const legalGroups = bitboardLegalMoves(workingDeal[actor], ledSuit);

      let bestVal = isMaximizer ? -Infinity : Infinity;

      // 提取所有合法出牌
      const legalCards: { suitIdx: number; rankVal: number }[] = [];
      for (let g = 0; g < legalGroups.length; g++) {
        const { suitIdx, mask } = legalGroups[g];
        let m = mask;
        while (m > 0) {
          const lsb = m & -m;
          const r = 31 - Math.clz32(lsb);
          legalCards.push({ suitIdx, rankVal: r });
          m ^= lsb;
        }
      }

      // 启发式走步排序 (Move Ordering)：
      // 极大化者优先探索大牌/分牌；极小化者优先探索破坏庄家吃分的打法
      legalCards.sort((a, b) => {
        const aTrump = a.suitIdx === trumpIdx ? 1 : 0;
        const bTrump = b.suitIdx === trumpIdx ? 1 : 0;
        if (aTrump !== bTrump) return isMaximizer ? bTrump - aTrump : aTrump - bTrump;
        return isMaximizer ? b.rankVal - a.rankVal : a.rankVal - b.rankVal;
      });

      for (let i = 0; i < legalCards.length; i++) {
        const c = legalCards[i];
        // 执行动作
        workingDeal[actor][c.suitIdx] ^= 1 << c.rankVal;
        trick.push({ seat: actor, suitIdx: c.suitIdx, rankVal: c.rankVal });

        const val = alphabeta(trick, trickLeader, pts, alpha, beta, depth);

        // 回溯
        trick.pop();
        workingDeal[actor][c.suitIdx] ^= 1 << c.rankVal;

        if (isMaximizer) {
          if (val > bestVal) bestVal = val;
          if (bestVal > alpha) alpha = bestVal;
        } else {
          if (val < bestVal) bestVal = val;
          if (bestVal < beta) beta = bestVal;
        }

        if (beta <= alpha) {
          break; // Alpha-Beta 剪枝
        }
      }

      // 存入射频置换表，根据与原始窗口的关系严格区分精确值与上下界
      if (tt && !hitNodeLimit) {
        let flag: 0 | 1 | 2;
        if (bestVal <= origAlpha) {
          flag = 2; // UPPER BOUND
        } else if (bestVal >= origBeta) {
          flag = 1; // LOWER BOUND
        } else {
          flag = 0; // EXACT
        }
        tt.set(key, { score: bestVal, flag });
      }

      return bestVal;
    };

    // 根节点求解当前轮第一手的所有合法候选牌
    const actor = (leader + currentTrick.length) % 4;
    const actorSide = sideOf(actor);
    const isMaximizer = actorSide === declarerSide;

    const ledSuit = currentTrick.length > 0 ? currentTrick[0].suitIdx : -1;
    const legalGroups = bitboardLegalMoves(workingDeal[actor], ledSuit);
    const rootCandidates: { suitIdx: number; rankVal: number }[] = [];

    for (let g = 0; g < legalGroups.length; g++) {
      const { suitIdx, mask } = legalGroups[g];
      let m = mask;
      while (m > 0) {
        const lsb = m & -m;
        const r = 31 - Math.clz32(lsb);
        rootCandidates.push({ suitIdx, rankVal: r });
        m ^= lsb;
      }
    }

    if (rootCandidates.length === 0) {
      return {
        declarerPoints: currentPoints[0],
        declarerWon: currentPoints[0] >= bid,
        nodes,
        status: 'exact',
      };
    }

    const moveScores: { suitIdx: number; rankVal: number; score: number }[] = [];
    let bestScore = isMaximizer ? -Infinity : Infinity;
    let bestMove = rootCandidates[0];

    let alpha = -Infinity;
    let beta = Infinity;

    for (const c of rootCandidates) {
      workingDeal[actor][c.suitIdx] ^= 1 << c.rankVal;
      currentTrick.push({ seat: actor, suitIdx: c.suitIdx, rankVal: c.rankVal });

      const score = alphabeta(currentTrick, leader, currentPoints, alpha, beta, 1);

      currentTrick.pop();
      workingDeal[actor][c.suitIdx] ^= 1 << c.rankVal;

      moveScores.push({ suitIdx: c.suitIdx, rankVal: c.rankVal, score });

      if (isMaximizer) {
        if (score > bestScore) {
          bestScore = score;
          bestMove = c;
        }
        if (bestScore > alpha) alpha = bestScore;
      } else {
        if (score < bestScore) {
          bestScore = score;
          bestMove = c;
        }
        if (bestScore < beta) beta = bestScore;
      }
    }

    return {
      declarerPoints: bestScore,
      declarerWon: bestScore >= bid,
      bestMove,
      moveScores,
      nodes,
      status: hitNodeLimit ? 'node_limit' : 'exact',
    };
  }
}
