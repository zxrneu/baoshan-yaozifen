/**
 * 聪明决策（SRP：只负责叫分 / 定主 / 扣底的估值与选择，出牌决策委托 search）。
 *
 * 核心策略演进（P2 / A2.1）：
 * - 叫分：牌力 = 受保护分牌 + 控制力（A/K）+ 长套纵吃力 + 最佳主潜质；
 *   手牌无 5 套或弱 4 套坚决 Pass（根除 3-3-3-3 均型散牌虚叫 100 分）；
 *   自带分上限护栏约束叫分档位；区分起叫与竞争叫分（高线防守、自身强套竞争加叫、搭档最高不盲目抬庄）。
 * - 定主：长度 × 控制（A/K/Q）+ 分牌集中度，避免“长而弱”选主，短门坚决不定主。
 * - 扣底：分牌（A/10/5）绝不入底（铁律红线）；主牌严保；副牌大牌（K/Q）及护张严加保护，
 *   杜绝“单张死 K”陷阱；优先整门扣除纯杂小牌做真绝门。极端非分牌不足时显式降级。
 * - 出牌：委托蒙特卡洛/极速搜索（见 search.ts）。
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

function hcpOf(cards: readonly Card[]): number {
  let s = 0;
  for (const c of cards) {
    if (c.rank === 'A') s += 4;
    else if (c.rank === 'K') s += 3;
    else if (c.rank === 'Q') s += 2;
    else if (c.rank === 'J') s += 1;
  }
  return s;
}

/**
 * 可叫牌力：长套/主牌潜力 + 控制力 (A/K) + 受保护分牌折算。
 * 遵循保山幺子分铁律：
 * 1. 均型无长套手（如 3-3-3-3 或无控 4-3-3-2）缺乏控场能力，手牌分多反而是包袱，坚决压低估值；
 * 2. 只有长套分牌或有 A/K 护航的分牌具有高兑现率，短门散分大幅折价；
 * 3. 量纲与“期望吃分”对齐，供起叫与竞争叫判断。
 */
export function estimateBidStrength(cards: readonly Card[]): number {
  const bySuit = new Map<string, Card[]>();
  for (const c of cards) {
    const list = bySuit.get(c.suit) ?? [];
    list.push(c);
    bySuit.set(c.suit, list);
  }

  const lengths = [...bySuit.values()].map((l) => l.length);
  const bestLen = Math.max(0, ...lengths);
  const totalHcp = hcpOf(cards);

  // 均型无长套纪律：
  // 最长套 <= 3 张（如 3-3-3-3），或最长套 4 张且大牌控制极弱（HCP < 11 或控制点 < 7）时，
  // 缺乏控场与将牌清主能力，手牌分多反而沦为被抓庄的包袱分，牌力压制在起叫门槛以下。
  if (bestLen <= 3 || (bestLen === 4 && (totalHcp < 11 || controlOf(cards) < 7))) {
    return 10;
  }

  // 分牌折价与保护评估：
  // 长套（>=5张）中的分牌或有 A/K 保护的分牌是稳健得分，短门裸分则是被捕获的包袱
  let effectivePts = 0;
  for (const list of bySuit.values()) {
    const suitPts = list.reduce((a, c) => a + cardPoints(c), 0);
    const hasA = list.some((c) => c.rank === 'A');
    const hasK = list.some((c) => c.rank === 'K');
    const isLong = list.length >= 5;

    if (isLong || hasA) {
      effectivePts += suitPts * 0.75;
    } else if (hasK && list.length >= 2) {
      effectivePts += suitPts * 0.5;
    } else {
      effectivePts += suitPts * 0.2; // 裸分 / 短门无控分打折
    }
  }

  let strength = effectivePts + controlOf(cards);

  // 长套纵吃与主牌深度奖励（>= 5 张套做主更硬）
  for (const list of bySuit.values()) {
    if (list.length >= 5) {
      strength += (list.length - 4) * 2.0;
    }
  }

  // 副牌单张/缺门潜质（便于扣底做绝门主牌毙杀）
  for (const list of bySuit.values()) {
    if (list.length === 1 && bestLen >= 5) {
      strength += 1.5;
    }
  }

  return strength;
}

export function smartBid(state: GameState, seat: number): number | null {
  return bidFromObservation({
    ownHand: state.hands[seat],
    legalBids: legalBids(state),
    minBid: state.rules.minBid,
    maxBid: state.rules.maxBid,
    bidStep: state.rules.bidStep,
    highestBid: state.highestBid,
    highestBidder: state.highestBidder,
    bidHistory: state.bidding,
    seat,
  });
}

export function bidFromObservation(
  observation: Pick<BiddingObservation, 'ownHand' | 'legalBids' | 'minBid' | 'maxBid' | 'bidStep'> &
    Partial<Pick<BiddingObservation, 'highestBid' | 'highestBidder' | 'bidHistory' | 'seat'>>,
): number | null {
  const hand = observation.ownHand;
  const legal = observation.legalBids;
  if (legal.length === 0) return null;

  const highestBid = observation.highestBid ?? 0;
  const highestBidder = observation.highestBidder ?? null;
  const seat = observation.seat ?? null;
  const partnerSeat = seat !== null ? (seat + 2) % 4 : null;

  // 1. 搭档最高叫牌者纪律：搭档已叫到 highestBid，盲目抬高自己方的锁定线百害无一利，除非手牌有极端大牌
  if (partnerSeat !== null && highestBidder === partnerSeat) {
    return null;
  }

  const str = estimateBidStrength(hand);
  // 基础门槛：牌力未达标（基准 24 分）直接 Pass
  if (str < 24) return null;

  const totalHcp = hcpOf(hand);
  const rawPts = hand.reduce((a, c) => a + cardPoints(c), 0);
  const counts = new Map<string, number>();
  for (const c of hand) counts.set(c.suit, (counts.get(c.suit) ?? 0) + 1);
  const bestLen = Math.max(0, ...counts.values());

  // 2. 叫分上限安全护栏：
  // 自带分少于 25 分的手牌（即使长套良好），总得分需仰赖搭档与底牌，起叫不应盲目虚高；
  // 只有在自带分 >= 35 且总大牌点 >= 12 时才允许叫到 80+；叫 85+ 必须自带分 >= 45 且 HCP >= 14。
  let maxCap = observation.maxBid;
  if (rawPts <= 25) {
    maxCap = Math.min(maxCap, 75);
  } else if (rawPts < 35 || totalHcp < 12) {
    maxCap = Math.min(maxCap, 80);
  } else if (rawPts < 45 || totalHcp < 14) {
    maxCap = Math.min(maxCap, 85);
  }

  // 3. 竞争叫分防守纪律：
  // 当对手已经叫到 85 分或更高时，闲家防守线为 105 - B <= 20 分，抓庄极易！
  // 除非自身手牌具备极强套（>=6张）且 HCP >= 16、自带分 >= 40，否则坚决 Pass 防守。
  if (highestBid >= 85 && highestBidder !== null && highestBidder !== partnerSeat) {
    if (bestLen < 6 || rawPts < 40 || totalHcp < 16) {
      return null;
    }
  }

  // 4. 起叫估值（平滑映射：str 25 对应 70，str 32 对应 75，str 40+ 对应 80~85）
  const expected = observation.minBid + (str - 25) * 1.0;
  const target = Math.min(
    maxCap,
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

function getSubsets<T>(arr: readonly T[], k: number): T[][] {
  const result: T[][] = [];
  function backtrack(start: number, current: T[]) {
    if (current.length === k) {
      result.push([...current]);
      return;
    }
    for (let i = start; i <= arr.length - (k - current.length); i++) {
      current.push(arr[i]);
      backtrack(i + 1, current);
      current.pop();
    }
  }
  backtrack(0, []);
  return result;
}

function evaluateBuryCombo(combo: readonly Card[], hand: readonly Card[], trump: Suit): number {
  let score = 0;
  const comboSet = new Set(combo);
  const remaining = hand.filter((c) => !comboSet.has(c));

  // 1. 保主牌：严禁扣主牌（+1000 惩罚/张）
  for (const c of combo) {
    if (c.suit === trump) score += 1000;
  }

  // 2. 副牌高阶大牌保护（严禁扣 K，避免扣 Q）
  for (const c of combo) {
    if (c.suit !== trump) {
      if (c.rank === 'K') score += 500;
      else if (c.rank === 'Q') score += 300;
      else if (c.rank === 'J') score += 80;
    }
  }

  // 3. 整组绝门评估：副牌完全扣空奖励
  for (const suit of SUITS) {
    if (suit === trump) continue;
    const handInSuit = hand.filter((c) => c.suit === suit);
    const remInSuit = remaining.filter((c) => c.suit === suit);
    if (handInSuit.length > 0 && remInSuit.length === 0) {
      // 成功整门绝门！
      score -= 300;
      // 偏好更短的花色做绝门（如 2 张或 1 张绝门成本低，效率更高）
      score -= (5 - handInSuit.length) * 20;
    }
  }

  // 4. 防单张死大牌与叉子/护张破坏
  for (const suit of SUITS) {
    if (suit === trump) continue;
    const handInSuit = hand.filter((c) => c.suit === suit);
    const remInSuit = remaining.filter((c) => c.suit === suit);
    const hasHonor = handInSuit.some((c) => c.rank === 'K' || c.rank === 'Q');
    if (hasHonor) {
      // 原手牌有保护（>=2张），扣牌后留下单张孤立死 K 或死 Q
      if (handInSuit.length >= 2 && remInSuit.length === 1 && (remInSuit[0].rank === 'K' || remInSuit[0].rank === 'Q')) {
        score += 400;
      }
      // 叉子/大牌护张保护：若原手牌 3 张含 AQ 叉子（如 ♥AQ3），扣掉护张却没绝门
      if (handInSuit.length === 3 && remInSuit.length === 2 && remInSuit.some((c) => c.rank === 'A') && remInSuit.some((c) => c.rank === 'Q')) {
        score += 150;
      }
    }
  }

  // 5. 扣小牌优先（同等情况下点数越小越先扣）
  for (const c of combo) {
    score += cardValue(c);
  }

  return score;
}

export function buryFromObservation(observation: Pick<BuryObservation, 'ownHand' | 'trump' | 'kittySize'>): Card[] {
  const n = observation.kittySize;
  const hand = observation.ownHand;
  const trump = observation.trump;

  // 1. 严格红线过滤：分牌（A/10/5）绝不能扣底
  const nonPoints = hand.filter((c) => cardPoints(c) === 0);

  if (nonPoints.length <= n) {
    if (nonPoints.length < n && !warnedDegradedBury) {
      warnedDegradedBury = true;
      console.warn(
        `[smart.buryFromObservation] 非分牌不足：手牌 ${hand.length} 张中仅 ${nonPoints.length} 张非分牌，`
        + `需扣底 ${n} 张。降级为只扣非分牌（可能不足数），绝不扣分牌。`,
      );
    }
    return sortHand([...nonPoints]);
  }

  // 2. 整组扣牌方案评估：从所有非分牌中选取最优的 n 张组合
  // 遵循：绝门优先（按整组扣牌结果评估，避免拆散多门导致均未扣空）、
  // 保护副牌 K/Q 控制张与护张、保护主牌深度、扣小点数牌。
  const allCombos = getSubsets(nonPoints, n);
  let bestCombo = allCombos[0];
  let bestScore = Infinity;

  for (const combo of allCombos) {
    const score = evaluateBuryCombo(combo, hand, trump);
    if (score < bestScore) {
      bestScore = score;
      bestCombo = combo;
    }
  }

  return sortHand([...bestCombo]);
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
