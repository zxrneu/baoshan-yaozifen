/**
 * 实验 harness（不参与产品构建，仅供 experiments/ 使用）：
 * - 统一的单副对局驱动（发牌 → 叫分 → 定主 → 扣底 → 出牌 → 结算）
 * - 可插拔策略：叫分 / 定主 / 扣底 / 出牌四类决策全部参数化
 * - 统计工具：均值、比例、配对差分 95% CI（同一发牌种子跨策略复用 = 共同随机数）
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Card, Suit, cardPoints, cardValue, makeRng } from '@yaozifen/game-core/cards';
import {
  GameState, bid as bidAction, bury as buryAction, createGame, currentSeat,
  declareTrump as declareTrumpAction, legalBids, legalMoves, partnerOf,
  playCard as playCardAction, trickWinner,
} from '@yaozifen/game-core';
import {
  FAST_BUDGET, SearchBudget, aiBid, estimateBidStrength, fastChooseCard,
  rolloutToEnd, sampleHiddenHands, shortlistMoves,
  sideUtility, smartBid, smartBury, smartTrump, wouldWinTrick,
} from '@yaozifen/ai-core';
import { rngFrom } from '@yaozifen/ai-core/sampling';

export type Policy<T> = (s: GameState, seat: number) => T;

export interface HandSetup {
  seed: number;
  bidPolicy: Policy<number | null>;
  trumpPolicy: Policy<Suit>;
  buryPolicy: Policy<Card[]>;
  playPolicy: Policy<Card>;
  /** 是否按 seed 轮转庄家位（平衡座位/叫牌顺序偏差），默认 true */
  rotateDealer?: boolean;
}

export interface HandRow {
  seed: number;
  dealer: number;
  bid: number;
  declarer: number;
  declarerSide: number;
  trump: Suit;
  success: boolean;
  declarerPoints: number;
  defenderPoints: number;
  buried: number;
  /** 庄家起手 12 张的分牌合计 */
  declHandPoints: number;
  /** 庄家起手 12 张的牌力估值（estimateBidStrength） */
  declStrength: number;
  /** 一局内重发（四家不叫）次数 */
  redeals: number;
}

/** 把庄家位轮转到指定座位（只改庄家位与叫分顺序，手牌仍由 seed 决定） */
export function withDealer(s: GameState, dealer: number): GameState {
  const d = ((dealer % 4) + 4) % 4;
  return {
    ...s,
    dealer: d,
    bidOrder: [(d + 1) % 4, (d + 2) % 4, (d + 3) % 4, d],
  };
}

/** 打完一整副牌，返回结算行 */
export function playHand(setup: HandSetup): HandRow {
  const rotate = setup.rotateDealer !== false;
  let s = createGame(setup.seed);
  if (rotate) s = withDealer(s, setup.seed);
  let redeals = 0;
  let strength = 0;
  let declHandPoints = 0;
  let prevPhase = s.phase;
  let prevBiddingLen = s.bidding.length;
  let guard = 0;
  while (s.phase !== 'handEnd' && s.phase !== 'matchEnd') {
    if (guard++ > 3000) throw new Error(`seed=${setup.seed} 对局未收敛: ${s.phase}`);
    if (prevPhase === 'bidding' && s.phase === 'trump') {
      const d = s.declarer!;
      strength = estimateBidStrength(s.hands[d]);
      declHandPoints = s.hands[d].reduce((a, c) => a + cardPoints(c), 0);
    }
    if (s.phase === 'bidding' && s.bidding.length < prevBiddingLen) {
      redeals += 1; // 四家不叫 → 庄家顺延重新发牌
      strength = 0;
      declHandPoints = 0;
    }
    prevPhase = s.phase;
    prevBiddingLen = s.bidding.length;
    const seat = currentSeat(s);
    switch (s.phase) {
      case 'bidding':
        s = bidAction(s, seat, setup.bidPolicy(s, seat));
        break;
      case 'trump':
        s = declareTrumpAction(s, seat, setup.trumpPolicy(s, seat));
        break;
      case 'bury':
        s = buryAction(s, seat, setup.buryPolicy(s, seat));
        break;
      case 'playing':
        s = playCardAction(s, seat, setup.playPolicy(s, seat));
        break;
      default:
        throw new Error(`意外阶段 ${s.phase}`);
    }
  }
  const r = s.result!;
  return {
    seed: setup.seed,
    dealer: s.dealer,
    bid: r.bid,
    declarer: s.declarer!,
    declarerSide: r.declarerSide,
    trump: r.trump,
    success: r.success,
    declarerPoints: r.declarerPoints,
    defenderPoints: r.defenderPoints,
    buried: r.buriedPoints,
    declHandPoints,
    declStrength: strength,
    redeals,
  };
}

// ────────────────────────────── 叫分 / 定主 / 扣底 策略 ──────────────────────────────

export const smartBidPolicy: Policy<number | null> = (s, seat) => smartBid(s, seat);
export const heuristicBidPolicy: Policy<number | null> = (s, seat) => aiBid(s, seat);

/** 盲目起步叫：只有在还没人叫过（最低档 = 70）时才叫 70，否则让 */
export const takeIt70: Policy<number | null> = (s) => {
  const legal = legalBids(s);
  return legal.length > 0 && legal[0] === s.rules.minBid ? s.rules.minBid : null;
};

/** 永远不叫（只有当对手也不叫时才会四家不叫重发） */
export const alwaysPass: Policy<number | null> = () => null;

/** 强制叫分：第一家叫 X，其余让（用于测“叫 X 分到底有多难”） */
export function forcedBid(x: number): Policy<number | null> {
  return (s) => (s.bidding.length === 0 ? x : null);
}

export const smartTrumpPolicy: Policy<Suit> = (s, seat) => smartTrump(s, seat);

export const longestTrump: Policy<Suit> = (s, seat) => {
  const hand = s.hands[seat];
  const order: Suit[] = ['S', 'H', 'D', 'C'];
  let best = order[0];
  let bestKey = -1;
  for (const suit of order) {
    const list = hand.filter((c) => c.suit === suit);
    const key = list.length * 100 + list.reduce((a, c) => a + cardValue(c), 0);
    if (key > bestKey) {
      bestKey = key;
      best = suit;
    }
  }
  return best;
};

export const pointsTrump: Policy<Suit> = (s, seat) => {
  const hand = s.hands[seat];
  const order: Suit[] = ['S', 'H', 'D', 'C'];
  let best = order[0];
  let bestKey = -Infinity;
  for (const suit of order) {
    const list = hand.filter((c) => c.suit === suit);
    const key = list.reduce((a, c) => a + cardPoints(c), 0) * 100 + list.length;
    if (key > bestKey) {
      bestKey = key;
      best = suit;
    }
  }
  return best;
};

export const randomTrump: Policy<Suit> = (s, seat) => {
  const rng = makeRng((Math.imul(s.seed, 40503) + seat * 977 + s.bidding.length) >>> 0);
  const order: Suit[] = ['S', 'H', 'D', 'C'];
  return order[Math.floor(rng() * 4)];
};

export const smartBuryPolicy: Policy<Card[]> = (s, seat) => smartBury(s, seat);

export const randomBury: Policy<Card[]> = (s, seat) => {
  const n = s.kitty.length;
  const pool = s.hands[seat].filter((c) => cardPoints(c) === 0);
  const rng = makeRng((Math.imul(s.seed, 2246822519) + seat * 131 + s.trickNumber) >>> 0);
  const copy = [...pool];
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy.slice(0, n);
};

/** 短门优先垫底（v1 heuristic 思路的纯版：短门 → 非主 → 小牌） */
export const shortFirstBury: Policy<Card[]> = (s, seat) => {
  const n = s.kitty.length;
  const hand = s.hands[seat];
  const trump = s.trump!;
  const counts = new Map<string, number>();
  for (const c of hand) counts.set(c.suit, (counts.get(c.suit) ?? 0) + 1);
  const cand = hand
    .filter((c) => cardPoints(c) === 0)
    .sort((a, b) => {
      const la = counts.get(a.suit)!;
      const lb = counts.get(b.suit)!;
      if (la !== lb) return la - lb;
      const ta = a.suit === trump ? 1 : 0;
      const tb = b.suit === trump ? 1 : 0;
      if (ta !== tb) return ta - tb;
      return cardValue(a) - cardValue(b);
    });
  return cand.slice(0, n);
};

// ────────────────────────────── 出牌策略 ──────────────────────────────

export type PlayPolicy = Policy<Card>;

/** 随机合法牌（运气基线） */
export const randomPlay: PlayPolicy = (s, seat) => {
  const legal = legalMoves(s, seat);
  const rng = makeRng(
    (Math.imul(s.seed, 1000003) + s.trickNumber * 131 + seat * 17 + s.trick.length * 7) >>> 0,
  );
  return legal[Math.floor(rng() * legal.length)];
};

/** 永远出最小（无脑基线） */
export const minPlay: PlayPolicy = (s, seat) => {
  const legal = [...legalMoves(s, seat)].sort(
    (a, b) => cardValue(a) - cardValue(b) || (a.suit < b.suit ? -1 : 1),
  );
  return legal[0];
};

export interface Tactic {
  /** 是否具备“搭档意识”（不超车搭档、缺门不反杀搭档） */
  partnerAware: boolean;
  /** 搭档领先时是否主动喂分 */
  feed: boolean;
  /** 缺门且对手领先时是否用主杀 */
  ruff: boolean;
  /** 只在“搭档的牌不可能被后面的人反超”时才喂分 */
  feedOnlySafe?: boolean;
}

const byPointsDesc = (a: Card, b: Card) =>
  cardPoints(b) - cardPoints(a) || cardValue(a) - cardValue(b);
const cheapDisc = (a: Card, b: Card) =>
  cardPoints(a) - cardPoints(b) || cardValue(a) - cardValue(b);
const asc = (a: Card, b: Card) => cardValue(a) - cardValue(b);

/**
 * 参数化的出牌策略族：领出规则统一（非主 A → 最长门小牌），
 * 只在“跟牌 / 缺门”两个分支上按 Tactic 分化，保证消融只差一个原则。
 */
export function tacticPlay(cfg: Tactic): PlayPolicy {
  return (s, seat) => {
    const legal = legalMoves(s, seat);
    if (legal.length === 1) return legal[0];
    const trump = s.trump!;
    const hand = s.hands[seat];
    const win = (c: Card) => wouldWinTrick(s, seat, c);

    // ── 领出：非主 A 先行（主 A 也必赢但留着杀分更值），否则最长门最小 ──
    if (s.trick.length === 0) {
      const aces = legal.filter((c) => c.rank === 'A' && c.suit !== trump).sort(asc);
      if (aces.length > 0) return aces[0];
      const counts = new Map<string, number>();
      for (const c of hand) counts.set(c.suit, (counts.get(c.suit) ?? 0) + 1);
      return [...legal].sort(
        (a, b) => (counts.get(b.suit)! - counts.get(a.suit)!) || asc(a, b),
      )[0];
    }

    const led = s.trick[0].card.suit;
    const pts = s.trick.reduce((a, t) => a + cardPoints(t.card), 0);
    const partner = partnerOf(seat);
    const partnerCard = s.trick.find((t) => t.seat === partner)?.card ?? null;
    const partnerWins = partnerCard !== null && trickWinner(s.trick, trump).seat === partner;
    const isLast = s.trick.length === 3;
    // 喂分安全 = 我是最后一家，或搭档的牌是主 A（全场最大，无人可反超）
    const safeToFeed =
      isLast || (partnerCard !== null && partnerCard.suit === trump && partnerCard.rank === 'A');

    /** 搭档领先时的“喂分张”：不超车前提下分最大 */
    const feedPick = (pool: Card[]): Card | undefined => {
      const nonOver = pool.filter((c) => !win(c));
      const usable = nonOver.length > 0 ? nonOver : pool;
      return [...usable].sort(byPointsDesc)[0];
    };
    /** 搭档领先但不喂分时的“最小损失张” */
    const dumpOnPartner = (pool: Card[]): Card => {
      const nonOver = pool.filter((c) => !win(c));
      const usable = nonOver.length > 0 ? nonOver : pool;
      return [...usable].sort(cheapDisc)[0];
    };
    /** 对手领先时：能赢且值得赢就用最便宜的赢，否则垫分最少 */
    const tryWin = (pool: Card[]): Card | undefined => {
      const winners = pool.filter(win).sort(
        (a, b) => cardPoints(a) - cardPoints(b) || cardValue(a) - cardValue(b),
      );
      if (winners.length > 0 && (pts > 0 || isLast)) return winners[0];
      return undefined;
    };

    const follow = legal.filter((c) => c.suit === led);
    const partnerRuleApplies = cfg.partnerAware && partnerWins;
    const mayFeed = partnerRuleApplies && cfg.feed && (!cfg.feedOnlySafe || safeToFeed);

    // ── 跟牌分支 ──
    if (follow.length > 0) {
      if (mayFeed) {
        const f = feedPick(follow);
        if (f) return f;
      }
      if (partnerRuleApplies) return dumpOnPartner(follow);
      const w = tryWin(follow);
      if (w) return w;
      return [...follow].sort(cheapDisc)[0];
    }

    // ── 缺门分支 ──
    if (mayFeed) {
      const nonTrump = legal.filter((c) => c.suit !== trump);
      const f = feedPick(nonTrump.length > 0 ? nonTrump : legal);
      if (f) return f;
    }
    if (partnerRuleApplies) return dumpOnPartner(legal);
    if (cfg.ruff) {
      const trumps = legal.filter((c) => c.suit === trump).sort(asc);
      if (trumps.length > 0 && (pts > 0 || isLast)) {
        const kill = trumps.find(win);
        if (kill) return kill;
      }
    }
    return [...legal].sort(cheapDisc)[0];
  };
}

/** 搭档意识三档（领出规则与 fastChooseCard 一致） */
export const greedyPlay = tacticPlay({ partnerAware: false, feed: false, ruff: true });
export const partnerSafePlay = tacticPlay({ partnerAware: true, feed: false, ruff: true });
export const feedPlay = tacticPlay({ partnerAware: true, feed: true, ruff: true });
export const feedSafePlay = tacticPlay({
  partnerAware: true, feed: true, ruff: true, feedOnlySafe: true,
});
export const noRuffPlay = tacticPlay({ partnerAware: true, feed: true, ruff: false });
/** 项目自带的启发式走子（作为对照“出厂策略”） */
export const fastPlay: PlayPolicy = (s, seat) => fastChooseCard(s, seat);

/**
 * 按角色拆分的出牌策略：庄家方（庄家+搭档）用 offense，闲家用 defense。
 * 这是把“进攻质量”和“防守质量”分开度量的关键（同一策略在两侧价值不同）。
 */
export function roleSplit(offense: PlayPolicy, defense: PlayPolicy): PlayPolicy {
  return (s, seat) => {
    if (s.declarer === null) return offense(s, seat);
    const mySide = seat % 2;
    const declSide = s.declarer % 2;
    return mySide === declSide ? offense(s, seat) : defense(s, seat);
  };
}

/** 蒙特卡洛搜索（项目原版：每个候选用各自的世界采样） */
export const searchPlay: PlayPolicy = (s, seat) => {
  return searchBestCardLocal(s, seat, FAST_BUDGET, false);
};

/** 蒙特卡洛搜索（修正版：所有候选拜同一组世界 = 共同随机数，方差更小） */
export const searchCrnPlay: PlayPolicy = (s, seat) => {
  return searchBestCardLocal(s, seat, FAST_BUDGET, true);
};

function searchBestCardLocal(
  s: GameState, seat: number, budget: SearchBudget, commonWorlds: boolean,
): Card {
  const legal = [...new Map(legalMoves(s, seat).map((c) => [`${c.rank}${c.suit}`, c])).values()];
  if (legal.length === 1) return legal[0];
  const cap = s.trick.length === 0 ? budget.maxLeadCandidates : budget.maxFollowCandidates;
  const cands = shortlistMoves(s, seat, Math.min(cap, legal.length));
  let best = cands[0];
  let bestScore = -Infinity;
  for (const card of cands) {
    let total = 0;
    for (let w = 0; w < budget.worldsPerMove; w++) {
      const salt = commonWorlds ? 4242 : cardValue(card) * 17;
      const rng = rngFrom(s.seed + seat * 131 + salt, w * 31 + 7);
      const hidden = sampleHiddenHands(s, seat, rng);
      const world: GameState = { ...s, hands: hidden.map((h) => [...h]) };
      const after = playCardAction(world, seat, card);
      const end = rolloutToEnd(after);
      total += sideUtility(end, seat);
    }
    const score = total / budget.worldsPerMove;
    if (score > bestScore) {
      bestScore = score;
      best = card;
    }
  }
  return best;
}

// ────────────────────────────── 统计工具 ──────────────────────────────

export const mean = (a: readonly number[]): number =>
  a.length === 0 ? NaN : a.reduce((x, y) => x + y, 0) / a.length;

export const sd = (a: readonly number[]): number => {
  if (a.length < 2) return NaN;
  const m = mean(a);
  return Math.sqrt(a.reduce((s, x) => s + (x - m) ** 2, 0) / (a.length - 1));
};

export function rateCI(p: number, n: number): [number, number] {
  const se = Math.sqrt((p * (1 - p)) / Math.max(1, n));
  return [p - 1.96 * se, p + 1.96 * se];
}

/** 配对差分（同种子跨策略）：mean(x - y) 及其 95% CI */
export function pairedDiff(x: readonly number[], y: readonly number[]) {
  const d = x.map((v, i) => v - y[i]);
  const m = mean(d);
  const se = sd(d) / Math.sqrt(d.length);
  return { diff: m, se, lo: m - 1.96 * se, hi: m + 1.96 * se, n: d.length };
}

export interface RunSummary {
  n: number;
  successRate: number;
  successCI: [number, number];
  meanBid: number;
  meanDeclarerPoints: number;
  meanDefenderPoints: number;
  meanStrength: number;
  meanHandPoints: number;
}

export function summarize(rows: readonly HandRow[]): RunSummary {
  const succ = rows.map((r) => (r.success ? 1 : 0));
  const p = mean(succ);
  return {
    n: rows.length,
    successRate: p,
    successCI: rateCI(p, rows.length),
    meanBid: mean(rows.map((r) => r.bid)),
    meanDeclarerPoints: mean(rows.map((r) => r.declarerPoints)),
    meanDefenderPoints: mean(rows.map((r) => r.defenderPoints)),
    meanStrength: mean(rows.map((r) => r.declStrength)),
    meanHandPoints: mean(rows.map((r) => r.declHandPoints)),
  };
}

export interface Bucket {
  lo: number;
  hi: number;
  n: number;
  rate: number;
  meanPoints: number;
}

/** 按区间分组统计（edges 升序，如 [70,75,80,...]；首尾为开区间） */
export function bucketSuccess(
  rows: readonly HandRow[],
  key: (r: HandRow) => number,
  edges: readonly number[],
): Bucket[] {
  const bounds = [-Infinity, ...edges, Infinity];
  const out: Bucket[] = [];
  for (let i = 0; i < bounds.length - 1; i++) {
    out.push({ lo: bounds[i], hi: bounds[i + 1], n: 0, rate: 0, meanPoints: 0 });
  }
  for (const r of rows) {
    const k = key(r);
    let idx = out.findIndex((b) => k >= b.lo && k < b.hi);
    if (idx < 0) idx = out.length - 1;
    const b = out[idx];
    b.n += 1;
    b.rate += r.success ? 1 : 0;
    b.meanPoints += r.declarerPoints;
  }
  for (const b of out) {
    if (b.n > 0) {
      b.rate = b.rate / b.n;
      b.meanPoints = b.meanPoints / b.n;
    }
  }
  return out.filter((b) => b.n > 0);
}

// ────────────────────────────── IO ──────────────────────────────

const here = path.dirname(fileURLToPath(import.meta.url));
export const resultsDir = path.join(here, 'results');

export function saveJson(name: string, data: unknown): void {
  fs.mkdirSync(resultsDir, { recursive: true });
  fs.writeFileSync(path.join(resultsDir, `${name}.json`), JSON.stringify(data, null, 2));
  console.log(`[saved] experiments/results/${name}.json`);
}

export function logTable(title: string, rows: Record<string, unknown>[]): void {
  console.log(`\n=== ${title} ===`);
  for (const r of rows) console.log(JSON.stringify(r));
}
