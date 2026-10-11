import { Card, RANKS, SUITS, cardId, cardPoints } from '../cards';
import { GameState, DEFAULT_RULES, basicScoring, bid, playCard, nextHand } from '../engine';
import { AiAction } from '../ai/types';
import { applyAiAction } from '../ai/applyAction';
import type { EngineType } from '../ai/engines/engineTypes';
import type { SessionCommand } from './session';

export interface SnapshotConfig { activeEngine: EngineType }
export interface GameSnapshot {
  format: 'game-snapshot';
  schemaVersion: 1;
  ruleSetId: 'basic-v1';
  exportedAt: string;
  state: Omit<GameState, 'rules'> & { rules: Omit<GameState['rules'], 'scoring'> };
  config: SnapshotConfig;
  replay?: { initialState: GameSnapshot['state']; commands: SessionCommand[] };
}
const fail = (message: string): never => { throw new Error('快照无效：' + message); };
function object(value: unknown, path: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) fail(path + ' 应为对象');
  return value as Record<string, unknown>;
}
function integer(value: unknown, path: string, min = 0, max = Number.MAX_SAFE_INTEGER): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < min || value > max) fail(path + ' 超出范围');
  return value as number;
}
function seat(value: unknown, path: string): number { return integer(value, path, 0, 3); }
function nullableSeat(value: unknown, path: string): number | null { return value === null ? null : seat(value, path); }
function array(value: unknown, path: string, max: number): unknown[] {
  if (!Array.isArray(value) || value.length > max) fail(path + ' 应为长度不超过 ' + max + ' 的数组');
  return value as unknown[];
}
function suit(value: unknown): Card['suit'] {
  if (!SUITS.includes(value as Card['suit'])) fail('非法花色');
  return value as Card['suit'];
}
function card(value: unknown): Card {
  const item = object(value, 'card');
  if (!RANKS.includes(item.rank as Card['rank'])) fail('非法牌点');
  return { suit: suit(item.suit), rank: item.rank as Card['rank'] };
}
function cards(value: unknown, path: string): Card[] { return array(value, path, 52).map(card); }
function trickCards(value: unknown, path: string) {
  return array(value, path, 4).map(value => {
    const item = object(value, path);
    return { seat: seat(item.seat, path), card: card(item.card) };
  });
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
function serialized(state: GameState): GameSnapshot['state'] {
  if (state.rules.scoring !== basicScoring) fail('第一版只支持 basic-v1 结算规则');
  const { scoring: _scoring, ...rules } = state.rules;
  return JSON.parse(JSON.stringify({ ...state, rules }));
}
export function cloneGameState(state: GameState): GameState {
  return { ...JSON.parse(JSON.stringify(state)), rules: { ...state.rules } };
}
function readState(value: unknown): GameState {
  const item = object(value, 'state');
  const ruleValues = object(item.rules, 'rules');
  // This registry intentionally excludes imported functions and unsupported rule variants.
  for (const key of ['minBid', 'bidStep', 'maxBid', 'kittySize', 'handSize'] as const) {
    same(ruleValues[key], DEFAULT_RULES[key], 'rules.' + key);
  }
  const targetWins = integer(item.targetWins, 'targetWins', 1, 100);
  same(ruleValues.targetWins, targetWins, 'rules.targetWins');
  const phases = ['bidding', 'trump', 'bury', 'playing', 'handEnd', 'matchEnd'];
  if (!phases.includes(item.phase as string)) fail('未知阶段');
  const state: GameState = {
    phase: item.phase as GameState['phase'],
    hands: array(item.hands, 'hands', 4).map((hand, i) => cards(hand, 'hands[' + i + ']')),
    kitty: cards(item.kitty, 'kitty'), dealer: seat(item.dealer, 'dealer'),
    bidding: array(item.bidding, 'bidding', 4).map(value => {
      const note = object(value, 'bid');
      return { seat: seat(note.seat, 'bid.seat'), bid: note.bid === null ? null : integer(note.bid, 'bid', 70, 100) };
    }),
    bidOrder: array(item.bidOrder, 'bidOrder', 4).map(value => seat(value, 'bidOrder')),
    highestBid: integer(item.highestBid, 'highestBid', 0, 100),
    highestBidder: nullableSeat(item.highestBidder, 'highestBidder'),
    declarer: nullableSeat(item.declarer, 'declarer'), trump: item.trump === null ? null : suit(item.trump),
    leader: integer(item.leader, 'leader', -1, 3), trick: trickCards(item.trick, 'trick'),
    lastTrick: trickCards(item.lastTrick, 'lastTrick'), lastWinner: nullableSeat(item.lastWinner, 'lastWinner'),
    lastPoints: integer(item.lastPoints, 'lastPoints', 0, 40),
    completedTricks: array(item.completedTricks, 'completedTricks', 12).map(value => {
      const trick = object(value, 'completedTrick');
      return { trickNumber: integer(trick.trickNumber, 'trickNumber', 1, 12),
        winner: seat(trick.winner, 'winner'), points: integer(trick.points, 'points', 0, 40),
        cards: trickCards(trick.cards, 'completedTrick.cards') };
    }),
    trickNumber: integer(item.trickNumber, 'trickNumber', 1, 12),
    declarerTrickPoints: integer(item.declarerTrickPoints, 'declarerTrickPoints', 0, 100),
    defenderTrickPoints: integer(item.defenderTrickPoints, 'defenderTrickPoints', 0, 100),
    buriedPoints: integer(item.buriedPoints, 'buriedPoints', 0, 40),
    scores: array(item.scores, 'scores', 2).map(value => integer(value, 'scores', 0, 100)) as [number, number],
    targetWins, result: item.result === null ? null : object(item.result, 'result') as unknown as GameState['result'],
    history: array(item.history, 'history', 10000).map(value => {
      if (typeof value !== 'string' || value.length > 2000) fail('history 应为文本');
      return value as string;
    }),
    seed: integer(item.seed, 'seed', 0), rules: { ...DEFAULT_RULES, targetWins },
  };
  validateState(state);
  return state;
}
export function validateState(state: GameState): void {
  if (state.hands.length !== 4 || state.scores.length !== 2 || state.kitty.length !== 4) fail('手牌、底牌或计分数量错误');
  const hasPlay = ['playing', 'handEnd', 'matchEnd'].includes(state.phase);
  const terminal = state.phase === 'handEnd' || state.phase === 'matchEnd';
  const owners = [...state.hands.flat(), ...state.trick.map(t => t.card), ...state.completedTricks.flatMap(t => t.cards.map(c => c.card))];
  // While burying, the original kitty is already inside the declarer's sixteen cards.
  if (state.phase !== 'bury') owners.push(...state.kitty);
  if (owners.length !== 52 || new Set(owners.map(cardId)).size !== 52) fail('52 张牌必须完整且归属唯一');
  const expectedOrder = [1, 2, 3, 0].map(offset => (state.dealer + offset) % 4);
  same(state.bidOrder, expectedOrder, '叫分顺序');
  let biddingState: GameState = { ...cloneGameState(state), phase: 'bidding', bidding: [],
    highestBid: 0, highestBidder: null, declarer: null, leader: -1 };
  try { for (const note of state.bidding) biddingState = bid(biddingState, note.seat, note.bid); }
  catch { fail('叫分历史不合法'); }
  for (const field of ['bidding', 'highestBid', 'highestBidder', 'declarer'] as const) same(state[field], biddingState[field], field);
  if (state.phase === 'bidding' && state.bidding.length >= 4) fail('叫分阶段已结束');
  if (state.phase !== 'bidding' && (state.bidding.length !== 4 || state.declarer === null)) fail('缺少完整叫分历史');
  if (!hasPlay) {
    state.hands.forEach((hand, index) => same(hand.length, state.phase === 'bury' && index === state.declarer ? 16 : 12, '手牌张数'));
    if (state.phase === 'bury' && !state.kitty.every(c => state.hands[state.declarer!].some(h => cardId(h) === cardId(c)))) fail('摸入底牌必须在庄家手牌中');
    if ((state.phase === 'bury') !== (state.trump !== null)) fail('阶段与主花色不一致');
    for (const field of ['trick', 'lastTrick', 'completedTricks'] as const) same(state[field], [], field);
    for (const field of ['lastPoints', 'declarerTrickPoints', 'defenderTrickPoints', 'buriedPoints'] as const) same(state[field], 0, field);
    same(state.result, null, 'result'); same(state.lastWinner, null, 'lastWinner'); same(state.trickNumber, 1, 'trickNumber');
    same(state.leader, state.phase === 'bidding' ? -1 : state.declarer, 'leader');
  } else {
    if (state.trump === null || state.declarer === null || state.trick.length > 3) fail('出牌阶段缺少主花色、庄家或未完成牌墩错误');
    if (state.kitty.some(c => cardPoints(c) > 0)) fail('分牌不能埋牌');
    const start = cloneGameState(state);
    start.hands = start.hands.map((hand, index) => [...hand,
      ...state.completedTricks.flatMap(t => t.cards.filter(c => c.seat === index).map(c => c.card)),
      ...state.trick.filter(c => c.seat === index).map(c => c.card)]);
    start.hands.forEach(hand => same(hand.length, 12, '历史恢复后的手牌张数'));
    Object.assign(start, { phase: 'playing', leader: state.declarer, trick: [], lastTrick: [], lastWinner: null,
      lastPoints: 0, completedTricks: [], trickNumber: 1, declarerTrickPoints: 0, defenderTrickPoints: 0, buriedPoints: 0, result: null });
    if (terminal) {
      const result = object(state.result, 'result');
      const winner = integer(result.winnerSide, 'winnerSide', 0, 1);
      start.scores[winner]--;
      if (start.scores[winner] < 0) fail('本副胜方计分缺失');
    } else same(state.result, null, 'result');
    let replayed = start;
    try {
      for (const trick of state.completedTricks) {
        if (trick.cards.length !== 4) fail('牌墩历史不完整');
        for (const played of trick.cards) replayed = playCard(replayed, played.seat, played.card);
      }
      for (const played of state.trick) replayed = playCard(replayed, played.seat, played.card);
    } catch (error) { fail('出牌历史不合法：' + (error instanceof Error ? error.message : String(error))); }
    for (const field of ['phase', 'leader', 'trick', 'lastTrick', 'lastWinner', 'lastPoints', 'completedTricks',
      'trickNumber', 'declarerTrickPoints', 'defenderTrickPoints', 'buriedPoints', 'scores', 'result'] as const) same(state[field], replayed[field], field);
  }
  if (state.scores.some(score => score >= state.targetWins) !== (state.phase === 'matchEnd')) fail('阶段与整场胜副数不一致');
}
function readCommand(value: unknown): SessionCommand {
  const item = object(value, 'command');
  if (item.kind === 'nextHand') return { kind: 'nextHand' };
  const actor = seat(item.seat, 'command.seat');
  switch (item.kind) {
    case 'bid': return { kind: 'bid', seat: actor, bid: item.bid === null ? null : integer(item.bid, 'bid', 70, 100) };
    case 'trump': return { kind: 'trump', seat: actor, trump: suit(item.trump) };
    case 'bury': return { kind: 'bury', seat: actor, cards: cards(item.cards, 'command.cards') };
    case 'play': return { kind: 'play', seat: actor, card: card(item.card) };
    default: return fail('未知回放动作');
  }
}
export function exportSnapshot(state: GameState, config: SnapshotConfig, replay?: { initialState: GameState; commands: SessionCommand[] }): string {
  const snapshot: GameSnapshot = { format: 'game-snapshot', schemaVersion: 1, ruleSetId: 'basic-v1',
    exportedAt: new Date().toISOString(), state: serialized(state), config,
    ...(replay ? { replay: { initialState: serialized(replay.initialState), commands: replay.commands } } : {}) };
  return JSON.stringify(snapshot, null, 2);
}
export function importSnapshot(json: string): { state: GameState; config: SnapshotConfig; replay?: { initialState: GameState; commands: SessionCommand[] } } {
  if (json.length > 2_000_000) fail('文件超过 2 MB');
  let parsed: unknown;
  try { parsed = JSON.parse(json); } catch { return fail('JSON 解析失败'); }
  const item = object(parsed, 'snapshot');
  if (item.format !== 'game-snapshot' || item.schemaVersion !== 1 || item.ruleSetId !== 'basic-v1') fail('不支持的格式、版本或规则集');
  const config = object(item.config, 'config');
  if (!['bridge', 'algorithm', 'llm', 'laya'].includes(config.activeEngine as string)) fail('未知决策引擎');
  const state = readState(item.state);
  let replay: { initialState: GameState; commands: SessionCommand[] } | undefined;
  if (item.replay !== undefined) {
    const input = object(item.replay, 'replay');
    replay = { initialState: readState(input.initialState), commands: array(input.commands, 'commands', 1000).map(readCommand) };
    let end = replay.initialState;
    try { for (const command of replay.commands) end = command.kind === 'nextHand' ? nextHand(end) : applyAiAction(end, command as AiAction); }
    catch { fail('回放动作不合法'); }
    same(serialized(end), serialized(state), '回放最终局面');
  }
  return { state, config: { activeEngine: config.activeEngine as EngineType }, replay };
}
