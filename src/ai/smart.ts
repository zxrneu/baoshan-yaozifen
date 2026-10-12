/**
 * 聪明决策（SRP：只负责叫分 / 定主 / 扣底的估值与选择，出牌决策委托 search）。
 *
 * 相对 v1 heuristic 的改进（P2）：
 * - 叫分：牌力 = 可兑现分牌 + 控制力（A/K）+ 长套纵吃力 + 最佳主潜质，
 *   避免 v1 “只数分”导致的虚叫 / 该叫不叫；
 * - 定主：长度 × 控制（A/K/Q）+ 分牌集中度，避免 v1 “长而弱”选主；
 * - 扣底：v1 短门 + 保主思路保留，额外保护长套中的 K/Q/J 赢张；
 *   兜底分支同样只在非分牌中选取，绝不回退到含 A/10/5 的非法动作。
 * - 出牌：不再走固定规则，统一走蒙特卡洛搜索（见 search.ts）。
 *
 * SOLID：本模块只导出纯函数 + 一个可注预算/策略的 Agent 工厂（DIP）；
 * heuristic.ts 保持不动（OCP：老策略仍可用、可回退）。
 */
import { Card, SUITS, Suit, cardPoints, cardValue, sortHand } from '../cards';
import { GameState, currentSeat, legalBids } from '../engine';
import { PlayerAgent } from './types';
import { BiddingObservation, TrumpObservation, BuryObservation } from './decisionObservation';
import {
  DEFAULT_BUDGET, FAST_BUDGET, SearchBudget, searchBestCard,
} from './search';
import { RolloutPolicy, fastChooseCard, fastRolloutPolicy } from './rollout';

/** 扣底兜底降级只告警一次，避免极端局面下每副刷屏 */
let warnedDegradedBury = false;

function controlOf(cards: readonly Card[]): number {
  let s = 0;
  for (const c of cards) {
    if (c.rank === 'A') s += 5;
    else if (c.rank === 'K') s += 2;
    else if (c.rank === 'Q') s += 0.5;
  }
  return s;
}

/**
 * 可叫牌力：分牌折价（未必全吃到）+ 控制力 + 长套奖励 + 最佳主潜质。
 * 量纲与“期望吃分”对齐，便于直接与叫分档比较。
 */
export function estimateBidStrength(cards: readonly Card[]): number {
  const pts = cards.reduce((a, c) => a + cardPoints(c), 0);
  let strength = pts * 0.8 + controlOf(cards);
  const bySuit = new Map<string, Card[]>();
  for (const c of cards) {
    const list = bySuit.get(c.suit) ?? [];
    list.push(c);
    bySuit.set(c.suit, list);
  }
  for (const list of bySuit.values()) {
    if (list.length >= 4) strength += (list.length - 3) * 1.2; // 长套纵吃
  }
  const bestLen = Math.max(0, ...[...bySuit.values()].map((l) => l.length));
  if (bestLen >= 5) strength += (bestLen - 4) * 2; // 主潜质：长套做主更硬
  return strength;
}

export function smartBid(state: GameState, seat: number): number | null {
  return bidFromObservation({ ownHand: state.hands[seat], legalBids: legalBids(state),
    minBid: state.rules.minBid, maxBid: state.rules.maxBid, bidStep: state.rules.bidStep });
}

export function bidFromObservation(observation: Pick<BiddingObservation, 'ownHand' | 'legalBids' | 'minBid' | 'maxBid' | 'bidStep'>): number | null {
  const str = estimateBidStrength(observation.ownHand);
  const legal = observation.legalBids;
  // 叫分门槛基于起叫分与手牌牌力：牌力达标（基准约 25 分）即可叫起步分，牌力溢出可叫更高分
  const expected = observation.minBid + (str - 25) * 1.6;
  const target = Math.min(
    observation.maxBid,
    Math.floor(expected / observation.bidStep) * observation.bidStep,
  );
  const candidates = legal.filter((b) => b <= target);
  if (candidates.length === 0) return null;
  return candidates[candidates.length - 1];
}

/** 定主：长度 × 控制 + 分牌集中（主里分多 → 杀出来的分归己方） */
export function smartTrump(state: GameState, seat: number): Suit {
  return trumpFromObservation({ ownHand: state.hands[seat] });
}

export function trumpFromObservation(observation: Pick<TrumpObservation, 'ownHand'>): Suit {
  const hand = observation.ownHand;
  let best: Suit = SUITS[0];
  let bestScore = -Infinity;
  for (const s of SUITS) {
    const inSuit = hand.filter((c) => c.suit === s);
    const len = inSuit.length;
    // 保山幺子分定主铁律：张数绝对优先，短门绝不可定主
    const lengthPenalty = len <= 3 ? -20 : len >= 5 ? 10 : 0;
    const score =
      len * 4 +
      lengthPenalty +
      controlOf(inSuit) +
      inSuit.reduce((a, c) => a + cardValue(c), 0) / 12 +
      inSuit.reduce((a, c) => a + cardPoints(c), 0) * 0.1;
    if (score > bestScore) {
      bestScore = score;
      best = s;
    }
  }
  return best;
}

export function smartBury(state: GameState, seat: number): Card[] {
  return buryFromObservation({ ownHand: state.hands[seat], trump: state.trump!, kittySize: state.rules.kittySize });
}

export function buryFromObservation(observation: Pick<BuryObservation, 'ownHand' | 'trump' | 'kittySize'>): Card[] {
  const n = observation.kittySize;
  const hand = observation.ownHand;
  const trump = observation.trump;
  const counts = new Map<string, number>();
  for (const c of hand) counts.set(c.suit, (counts.get(c.suit) ?? 0) + 1);

  // 分析每门副牌是否具备“全扣成绝门”的可行性：
  // 必须该门所有牌均为非分牌（无 A/10/5），且张数 <= n
  const canVoidSuit = new Map<string, boolean>();
  for (const suit of SUITS) {
    if (suit === trump) {
      canVoidSuit.set(suit, false);
      continue;
    }
    const allInSuit = hand.filter((c) => c.suit === suit);
    const nonPointsInSuit = allInSuit.filter((c) => cardPoints(c) === 0);
    const canVoid = allInSuit.length > 0 && allInSuit.length === nonPointsInSuit.length && allInSuit.length <= n;
    canVoidSuit.set(suit, canVoid);
  }

  // 埋牌分越低越先埋：
  // 1. 能够形成真绝门的短门非分牌优先扣除（大幅减分促使被埋）
  // 2. 主牌严加保护（+100）
  // 3. 高阶控制张 (K, Q) 若在无法绝门的花色中，必须予以保护避免白送（+40）
  // 4. 同门内点数越小越先埋
  const scored = hand
    .filter((c) => cardPoints(c) === 0)
    .map((c) => {
      const len = counts.get(c.suit)!;
      const isTrump = c.suit === trump;
      const isVoidable = canVoidSuit.get(c.suit) ?? false;
      const isHighHonor = c.rank === 'K' || c.rank === 'Q';

      let score = len * 10 + cardValue(c);
      if (isTrump) {
        score += 100; // 严保主牌
      } else if (isVoidable) {
        score -= 50; // 真绝门优先全扣
      } else if (isHighHonor) {
        score += 40; // 无法绝门的花色保护大牌控制张（如 K、Q）
      }

      return { c, score };
    })
    .sort((a, b) => a.score - b.score)
    .map((x) => x.c);
  if (scored.length >= n) return sortHand(scored.slice(0, n));

  // 极端情况（分牌太多，非分牌不足 n 张）：兜底**仍只在非分牌中选**。
  // 绝不回退到"全手牌取点数最小者"——那会返回 A/10/5，违反"分牌不能扣底"，
  // 并让 engine.bury 抛 IllegalActionError，该座位将永远无法扣底。
  // 此处显式降级为"不足数"并告警，让引擎在 bury 处以清晰错误暴露问题。
  if (!warnedDegradedBury) {
    warnedDegradedBury = true;
    console.warn(
      `[smart.buryFromObservation] 非分牌不足：手牌 ${hand.length} 张中仅 ${scored.length} 张非分牌，`
      + `需扣底 ${n} 张。降级为只扣非分牌（可能不足数），绝不扣分牌。`,
    );
  }
  return sortHand([...scored]);
}

/**
 * 蒙特卡洛选牌；搜索失败（理论上不应发生）时回退到快速策略，
 * 保证 UI 永远有牌可出。
 */
export function smartPlay(
  state: GameState,
  seat: number,
  budget: SearchBudget = DEFAULT_BUDGET,
  policy: RolloutPolicy = fastRolloutPolicy,
): Card {
  try {
    return searchBestCard(state, seat, policy, budget);
  } catch {
    return fastChooseCard(state, seat);
  }
}

export interface SmartAgentOptions {
  budget?: SearchBudget;
  policy?: RolloutPolicy;
}

/** 可注入预算与推演策略的聪明 Agent（默认用全预算；测试可用 FAST_BUDGET） */
export function createSmartAgent(opts: SmartAgentOptions = {}): PlayerAgent {
  const budget = opts.budget ?? DEFAULT_BUDGET;
  const policy = opts.policy ?? fastRolloutPolicy;
  return {
    nextAction(state) {
      const seat = currentSeat(state);
      if (seat < 0) return null;
      switch (state.phase) {
        case 'bidding':
          return { kind: 'bid', seat, bid: smartBid(state, seat) };
        case 'trump':
          return { kind: 'trump', seat, trump: smartTrump(state, seat) };
        case 'bury':
          return { kind: 'bury', seat, cards: smartBury(state, seat) };
        case 'playing':
          return { kind: 'play', seat, card: smartPlay(state, seat, budget, policy) };
        default:
          return null;
      }
    },
  };
}

/** 默认聪明 Agent（UI 默认用它，见 useGame） */
export const smartAgent: PlayerAgent = createSmartAgent();

/** 给测试 / 低端设备用的快速聪明 Agent */
export const fastSmartAgent: PlayerAgent = createSmartAgent({ budget: FAST_BUDGET });
