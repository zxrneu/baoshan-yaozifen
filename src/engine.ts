/**
 * 幺子分规则引擎（v1 初版，纯函数式状态机，无 UI 依赖）。
 *
 * 规则来源为公开资料整理（README「规则」一节列出处与存疑项）：
 * - 四人、两搭档：东(0)西(2) 为一方，南(1)北(3) 为一方；逆时针出牌。
 * - 一副牌 52 张，每人 12 张，留 4 张底牌。
 * - 叫分：发牌者下家开始轮流叫分（步长 5，最低 40，最高 100），最高者为庄家；
 *   四家都不叫则重新发牌（庄家顺延）。
 * - 定主：庄家从四门花色中选一门为主牌。
 * - 扣底：庄家拿进 4 张底牌（手牌 16 张），再扣回 4 张作为新底牌；
 *   分牌（A/10/5）不能扣回底牌。
 * - 出牌：庄家首家领出；有同门必须跟同门，缺门可用主牌杀，也可垫牌（垫牌不计大）。
 *   主牌压过任何非主牌；同一类中牌力大者赢。每墩大者下墩先出。
 * - 结算：庄家方吃分 + 底牌分 ≥ 叫分即成；否则闲家方成。
 *
 * v1 简化：一局（match）先胜 targetWins 副即获胜；未实现"抠底翻倍"等地方变体。
 */

import {
  Card, Suit, cardPoints, cardValue, freshDeck, makeRng, shuffle, Rng,
} from './cards';

export type Phase = 'bidding' | 'trump' | 'bury' | 'playing' | 'handEnd' | 'matchEnd';

/** 座位：0=东 1=南 2=西 3=北；座位 % 2 即所属方（0=东西方, 1=南北方） */
export const SEAT_NAMES = ['东', '南', '西', '北'] as const;
export const SIDE_NAMES = ['东西方', '南北方'] as const;

export const sideOf = (seat: number): number => seat % 2;
export const partnerOf = (seat: number): number => (seat + 2) % 4;

export interface BiddingNote {
  seat: number;
  bid: number | null; // null = 不叫
}

export interface TrickCard {
  seat: number;
  card: Card;
}

export interface HandResult {
  bid: number;
  declarer: number;
  trump: Suit;
  /** 庄家方吃分（墩上分 + 底牌分） */
  declarerPoints: number;
  /** 闲家方吃分 */
  defenderPoints: number;
  /** 底牌分（归庄家方） */
  buriedPoints: number;
  success: boolean;
  /** 本副获胜方（0=东西, 1=南北） */
  winnerSide: number;
}

export interface GameState {
  phase: Phase;
  hands: Card[][];
  kitty: Card[];
  dealer: number;
  bidding: BiddingNote[];
  /** 叫分顺序（座位序列），从发牌者下家开始 */
  bidOrder: number[];
  highestBid: number;
  highestBidder: number | null;
  declarer: number | null;
  trump: Suit | null;
  leader: number;
  trick: TrickCard[];
  trickNumber: number; // 1..12
  declarerTrickPoints: number;
  defenderTrickPoints: number;
  buriedPoints: number;
  /** 各方已胜副数 [东西, 南北] */
  scores: [number, number];
  targetWins: number;
  result: HandResult | null;
  history: string[];
  seed: number;
  rules: RuleConfig;
}

export class IllegalActionError extends Error {}

export interface RuleConfig {
  minBid: number;
  bidStep: number;
  maxBid: number;
  kittySize: number;
  handSize: number;
  targetWins: number;
}

export const DEFAULT_RULES: RuleConfig = {
  minBid: 40,
  bidStep: 5,
  maxBid: 100,
  kittySize: 4,
  handSize: 12,
  targetWins: 5,
};

const push = (s: GameState, line: string): void => {
  s.history = [...s.history, line];
};

function deal(state: GameState, rng: Rng, rules: RuleConfig): void {
  const deck = shuffle(freshDeck(), rng);
  const { handSize, kittySize } = rules;
  state.phase = 'bidding';
  state.hands = [
    deck.slice(0, handSize),
    deck.slice(handSize, handSize * 2),
    deck.slice(handSize * 2, handSize * 3),
    deck.slice(handSize * 3, handSize * 4),
  ];
  state.kitty = deck.slice(handSize * 4, handSize * 4 + kittySize);
  state.bidding = [];
  state.bidOrder = [
    (state.dealer + 1) % 4,
    (state.dealer + 2) % 4,
    (state.dealer + 3) % 4,
    state.dealer,
  ];
  state.highestBid = 0;
  state.highestBidder = null;
  state.declarer = null;
  state.trump = null;
  state.leader = -1;
  state.trick = [];
  state.trickNumber = 1;
  state.declarerTrickPoints = 0;
  state.defenderTrickPoints = 0;
  state.buriedPoints = 0;
  state.result = null;
}

export function createGame(seed = Date.now(), config: Partial<RuleConfig> = {}): GameState {
  const rules: RuleConfig = { ...DEFAULT_RULES, ...config };
  const state: GameState = {
    phase: 'bidding',
    hands: [],
    kitty: [],
    dealer: 0,
    bidding: [],
    bidOrder: [],
    highestBid: 0,
    highestBidder: null,
    declarer: null,
    trump: null,
    leader: 0,
    trick: [],
    trickNumber: 1,
    declarerTrickPoints: 0,
    defenderTrickPoints: 0,
    buriedPoints: 0,
    scores: [0, 0],
    targetWins: rules.targetWins,
    result: null,
    history: [],
    seed,
    rules,
  };
  deal(state, makeRng(seed), rules);
  push(state, `发牌完成（庄家位 ${SEAT_NAMES[state.dealer]}），进入叫分。`);
  return state;
}

/** 当前叫分轮到哪家 */
export function currentBidder(state: GameState): number | null {
  if (state.phase !== 'bidding') return null;
  return state.bidOrder[state.bidding.length] ?? null;
}

/** 当前行动座位（叫分/定主/扣底/出牌） */
export function currentSeat(state: GameState): number {
  switch (state.phase) {
    case 'bidding':
      return currentBidder(state) ?? state.dealer;
    case 'trump':
    case 'bury':
      return state.declarer ?? state.dealer;
    case 'playing':
      return (state.leader + state.trick.length) % 4;
    default:
      return -1;
  }
}

export function sidePoints(state: GameState, side: number): number {
  return side === sideOf(state.declarer ?? 0)
    ? state.declarerTrickPoints + state.buriedPoints
    : state.defenderTrickPoints;
}

/** 庄家可叫的合法分数（不含"不叫"） */
export function legalBids(state: GameState): number[] {
  const { minBid, bidStep, maxBid } = state.rules;
  const out: number[] = [];
  const lowest = Math.max(minBid, state.highestBid + bidStep);
  for (let b = lowest; b <= maxBid; b += bidStep) out.push(b);
  return out;
}

/**
 * 叫分。amount = null 表示不叫。
 */
export function bid(state: GameState, seat: number, amount: number | null): GameState {
  const rules = state.rules;
  if (state.phase !== 'bidding') throw new IllegalActionError('当前不在叫分阶段');
  if (seat !== currentBidder(state)) throw new IllegalActionError('还没轮到该家叫分');
  const s = clone(state);
  if (amount === null) {
    s.bidding = [...s.bidding, { seat, bid: null }];
    push(s, `${SEAT_NAMES[seat]} 不叫。`);
  } else {
    const lowest = Math.max(rules.minBid, s.highestBid + rules.bidStep);
    if (amount < lowest || amount > rules.maxBid || (amount - rules.minBid) % rules.bidStep !== 0) {
      throw new IllegalActionError(`非法叫分 ${amount}（应为 ${lowest}~${rules.maxBid} 且为 ${rules.bidStep} 的倍数档）`);
    }
    s.bidding = [...s.bidding, { seat, bid: amount }];
    s.highestBid = amount;
    s.highestBidder = seat;
    push(s, `${SEAT_NAMES[seat]} 叫 ${amount} 分。`);
  }

  if (s.bidding.length === 4) {
    if (s.highestBidder === null) {
      // 四家不叫：庄家顺延，重新发牌
      s.dealer = (s.dealer + 1) % 4;
      push(s, '四家均不叫，重新发牌（庄家顺延）。');
      deal(s, makeRng(s.seed + s.bidding.length + s.dealer * 7 + 1), s.rules);
      return s;
    }
    s.declarer = s.highestBidder;
    s.leader = s.declarer;
    s.phase = 'trump';
    push(s, `${SEAT_NAMES[s.declarer]} 以 ${s.highestBid} 分成为庄家，请定主。`);
  }
  return s;
}

/** 庄家定主 */
export function declareTrump(state: GameState, seat: number, trump: Suit): GameState {
  if (state.phase !== 'trump') throw new IllegalActionError('当前不在定主阶段');
  if (seat !== state.declarer) throw new IllegalActionError('只有庄家可以定主');
  const s = clone(state);
  s.trump = trump;
  s.phase = 'bury';
  // 庄家拿进底牌
  s.hands = s.hands.map((h, i) => (i === seat ? [...h, ...s.kitty] : h));
  push(s, `${SEAT_NAMES[seat]} 定主 ${trump}，拿进 ${state.kitty.length} 张底牌（现 16 张），请扣回 ${state.kitty.length} 张。`);
  return s;
}

/** 庄家扣底：从 16 张手牌中选 kittySize 张非分牌扣回 */
export function bury(state: GameState, seat: number, cards: Card[]): GameState {
  if (state.phase !== 'bury') throw new IllegalActionError('当前不在扣底阶段');
  if (seat !== state.declarer) throw new IllegalActionError('只有庄家可以扣底');
  const n = state.kitty.length;
  if (cards.length !== n) throw new IllegalActionError(`需扣回恰好 ${n} 张`);
  const uniq = new Set(cards.map((c) => `${c.rank}${c.suit}`));
  if (uniq.size !== n) throw new IllegalActionError('扣底的牌不能重复');
  const hand = state.hands[seat];
  for (const c of cards) {
    if (!hand.some((x) => x.rank === c.rank && x.suit === c.suit)) {
      throw new IllegalActionError('扣底的牌不在手牌中');
    }
    if (cardPoints(c) > 0) throw new IllegalActionError('分牌（A/10/5）不能扣回底牌');
  }
  const s = clone(state);
  const burySet = uniq;
  s.hands = s.hands.map((h, i) =>
    i === seat ? h.filter((c) => !burySet.has(`${c.rank}${c.suit}`)) : h,
  );
  s.kitty = [...cards];
  s.buriedPoints = cards.reduce((a, c) => a + cardPoints(c), 0);
  s.phase = 'playing';
  s.leader = seat;
  push(s, `${SEAT_NAMES[seat]} 扣回 ${n} 张底牌，庄家首家领出。`);
  return s;
}

/** 某家当前合法出牌 */
export function legalMoves(state: GameState, seat: number): Card[] {
  if (state.phase !== 'playing') return [];
  if (seat !== currentSeat(state)) return [];
  const hand = state.hands[seat];
  if (state.trick.length === 0) return [...hand];
  const led = state.trick[0].card.suit;
  const follow = hand.filter((c) => c.suit === led);
  return follow.length > 0 ? follow : [...hand];
}

/** 比较两张牌在当前墩中的大小（a 能否压过 b） */
export function beats(a: Card, b: Card, trump: Suit): boolean {
  const aT = a.suit === trump;
  const bT = b.suit === trump;
  if (aT !== bT) return aT;
  if (a.suit !== b.suit) return false; // 同为非主且不同门：压不过
  return cardValue(a) > cardValue(b);
}

/** 计算当前墩赢家 */
export function trickWinner(trick: TrickCard[], trump: Suit): TrickCard {
  let best = trick[0];
  for (let i = 1; i < trick.length; i++) {
    if (beats(trick[i].card, best.card, trump)) best = trick[i];
  }
  return best;
}

/** 出一张牌 */
export function playCard(state: GameState, seat: number, card: Card): GameState {
  if (state.phase !== 'playing') throw new IllegalActionError('当前不在出牌阶段');
  if (seat !== currentSeat(state)) throw new IllegalActionError('还没轮到该家出牌');
  const legal = legalMoves(state, seat);
  if (!legal.some((c) => c.rank === card.rank && c.suit === card.suit)) {
    throw new IllegalActionError(`非法出牌 ${card.rank}${card.suit}（必须跟同门）`);
  }
  const trump = state.trump!;
  const s = clone(state);
  const hand = s.hands[seat];
  const idx = hand.findIndex((c) => c.rank === card.rank && c.suit === card.suit);
  s.hands = s.hands.map((h, i) => (i === seat ? [...h.slice(0, idx), ...h.slice(idx + 1)] : h));
  s.trick = [...s.trick, { seat, card }];

  if (s.trick.length < 4) return s;

  // 结算一墩
  const win = trickWinner(s.trick, trump);
  const pts = s.trick.reduce((a, t) => a + cardPoints(t.card), 0);
  if (sideOf(win.seat) === sideOf(s.declarer!)) s.declarerTrickPoints += pts;
  else s.defenderTrickPoints += pts;
  push(s, `第 ${s.trickNumber} 墩：${SEAT_NAMES[win.seat]} 收走 ${pts} 分。`);
  s.trick = [];
  s.leader = win.seat;

  if (s.trickNumber >= 12) return finishHand(s);
  s.trickNumber += 1;
  return s;
}

function finishHand(s: GameState): GameState {
  const declarerSide = sideOf(s.declarer!);
  const buried = s.kitty.reduce((a, c) => a + cardPoints(c), 0);
  const declarerPoints = s.declarerTrickPoints + buried;
  const defenderPoints = s.defenderTrickPoints;
  const success = declarerPoints >= s.highestBid;
  const winnerSide = success ? declarerSide : 1 - declarerSide;
  const result: HandResult = {
    bid: s.highestBid,
    declarer: s.declarer!,
    trump: s.trump!,
    declarerPoints,
    defenderPoints,
    buriedPoints: buried,
    success,
    winnerSide,
  };
  s.result = result;
  s.scores = [...s.scores] as [number, number];
  s.scores[winnerSide] += 1;
  push(
    s,
    `本副结算：庄家方吃 ${declarerPoints} 分（含底牌 ${buried} 分），叫 ${result.bid} 分 → ${success ? '成' : '不成'}，${SIDE_NAMES[winnerSide]} 胜。`,
  );
  if (s.scores[winnerSide] >= s.targetWins) {
    s.phase = 'matchEnd';
    push(s, `整场结束：${SIDE_NAMES[winnerSide]} 先胜 ${s.targetWins} 副，赢得本场！`);
  } else {
    s.phase = 'handEnd';
  }
  return s;
}

/** 开始下一副（发牌者顺延） */
export function nextHand(state: GameState): GameState {
  if (state.phase !== 'handEnd') throw new IllegalActionError('当前对局尚未结束，不能开始下一局');
  const s = clone(state);
  s.dealer = (s.dealer + 1) % 4;
  deal(s, makeRng(s.seed + 1000 + s.dealer), s.rules);
  push(s, `新一副开始（庄家位 ${SEAT_NAMES[s.dealer]}），进入叫分。`);
  return s;
}

function clone(s: GameState): GameState {
  return {
    ...s,
    hands: s.hands.map((h) => [...h]),
    kitty: [...s.kitty],
    bidding: [...s.bidding],
    bidOrder: [...s.bidOrder],
    trick: [...s.trick],
    scores: [...s.scores] as [number, number],
    history: [...s.history],
  };
}
