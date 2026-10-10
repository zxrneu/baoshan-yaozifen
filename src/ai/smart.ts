/**
 * 聪明决策（SRP：只负责叫分 / 定主 / 扣底的估值与选择，出牌决策委托 search）。
 *
 * 相对 v1 heuristic 的改进（P2）：
 * - 叫分：牌力 = 可兑现分牌 + 控制力（A/K）+ 长套纵吃力 + 最佳主潜质，
 *   避免 v1 “只数分”导致的虚叫 / 该叫不叫；
 * - 定主：长度 × 控制（A/K/Q）+ 分牌集中度，避免 v1 “长而弱”选主；
 * - 扣底：v1 短门 + 保主思路保留，额外保护长套中的 K/Q/J 赢张；
 * - 出牌：不再走固定规则，统一走蒙特卡洛搜索（见 search.ts）。
 *
 * SOLID：本模块只导出纯函数 + 一个可注预算/策略的 Agent 工厂（DIP）；
 * heuristic.ts 保持不动（OCP：老策略仍可用、可回退）。
 */
import { Card, SUITS, Suit, cardPoints, cardValue, sortHand } from '../cards';
import { GameState, currentSeat, legalBids } from '../engine';
import { PlayerAgent } from './types';
import {
  DEFAULT_BUDGET, FAST_BUDGET, SearchBudget, searchBestCard,
} from './search';
import { RolloutPolicy, fastChooseCard, fastRolloutPolicy } from './rollout';

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
  const str = estimateBidStrength(state.hands[seat]);
  const legal = legalBids(state);
  // 叫分门槛基于起叫分与手牌牌力：牌力达标（基准约 25 分）即可叫起步分，牌力溢出可叫更高分
  const expected = state.rules.minBid + (str - 25) * 1.6;
  const target = Math.min(
    state.rules.maxBid,
    Math.floor(expected / state.rules.bidStep) * state.rules.bidStep,
  );
  const candidates = legal.filter((b) => b <= target);
  if (candidates.length === 0) return null;
  return candidates[candidates.length - 1];
}

/** 定主：长度 × 控制 + 分牌集中（主里分多 → 杀出来的分归己方） */
export function smartTrump(state: GameState, seat: number): Suit {
  const hand = state.hands[seat];
  let best: Suit = SUITS[0];
  let bestScore = -Infinity;
  for (const s of SUITS) {
    const inSuit = hand.filter((c) => c.suit === s);
    const score =
      inSuit.length * 2.5 +
      controlOf(inSuit) +
      inSuit.reduce((a, c) => a + cardValue(c), 0) / 12 +
      inSuit.reduce((a, c) => a + cardPoints(c), 0) * 0.4;
    if (score > bestScore) {
      bestScore = score;
      best = s;
    }
  }
  return best;
}

export function smartBury(state: GameState, seat: number): Card[] {
  const n = state.kitty.length;
  const hand = state.hands[seat];
  const trump = state.trump!;
  const counts = new Map<string, number>();
  for (const c of hand) counts.set(c.suit, (counts.get(c.suit) ?? 0) + 1);

  // 埋牌分越低越先埋：短门造缺 > 保主 > 保长套赢张(K/Q/J) > 埋小牌
  const scored = hand
    .filter((c) => cardPoints(c) === 0)
    .map((c) => {
      const len = counts.get(c.suit)!;
      const keepWinner =
        (c.rank === 'K' || c.rank === 'Q' || c.rank === 'J') && len >= 3 ? 8 : 0;
      return {
        c,
        score: len * 10 + (c.suit === trump ? 15 : 0) - keepWinner + cardValue(c),
      };
    })
    .sort((a, b) => a.score - b.score)
    .map((x) => x.c);
  if (scored.length < n) {
    // 极端情况（分牌太多）：放宽到手牌中点数最小者
    return sortHand([...hand].sort((a, b) => cardPoints(a) - cardPoints(b)).slice(0, n));
  }
  return sortHand(scored.slice(0, n));
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
