/** 历史快照纯领域校验（SRP / DIP）：白名单解析并用规则引擎重放，不依赖 UI、AI、存储或网络。 */
import { RANKS, SUITS, cardId, cardPoints } from '@yaozifen/game-core/cards';
import type { Card, Suit } from '@yaozifen/game-core/cards';
import { DEFAULT_RULES, basicScoring, bid, playCard } from '@yaozifen/game-core';
import type { GameState, HandResult, TrickCard } from '@yaozifen/game-core';

const fail = (message: string): never => { throw new Error('历史快照无效：' + message); };
function object(value: unknown, path: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return fail(path + ' 应为对象');
  return value as Record<string, unknown>;
}
function integer(value: unknown, path: string, min = 0, max = Number.MAX_SAFE_INTEGER): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < min || value > max) return fail(path + ' 超出范围');
  return value;
}
function seat(value: unknown, path: string): number { return integer(value, path, 0, 3); }
function nullableSeat(value: unknown, path: string): number | null { return value === null ? null : seat(value, path); }
function array(value: unknown, path: string, max: number): unknown[] {
  if (!Array.isArray(value) || value.length > max) return fail(path + ' 应为长度不超过 ' + max + ' 的数组');
  return value;
}
function suit(value: unknown): Suit {
  if (!SUITS.includes(value as Suit)) return fail('非法花色');
  return value as Suit;
}
function card(value: unknown): Card {
  const item = object(value, 'card');
  if (!RANKS.includes(item.rank as Card['rank'])) return fail('非法牌点');
  return { suit: suit(item.suit), rank: item.rank as Card['rank'] };
}
function cards(value: unknown, path: string): Card[] { return array(value, path, 52).map(card); }
function trickCards(value: unknown, path: string): TrickCard[] {
  return array(value, path, 4).map(value => {
    const item = object(value, path);
    return { seat: seat(item.seat, path + '.seat'), card: card(item.card) };
  });
}
function points(value: unknown, path: string, max = 100): number {
  const n = integer(value, path, 0, max);
  if (n % 5 !== 0) return fail(path + ' 应为 5 的倍数');
  return n;
}
function bidAmount(value: unknown, path: string): number {
  const n = integer(value, path, DEFAULT_RULES.minBid, DEFAULT_RULES.maxBid);
  if ((n - DEFAULT_RULES.minBid) % DEFAULT_RULES.bidStep !== 0) return fail(path + ' 叫分档位错误');
  return n;
}
function boolean(value: unknown, path: string): boolean {
  if (typeof value !== 'boolean') return fail(path + ' 应为布尔值');
  return value;
}
function result(value: unknown): HandResult | null {
  if (value === null) return null;
  const item = object(value, 'result');
  return { bid: bidAmount(item.bid, 'result.bid'), declarer: seat(item.declarer, 'result.declarer'),
    trump: suit(item.trump), declarerPoints: points(item.declarerPoints, 'result.declarerPoints'),
    defenderPoints: points(item.defenderPoints, 'result.defenderPoints'), buriedPoints: points(item.buriedPoints, 'result.buriedPoints', 40),
    success: boolean(item.success, 'result.success'), winnerSide: integer(item.winnerSide, 'result.winnerSide', 0, 1),
    earlyFinish: boolean(item.earlyFinish, 'result.earlyFinish'), unplayedPoints: points(item.unplayedPoints, 'result.unplayedPoints') };
}
function stable(value: unknown): string {
  if (Array.isArray(value)) return '[' + value.map(stable).join(',') + ']';
  if (value && typeof value === 'object') return '{' + Object.keys(value).sort().map(key =>
    JSON.stringify(key) + ':' + stable((value as Record<string, unknown>)[key])).join(',') + '}';
  return JSON.stringify(value);
}
function same(actual: unknown, expected: unknown, path: string): void {
  if (stable(actual) !== stable(expected)) fail(path + ' 与规则计算不一致');
}
function clone(state: GameState): GameState {
  return { ...state, hands: state.hands.map(hand => [...hand]), kitty: [...state.kitty], bidding: [...state.bidding],
    bidOrder: [...state.bidOrder], trick: [...state.trick], lastTrick: [...state.lastTrick],
    completedTricks: state.completedTricks.map(trick => ({ ...trick, cards: [...trick.cards] })),
    scores: [...state.scores], history: [...state.history], rules: { ...state.rules } };
}

/** 白名单复制所有 GameState 字段；无 JSON 转换，保留 seed/history，拒绝非基础规则后才挂载结算函数。 */
export function readBasicHistoryState(value: unknown): GameState {
  const item = object(value, 'snapshot'), rules = object(item.rules, 'rules');
  const ruleKeys = ['minBid', 'bidStep', 'maxBid', 'kittySize', 'handSize'] as const;
  for (const key of ruleKeys) {
    if (rules[key] !== DEFAULT_RULES[key]) fail('规则 ' + key + ' 与当前实现不一致，已拒绝加载');
  }
  if (Object.keys(rules).some(key => ![...ruleKeys, 'targetWins', 'scoring'].includes(key))) fail('未知规则字段');
  if (rules.scoring !== undefined && rules.scoring !== basicScoring) fail('只支持 basic-v1 结算规则（scoring）');
  const targetWins = integer(item.targetWins, 'targetWins', 1);
  same(rules.targetWins, targetWins, 'rules.targetWins');
  const phases: GameState['phase'][] = ['bidding', 'trump', 'bury', 'playing', 'handEnd', 'matchEnd'];
  if (!phases.includes(item.phase as GameState['phase'])) fail('未知阶段');
  const state: GameState = {
    phase: item.phase as GameState['phase'],
    hands: array(item.hands, 'hands', 4).map((hand, index) => cards(hand, 'hands[' + index + ']')),
    kitty: cards(item.kitty, 'kitty'), dealer: seat(item.dealer, 'dealer'),
    bidding: array(item.bidding, 'bidding', 4).map(value => {
      const note = object(value, 'bidding');
      return { seat: seat(note.seat, 'bidding.seat'), bid: note.bid === null ? null : bidAmount(note.bid, 'bidding.bid') };
    }),
    bidOrder: array(item.bidOrder, 'bidOrder', 4).map(value => seat(value, 'bidOrder')),
    highestBid: item.highestBid === 0 ? 0 : bidAmount(item.highestBid, 'highestBid'),
    highestBidder: nullableSeat(item.highestBidder, 'highestBidder'), declarer: nullableSeat(item.declarer, 'declarer'),
    trump: item.trump === null ? null : suit(item.trump), leader: integer(item.leader, 'leader', -1, 3),
    trick: trickCards(item.trick, 'trick'), lastTrick: trickCards(item.lastTrick, 'lastTrick'),
    lastWinner: nullableSeat(item.lastWinner, 'lastWinner'), lastPoints: points(item.lastPoints, 'lastPoints', 40),
    completedTricks: array(item.completedTricks, 'completedTricks', 12).map(value => {
      const trick = object(value, 'completedTricks');
      return { trickNumber: integer(trick.trickNumber, 'completedTricks.trickNumber', 1, 12),
        winner: seat(trick.winner, 'completedTricks.winner'), points: points(trick.points, 'completedTricks.points', 40),
        cards: trickCards(trick.cards, 'completedTricks.cards') };
    }),
    trickNumber: integer(item.trickNumber, 'trickNumber', 1, 12),
    declarerTrickPoints: points(item.declarerTrickPoints, 'declarerTrickPoints'),
    defenderTrickPoints: points(item.defenderTrickPoints, 'defenderTrickPoints'), buriedPoints: points(item.buriedPoints, 'buriedPoints', 40),
    scores: array(item.scores, 'scores', 2).map(value => integer(value, 'scores', 0, targetWins)) as [number, number],
    targetWins, result: result(item.result), history: array(item.history, 'history', Number.MAX_SAFE_INTEGER).map(value => {
      if (typeof value !== 'string') return fail('history 应为文本');
      return value;
    }),
    seed: integer(item.seed, 'seed', Number.MIN_SAFE_INTEGER), rules: { ...DEFAULT_RULES, targetWins },
  };
  validateBasicHistoryState(state);
  return state;
}

/** 完整牌张唯一归属、叫分与出牌合法性、得分守恒及结算/整场阶段校验。 */
export function validateBasicHistoryState(state: GameState): void {
  if (state.hands.length !== 4) fail('手牌数量错误');
  if (state.scores.length !== 2) fail('比分数错误');
  if (state.kitty.length !== DEFAULT_RULES.kittySize) fail('底牌数量错误');
  const hasPlay = ['playing', 'handEnd', 'matchEnd'].includes(state.phase);
  const terminal = state.phase === 'handEnd' || state.phase === 'matchEnd';
  const owners = [...state.hands.flat(), ...state.trick.map(entry => entry.card),
    ...state.completedTricks.flatMap(trick => trick.cards.map(entry => entry.card))];
  // 拿底阶段 kitty 是原底牌引用，已经属于庄家的 16 张手牌，不重复计为独立所有者。
  if (state.phase !== 'bury') owners.push(...state.kitty);
  if (owners.length !== 52 || new Set(owners.map(cardId)).size !== 52) fail('52 张牌必须完整且归属唯一');
  const expectedOrder = [1, 2, 3, 0].map(offset => (state.dealer + offset) % 4);
  same(state.bidOrder, expectedOrder, '叫分顺序');
  let biddingState: GameState = { ...clone(state), phase: 'bidding', bidding: [],
    highestBid: 0, highestBidder: null, declarer: null, leader: -1 };
  try { for (const note of state.bidding) biddingState = bid(biddingState, note.seat, note.bid); }
  catch { fail('叫分历史不合法'); }
  for (const field of ['bidding', 'highestBid', 'highestBidder', 'declarer'] as const) same(state[field], biddingState[field], field);
  if (state.phase === 'bidding' && state.bidding.length >= 4) fail('叫分阶段已结束');
  if (state.phase !== 'bidding' && (state.bidding.length !== 4 || state.declarer === null)) fail('缺少完整叫分历史');
  if (!hasPlay) {
    state.hands.forEach((hand, index) => same(hand.length, state.phase === 'bury' && index === state.declarer ? 16 : 12, '手牌张数'));
    if (state.phase === 'bury' && (new Set(state.kitty.map(cardId)).size !== 4
      || !state.kitty.every(card => state.hands[state.declarer!].some(handCard => cardId(handCard) === cardId(card))))) fail('摸入底牌必须在庄家手牌中且不能重复');
    if ((state.phase === 'bury') !== (state.trump !== null)) fail('阶段与主花色不一致');
    for (const field of ['trick', 'lastTrick', 'completedTricks'] as const) same(state[field], [], field);
    for (const field of ['lastPoints', 'declarerTrickPoints', 'defenderTrickPoints', 'buriedPoints'] as const) same(state[field], 0, field);
    same(state.result, null, 'result'); same(state.lastWinner, null, 'lastWinner'); same(state.trickNumber, 1, 'trickNumber');
    same(state.leader, state.phase === 'bidding' ? -1 : state.declarer, 'leader');
  } else {
    if (state.trump === null || state.declarer === null || state.trick.length > 3) fail('出牌阶段缺少主花色、庄家或未完成牌墩错误');
    if (state.kitty.some(card => cardPoints(card) > 0)) fail('分牌不能埋牌');
    const start = clone(state);
    start.hands = start.hands.map((hand, index) => [...hand,
      ...state.completedTricks.flatMap(trick => trick.cards.filter(entry => entry.seat === index).map(entry => entry.card)),
      ...state.trick.filter(entry => entry.seat === index).map(entry => entry.card)]);
    start.hands.forEach(hand => same(hand.length, 12, '历史恢复后的手牌张数'));
    Object.assign(start, { phase: 'playing', leader: state.declarer, trick: [], lastTrick: [], lastWinner: null,
      lastPoints: 0, completedTricks: [], trickNumber: 1, declarerTrickPoints: 0, defenderTrickPoints: 0,
      buriedPoints: 0, result: null });
    if (terminal) {
      if (state.result === null) return fail('缺少本副结算');
      start.scores[state.result.winnerSide]--;
      if (start.scores[state.result.winnerSide] < 0) fail('本副胜方计分缺失');
    } else same(state.result, null, 'result');
    if (start.scores.some(score => score >= state.targetWins)) fail('本副开始前整场已经结束');
    let replayed = start;
    try {
      for (const trick of state.completedTricks) {
        if (trick.cards.length !== 4) fail('牌墩历史不完整');
        for (const played of trick.cards) replayed = playCard(replayed, played.seat, played.card);
      }
      for (const played of state.trick) replayed = playCard(replayed, played.seat, played.card);
    } catch (error) { fail('出牌历史不合法：' + (error instanceof Error ? error.message : String(error))); }
    for (const field of ['phase', 'hands', 'leader', 'trick', 'lastTrick', 'lastWinner', 'lastPoints', 'completedTricks',
      'trickNumber', 'declarerTrickPoints', 'defenderTrickPoints', 'buriedPoints', 'scores', 'result'] as const) same(state[field], replayed[field], field);
    const unplayed = [...state.hands.flat(), ...state.trick.map(entry => entry.card)].reduce((sum, card) => sum + cardPoints(card), 0);
    same(state.declarerTrickPoints + state.defenderTrickPoints + state.buriedPoints + unplayed, 100, '全副分数守恒');
  }
  if (state.scores.some(score => score >= state.targetWins) !== (state.phase === 'matchEnd')) fail('阶段与整场胜副数不一致');
}
