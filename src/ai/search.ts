/**
 * 蒙特卡洛搜索（SRP：只负责“候选动作 → 期望效用”的估计与选择）。
 *
 * 流程：对每个合法出牌 → 采样 K 个隐藏世界 → 每个世界用 rollout 走完 →
 * 取己方效用均值 → 选最大者。首家领出时候选可能多达 12 张，用启发式剪枝
 * 到最有希望的若干张，保证 UI 侧 650ms 节奏内完成。
 *
 * SOLID：
 * - 依赖 RolloutPolicy / evaluation 纯函数（DIP），不依赖具体 Agent；
 * - 搜索预算 SearchBudget 可注入，测试可用小预算、UI 可用大预算（OCP）；
 * - heuristic 剪枝只作为候选排序器传入，search 本体不感知启发式细节。
 */
import { Card, cardId, cardPoints, cardValue } from '../cards';
import {
  GameState, currentSeat, legalMoves, playCard, revealedPartnerSeat,
} from '../engine';
import { isPartnerWinning, sideUtility, wouldWinTrick } from './evaluation';
import { fastRolloutPolicy, rolloutToEnd, RolloutPolicy } from './rollout';
import { rngFrom, sampleHiddenHands } from './sampling';

export interface SearchBudget {
  /** 每个候选动作采样的世界数 */
  worldsPerMove: number;
  /** 领出时最多评估的候选张数（剪枝上限） */
  maxLeadCandidates: number;
  /** 非领出时最多评估的候选张数 */
  maxFollowCandidates: number;
}

export const DEFAULT_BUDGET: SearchBudget = {
  worldsPerMove: 24,
  maxLeadCandidates: 6,
  maxFollowCandidates: 8,
};

/** 测试 / 低端设备用：更快但稍弱 */
export const FAST_BUDGET: SearchBudget = {
  worldsPerMove: 8,
  maxLeadCandidates: 4,
  maxFollowCandidates: 6,
};

export interface RankedMove {
  card: Card;
  expected: number;
  worlds: number;
}

function dedupe(cards: Card[]): Card[] {
  const seen = new Set<string>();
  return cards.filter((c) => {
    const id = cardId(c);
    if (seen.has(id)) return false;
    seen.add(id);
    return true;
  });
}

/**
 * 候选剪枝：把合法出牌按“值得搜索”的程度排序并截断。
 * 保留的维度：最小牌 / 最大分 / 最小主 / A / 每门花色代表，确保搜索能看到
 * 喂分、抢分、杀、垫等不同意图，而不是 12 张同门小牌互相内卷。
 */
export function shortlistMoves(state: GameState, seat: number, cap: number, pool?: Card[]): Card[] {
  const legal = pool ? dedupe(pool) : dedupe(legalMoves(state, seat));
  if (legal.length <= cap) return legal;
  const trump = state.trump;
  const scored = legal.map((c) => {
    let s = 0;
    if (cardPoints(c) > 0) s += 10 + cardPoints(c); // 分牌值得单独评估
    if (c.rank === 'A') s += 8;
    if (trump !== null && c.suit === trump) s += 5; // 主牌杀法值得看
    s -= cardValue(c) * 0.1; // 同类里偏小牌
    return { c, s };
  });
  scored.sort((a, b) => b.s - a.s);
  // 保底：每门花色至少留一张最便宜的，避免剪掉整门意图
  const bySuit = new Map<string, Card>();
  for (const c of [...legal].sort((a, b) => cardValue(a) - cardValue(b))) {
    if (!bySuit.has(c.suit)) bySuit.set(c.suit, c);
  }
  const picked = scored.slice(0, cap).map((x) => x.c);
  for (const c of bySuit.values()) {
    if (picked.length >= cap) break;
    if (!picked.some((p) => cardId(p) === cardId(c))) picked.push(c);
  }
  return picked;
}

/** 估计单个候选动作的期望效用（己方视角） */
export function expectedUtility(
  state: GameState,
  seat: number,
  card: Card,
  policy: RolloutPolicy,
  worlds: number,
): number {
  let total = 0;
  for (let w = 0; w < worlds; w++) {
    const rng = rngFrom(state.seed + seat * 131 + cardValue(card) * 17, w * 31 + 7);
    const hidden = sampleHiddenHands(state, seat, rng);
    const world: GameState = { ...state, hands: hidden.map((h) => [...h]) };
    const after = playCard(world, seat, card);
    const end = rolloutToEnd(after, policy);
    total += sideUtility(end, seat);
  }
  return total / Math.max(1, worlds);
}

/** 对候选逐个估计并排序（降序），调用方取 [0] 即最优 */
export function rankMoves(
  state: GameState,
  seat: number,
  candidates: Card[],
  policy: RolloutPolicy = fastRolloutPolicy,
  worldsPerMove = DEFAULT_BUDGET.worldsPerMove,
): RankedMove[] {
  const ranked = candidates.map((card) => ({
    card,
    expected: expectedUtility(state, seat, card, policy, worldsPerMove),
    worlds: worldsPerMove,
  }));
  ranked.sort((a, b) => b.expected - a.expected);
  return ranked;
}

/** 蒙特卡洛选牌：剪枝 → 估计 → 取最优；候选仅 1 张时直接返回 */
export function searchBestCard(
  state: GameState,
  seat: number,
  policy: RolloutPolicy = fastRolloutPolicy,
  budget: SearchBudget = DEFAULT_BUDGET,
): Card {
  const legal = dedupe(legalMoves(state, seat));
  if (legal.length === 0) throw new Error('无合法出牌');
  if (legal.length === 1) return legal[0];
  if (seat !== currentSeat(state)) return legal[0];
  // 普通暗牌局保留旧策略的“不超车”限制；100 分明牌局评估所有合法候选，
  // 可以根据已公开的搭档手牌选择接管领出权。
  if (revealedPartnerSeat(state) === null && state.trick.length > 0 && isPartnerWinning(state, seat)) {
    const nonOvertaking = legal.filter((c) => !wouldWinTrick(state, seat, c));
    if (nonOvertaking.length === 1) return nonOvertaking[0];
    if (nonOvertaking.length > 1) {
      const cap = Math.min(budget.maxFollowCandidates, nonOvertaking.length);
      const candidates = shortlistMoves(state, seat, cap, nonOvertaking);
      const ranked = rankMoves(state, seat, candidates, policy, budget.worldsPerMove);
      return ranked[0].card;
    }
    // 全部都会超车（被迫）：返回最小损失
  }
  const cap = state.trick.length === 0 ? budget.maxLeadCandidates : budget.maxFollowCandidates;
  const candidates = shortlistMoves(state, seat, Math.min(cap, legal.length));
  const ranked = rankMoves(state, seat, candidates, policy, budget.worldsPerMove);
  return ranked[0].card;
}
