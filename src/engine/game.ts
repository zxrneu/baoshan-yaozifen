/**
 * 对局状态机：发牌/叫分/定主/扣底/出牌/副间推进。
 * 每个动作接收不可变状态、返回新状态；非法动作抛 IllegalActionError。
 */
import {
  Card, Rng, Suit, cardPoints, freshDeck, makeRng, shuffle,
} from '../cards';
import {
  BiddingNote, GameState, IllegalActionError, SEAT_NAMES, SIDE_NAMES,
  TrickCard, partnerOf, sideOf,
} from './types';
import { RuleConfig, HandResult, DEFAULT_RULES, OPEN_PARTNER_BID } from './rules';
import { trickWinner } from './trick';

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
  state.lastTrick = [];
  state.lastWinner = null;
  state.lastPoints = 0;
  state.completedTricks = [];
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
    lastTrick: [],
    lastWinner: null,
    lastPoints: 0,
    completedTricks: [],
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

/** 明牌只在扣底成功后生效；由本副状态推导，换副/重开自然恢复暗牌。 */
export function revealedPartnerSeat(
  state: Pick<GameState, 'phase' | 'highestBid' | 'declarer'>,
): number | null {
  if (state.highestBid !== OPEN_PARTNER_BID || state.declarer === null
    || !['playing', 'handEnd', 'matchEnd'].includes(state.phase)) return null;
  return partnerOf(state.declarer);
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

/** 叫分。amount = null 表示不叫。 */
export function bid(state: GameState, seat: number, amount: number | null): GameState {
  const rules = state.rules;
  if (state.phase !== 'bidding') throw new IllegalActionError('当前不在叫分阶段');
  if (seat !== currentBidder(state)) throw new IllegalActionError('还没轮到该家叫分');
  const s = clone(state);
  if (amount === null) {
    s.bidding = [...s.bidding, { seat, bid: null } satisfies BiddingNote];
    push(s, `${SEAT_NAMES[seat]} 不叫。`);
  } else {
    const lowest = Math.max(rules.minBid, s.highestBid + rules.bidStep);
    if (amount < lowest || amount > rules.maxBid || (amount - rules.minBid) % rules.bidStep !== 0) {
      throw new IllegalActionError(`非法叫分 ${amount}（应为 ${lowest}~${rules.maxBid} 且为 ${rules.bidStep} 的倍数档）`);
    }
    s.bidding = [...s.bidding, { seat, bid: amount } satisfies BiddingNote];
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
  const revealed = revealedPartnerSeat(s);
  if (revealed !== null) push(s, `叫满 ${OPEN_PARTNER_BID} 分，${SEAT_NAMES[revealed]} 作为庄家搭档明牌，剩余手牌对所有人可见。`);
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
  s.trick = [...s.trick, { seat, card } satisfies TrickCard];

  if (s.trick.length < 4) return s;

  // 结算一轮
  const win = trickWinner(s.trick, trump);
  const pts = s.trick.reduce((a, t) => a + cardPoints(t.card), 0);
  if (sideOf(win.seat) === sideOf(s.declarer!)) s.declarerTrickPoints += pts;
  else s.defenderTrickPoints += pts;
  push(s, `第 ${s.trickNumber} 轮：${SEAT_NAMES[win.seat]} 收走 ${pts} 分。`);
  s.completedTricks = [
    ...(s.completedTricks ?? []),
    {
      trickNumber: s.trickNumber,
      winner: win.seat,
      points: pts,
      cards: [...s.trick],
    },
  ];
  s.lastTrick = [...s.trick];
  s.lastWinner = win.seat;
  s.lastPoints = pts;
  s.trick = [];
  s.leader = win.seat;

  if (s.trickNumber >= 12) return finishHand(s);
  s.trickNumber += 1;
  return s;
}

function finishHand(s: GameState): GameState {
  const result: HandResult = s.rules.scoring({
    bid: s.highestBid,
    declarer: s.declarer!,
    declarerSide: sideOf(s.declarer!),
    trump: s.trump!,
    declarerTrickPoints: s.declarerTrickPoints,
    defenderTrickPoints: s.defenderTrickPoints,
    kitty: s.kitty,
  });
  s.result = result;
  s.scores = [...s.scores] as [number, number];
  s.scores[result.winnerSide] += 1;
  push(
    s,
    `本副结算：庄家方吃 ${result.declarerPoints} 分（含底牌 ${result.buriedPoints} 分），叫 ${result.bid} 分 → ${result.success ? '成' : '不成'}，${SIDE_NAMES[result.winnerSide]} 胜。`,
  );
  if (s.scores[result.winnerSide] >= s.targetWins) {
    s.phase = 'matchEnd';
    push(s, `整场结束：${SIDE_NAMES[result.winnerSide]} 先胜 ${s.targetWins} 副，赢得本场！`);
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
    lastTrick: [...s.lastTrick],
    completedTricks: s.completedTricks ? s.completedTricks.map((t) => ({ ...t, cards: [...t.cards] })) : [],
    scores: [...s.scores] as [number, number],
    history: [...s.history],
  };
}
