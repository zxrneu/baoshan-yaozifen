/**
 * 完美信息双明手求解器 (Double Dummy Solver, DDS)。
 * 遵循 SOLID 原则：
 * - S: 只负责已知全明牌手牌分布下的博弈树极小化极大 (Minimax) 与 Alpha-Beta 剪枝求解；
 * - O: 求解接口可扩展，支持自定义置换表大小、深度限制与启发式评估；
 * - L: 精确搜索返回博弈论值，限深/限节点搜索返回明确标注的续打估值；
 * - I: 暴露精简的 DoubleDummySolver 接口；
 * - D: 高层调用依赖 DoubleDummySolver 抽象接口。
 */
import { sideOf } from '@yaozifen/game-core';
import {
  bitboardLegalMoves,
  bitboardTrickWinner,
  cloneDeal,
  popcount,
} from './bitboard';
import { DealBitboard, DdsOptions } from './types';

export interface DdsResult {
  /** 庄家方终局得分 (0..100)，是否为精确值由 status 标明 */
  declarerPoints: number;
  /** 庄家方是否达成叫分目标 */
  declarerWon: boolean;
  /** 当前行动座位的推荐牌（支持正在进行的墩） */
  bestMove?: { suitIdx: number; rankVal: number };
  /** 当前合法候选牌的得分与精确/估计状态 */
  moveScores?: { suitIdx: number; rankVal: number; score: number; status?: DdsResult['status'] }[];
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
    let hitDepthLimit = false;
    let rootNodes = 0;
    let rootNodeLimit = nodeLimit;

    // 置换表缓存：键 -> { score, flag } (0=EXACT, 1=LOWER, 2=UPPER)
    const tt = options.useTransposition !== false ? new Map<string, { score: number; flag: 0 | 1 | 2 }>() : null;

    const workingDeal = cloneDeal(deal);
    const currentTrick: { seat: number; suitIdx: number; rankVal: number }[] =
      options.initialTrick && options.initialTrick.length > 0 ? [...options.initialTrick] : [];

    // 截断分只是中途累计分。复制叶节点并用快速策略续打至锁定胜负。
    // 续打是估计值，status 明确区分它与精确双明手求解。
    const rollout = (trick: typeof currentTrick, trickLeader: number, pts: [number, number]): number => {
      const hands = cloneDeal(workingDeal);
      let round = [...trick];
      let lead = trickLeader;
      const points: [number, number] = [...pts];
      for (let steps = 0; steps <= 52; steps++) {
        options.check?.();
        if (round.length === 4) {
          const result = bitboardTrickWinner(round, trumpIdx);
          points[sideOf(result.winnerSeat) === declarerSide ? 0 : 1] += result.points;
          lead = result.winnerSeat;
          round = [];
        }
        // 105 - bid 为闲家的【精确】锁定阈值（推导见 engine/game.ts 同类判定处注释：
        // 分牌分值恒为 5 的倍数 ⇒ D > 100 - bid 等价于 D >= 105 - bid）。
        // 该点是严格锁定下界，到达即闲家必胜，继续搜索结论不变，故此处剪枝安全。
        if (points[0] >= bid || points[1] >= 105 - bid) return points[0];
        const seat = (lead + round.length) % 4;
        const groups = bitboardLegalMoves(hands[seat], round[0]?.suitIdx ?? -1);
        let best: { suitIdx: number; rankVal: number } | undefined;
        let bestValue = -Infinity;
        for (const group of groups) {
          for (let mask = group.mask; mask > 0;) {
            const bit = mask & -mask;
            mask ^= bit;
            const rankVal = 31 - Math.clz32(bit);
            const card = { seat, suitIdx: group.suitIdx, rankVal };
            const cardPts = rankVal === 12 || rankVal === 8 ? 10 : rankVal === 3 ? 5 : 0;
            let value: number;
            if (round.length) {
              const result = bitboardTrickWinner([...round, card], trumpIdx);
              const friendly = sideOf(result.winnerSeat) === sideOf(seat);
              value = (friendly ? 1 : -1) * result.points * 3 - rankVal * 0.15
                - (group.suitIdx === trumpIdx ? 2 : 0);
            } else {
              const higher = hands.some((hand, other) => other !== seat && (hand[group.suitIdx] >>> (rankVal + 1)) > 0);
              value = (!higher ? 20 + cardPts : 0) - rankVal * 0.15;
            }
            if (value > bestValue) { best = card; bestValue = value; }
          }
        }
        if (!best) return points[0];
        hands[seat][best.suitIdx] ^= 1 << best.rankVal;
        round.push({ seat, ...best });
      }
      throw new Error('DDS 续打超过一副牌步数');
    };

    const ttKey = (
      trick: readonly { seat: number; suitIdx: number; rankVal: number }[],
      turn: number,
      pts: readonly [number, number],
      depth: number,
    ): string => {
      // 快速哈希键：16个花色掩码 + 轮内牌 + 当前双方累积得分（消除中间数组 join 内存分配）
      let k = `${maxDepth > 0 ? maxDepth - depth : 0}:${turn}:${workingDeal[0][0]},${workingDeal[0][1]},${workingDeal[0][2]},${workingDeal[0][3]}|${workingDeal[1][0]},${workingDeal[1][1]},${workingDeal[1][2]},${workingDeal[1][3]}|${workingDeal[2][0]},${workingDeal[2][1]},${workingDeal[2][2]},${workingDeal[2][3]}|${workingDeal[3][0]},${workingDeal[3][1]},${workingDeal[3][2]},${workingDeal[3][3]}@${pts[0]},${pts[1]}`;
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
      rootNodes++;
      if ((nodes & 127) === 0) options.check?.();
      if (rootNodes >= rootNodeLimit) {
        hitNodeLimit = true;
        return rollout(trick, trickLeader, pts);
      }

      // 获胜线硬截断 (Target Pruning)
      // 1. 庄家方吃分已达标
      if (pts[0] >= bid) return pts[0];
      // 2. 闲家方吃分已达标（庄家无法成局）。105 - bid 是【精确】锁定下界而非保守估计
      //    （分值粒度 5 ⇒ D > 100 - bid ⟺ D >= 105 - bid），到达即结论确定，剪枝不改变 moveScores。
      if (pts[1] >= 105 - bid) return pts[0];

      // 一轮四家出牌结束
      if (trick.length === 4) {
        const { winnerSeat, points } = bitboardTrickWinner(trick, trumpIdx);
        const winSide = sideOf(winnerSeat);
        const nextPts: [number, number] =
          winSide === declarerSide
            ? [pts[0] + points, pts[1]]
            : [pts[0], pts[1] + points];

        // 105 - bid 为精确锁定下界（见上方 Target Pruning 注释），可在入账后立即截断。
        if (nextPts[0] >= bid || nextPts[1] >= 105 - bid) return nextPts[0];

        // 检查全局是否出尽手牌
        const remaining =
          popcount(workingDeal[0][0]) +
          popcount(workingDeal[0][1]) +
          popcount(workingDeal[0][2]) +
          popcount(workingDeal[0][3]);

        if (remaining === 0) return nextPts[0];

        // 深度限制截断
        if (maxDepth > 0 && depth >= maxDepth) {
          hitDepthLimit = true;
          return rollout([], winnerSeat, nextPts);
        }

        // 递归进入下一轮
        return alphabeta([], winnerSeat, nextPts, alpha, beta, depth + 1);
      }

      const actor = (trickLeader + trick.length) % 4;
      const actorSide = sideOf(actor);
      const isMaximizer = actorSide === declarerSide;

      // 置换表查找与边界校验 (Exact / Lower / Upper Bound)
      const key = tt ? ttKey(trick, actor, pts, depth) : '';
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

    // 根节点求解当前行动座位的所有合法候选牌
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

    const moveScores: NonNullable<DdsResult['moveScores']> = [];
    let bestScore = isMaximizer ? -Infinity : Infinity;
    let bestMove = rootCandidates[0];

    // 各候选独立窗口、均分节点预算，避免前面的候选耗尽预算或只得到剪枝界限。
    rootNodeLimit = Math.max(1, Math.floor(nodeLimit / rootCandidates.length));
    for (const c of rootCandidates) {
      rootNodes = 0;
      hitNodeLimit = false;
      hitDepthLimit = false;
      tt?.clear();
      options.check?.();
      workingDeal[actor][c.suitIdx] ^= 1 << c.rankVal;
      currentTrick.push({ seat: actor, suitIdx: c.suitIdx, rankVal: c.rankVal });

      const score = alphabeta(currentTrick, leader, currentPoints, -Infinity, Infinity, 1);

      currentTrick.pop();
      workingDeal[actor][c.suitIdx] ^= 1 << c.rankVal;

      moveScores.push({ suitIdx: c.suitIdx, rankVal: c.rankVal, score,
        status: hitNodeLimit ? 'node_limit' : hitDepthLimit ? 'depth_limit' : 'exact' });

      if (isMaximizer) {
        if (score > bestScore) {
          bestScore = score;
          bestMove = c;
        }
      } else {
        if (score < bestScore) {
          bestScore = score;
          bestMove = c;
        }
      }
    }

    return {
      declarerPoints: bestScore,
      declarerWon: bestScore >= bid,
      bestMove,
      moveScores,
      nodes,
      status: moveScores.some(m => m.status === 'node_limit') ? 'node_limit'
        : moveScores.some(m => m.status === 'depth_limit') ? 'depth_limit' : 'exact',
    };
  }
}
