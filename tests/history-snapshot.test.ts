/** 历史快照中文回归：用真实引擎动作验证可继续执行、严格校验与私有随机源隔离（SRP）。 */
import { createHash } from 'node:crypto';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cardId, cardPoints } from '../src/cards';
import {
  basicScoring, bid, bury, createGame, currentSeat, declareTrump, legalMoves, nextHand, partnerOf, playCard,
} from '../src/engine';
import type { GameState } from '../src/engine';
import { observeDecision } from '../src/ai/decisionObservation';
import {
  HISTORY_PROTOCOL_VERSION, HistoryProtocolError, RULE_SET_ID, RULE_VERSION, actionNodeDigest, actionNodeIdentity,
  canonicalJson, commandValue, contentDigest, historySnapshotDigest, readHistorySnapshot,
  readVersioned, sanitizeHistorySnapshot,
} from '../src/history/protocol';

function envelope(state: GameState): Record<string, unknown> {
  return { protocolVersion: HISTORY_PROTOCOL_VERSION, ruleSetId: RULE_SET_ID, ruleVersion: RULE_VERSION,
    snapshot: sanitizeHistorySnapshot(state) };
}
function restore(state: GameState): GameState { return readHistorySnapshot(JSON.stringify(envelope(state))); }
function trumpState(seed = 4242, amount = 70, targetWins = 5): GameState {
  let state = createGame(seed, { targetWins });
  for (let i = 0; i < 4; i++) state = bid(state, currentSeat(state), i === 0 ? amount : null);
  return state;
}
function playingState(seed = 4242, amount = 70, targetWins = 5): GameState {
  let state = trumpState(seed, amount, targetWins);
  state = declareTrump(state, state.declarer!, 'S');
  return bury(state, state.declarer!, state.hands[state.declarer!].filter(card => cardPoints(card) === 0).slice(0, 4));
}
function finishedState(targetWins = 5): GameState {
  let state = playingState(731, 70, targetWins);
  for (let i = 0; state.phase === 'playing' && i < 48; i++) {
    const seat = currentSeat(state);
    state = playCard(state, seat, legalMoves(state, seat)[0]);
  }
  expect(['handEnd', 'matchEnd']).toContain(state.phase);
  return state;
}
function rawSnapshot(state = createGame(731)): Record<string, unknown> {
  return JSON.parse(JSON.stringify(state)) as Record<string, unknown>;
}
function readRaw(snapshot: Record<string, unknown>): GameState {
  return readHistorySnapshot({ protocolVersion: HISTORY_PROTOCOL_VERSION, ruleSetId: RULE_SET_ID,
    ruleVersion: RULE_VERSION, snapshot });
}

afterEach(() => vi.unstubAllGlobals());

describe('历史快照：保留随机源与完整可执行历史', () => {
  it('协议升级到第二版，默认存储 seed 与 history 且不修改原状态', () => {
    const state = createGame(4242);
    const before = JSON.stringify(state);
    const snapshot = sanitizeHistorySnapshot(state);
    expect(HISTORY_PROTOCOL_VERSION).toBe(2);
    expect(snapshot.seed).toBe(state.seed);
    expect(snapshot.history).toEqual(state.history);
    expect(JSON.stringify(state)).toBe(before);
    expect(restore(state)).toEqual(state);
    (snapshot.history as string[]).push('只修改克隆');
    expect(state.history).not.toContain('只修改克隆');
  });

  it('恢复后继续叫分和合法出牌与原状态完全相同', () => {
    const initial = bid(createGame(731), 1, 70);
    expect(bid(restore(initial), currentSeat(initial), 75)).toEqual(bid(initial, currentSeat(initial), 75));
    const playing = playingState();
    const seat = currentSeat(playing), card = legalMoves(playing, seat)[0];
    expect(playCard(restore(playing), seat, card)).toEqual(playCard(playing, seat, card));
  });

  it('三家不叫后存储再恢复，第四家不叫重发牌完全一致', () => {
    let state = createGame(987654321);
    for (let i = 0; i < 3; i++) state = bid(state, currentSeat(state), null);
    const actual = bid(restore(state), currentSeat(state), null);
    const expected = bid(state, currentSeat(state), null);
    expect(actual).toEqual(expected);
    expect(actual.dealer).toBe(1);
    expect(actual.hands).not.toEqual(state.hands);
    expect(restore(actual)).toEqual(actual);
  });

  it('真实提前结算后 nextHand 保持牌张、比分、seed 与 history', () => {
    const state = finishedState();
    expect(state.phase).toBe('handEnd');
    expect(restore(state)).toEqual(state);
    expect(nextHand(restore(state))).toEqual(nextHand(state));
  });

  it('整场终局正确恢复并同样拒绝 nextHand', () => {
    const state = finishedState(1);
    expect(state.phase).toBe('matchEnd');
    expect(restore(state)).toEqual(state);
    expect(() => nextHand(restore(state))).toThrow(/不能开始下一局/);
  });

  it('定主和扣底阶段的合法牌张归属也可完整往返', () => {
    const trump = trumpState();
    expect(restore(trump)).toEqual(trump);
    const burying = declareTrump(trump, trump.declarer!, 'H');
    expect(restore(burying)).toEqual(burying);
  });

  it('不同 seed 和叫分的完整两胜场在每个真实动作边界都能恢复继续', () => {
    for (const seed of [0, -1, 4294967297]) for (const amount of [70, 85, 100]) {
      let state = createGame(seed, { targetWins: 2 });
      for (let step = 0; state.phase !== 'matchEnd' && step < 200; step++) {
        const restored = restore(state);
        expect(restored).toEqual(state);
        const seat = currentSeat(state);
        const advance = (input: GameState): GameState => {
          switch (input.phase) {
            case 'bidding': return bid(input, seat, input.bidding.length === 0 ? amount : null);
            case 'trump': return declareTrump(input, seat, 'D');
            case 'bury': return bury(input, seat, input.hands[seat].filter(card => cardPoints(card) === 0).slice(0, 4));
            case 'playing': {
              const moves = legalMoves(input, seat);
              return playCard(input, seat, moves[step % moves.length]);
            }
            case 'handEnd': return nextHand(input);
            default: throw new Error('未预期阶段');
          }
        };
        const next = advance(state);
        expect(advance(restored)).toEqual(next);
        state = next;
      }
      expect(state.phase).toBe('matchEnd');
      expect(restore(state)).toEqual(state);
    }
  });

  it('默认持久化指纹覆盖 seed 与 history，显式牌面比较才可忽略 seed', () => {
    const state = createGame(11), altered = { ...state, seed: 12 };
    expect(historySnapshotDigest(altered)).not.toBe(historySnapshotDigest(state));
    expect(historySnapshotDigest(altered, { includeSeed: false })).toBe(historySnapshotDigest(state, { includeSeed: false }));
    const input = { parentId: null, seq: 0, command: { kind: 'bid', seat: 1, bid: 70 } as const, state };
    expect(actionNodeDigest({ ...input, state: altered })).not.toBe(actionNodeDigest(input));
    expect(actionNodeDigest({ ...input, state: { ...state, history: [...state.history, '新事件'] } })).not.toBe(actionNodeDigest(input));
    expect(() => readHistorySnapshot({ ...envelope(state), snapshot: sanitizeHistorySnapshot(state, { includeSeed: false }) })).toThrow(/seed/);
  });
});

describe('历史节点：身份与持久化局面指纹分离', () => {
  it('相同完整局面的分支、父节点、序号、命令、来源或检查点变化只改变节点身份', () => {
    const state = createGame(11);
    const input = { branchId: 'b_actual', parentId: null, seq: 0,
      command: { kind: 'bid', seat: 1, bid: 70 } as const, source: 'manual' as const, state, checkpoint: false };
    const digest = actionNodeDigest(input), identity = actionNodeIdentity(input);
    for (const changed of [
      { ...input, branchId: 'b_fork' }, { ...input, parentId: 'n_parent' }, { ...input, seq: 1 },
      { ...input, command: { kind: 'bid', seat: 1, bid: 75 } as const },
      { ...input, source: 'ai' as const }, { ...input, checkpoint: true },
    ]) {
      expect(actionNodeDigest(changed)).toBe(digest);
      expect(actionNodeIdentity(changed)).not.toBe(identity);
    }
    const firstAttempt = { ...input, createdAt: 1 }, retry = { ...input, createdAt: 2 };
    expect(actionNodeIdentity(firstAttempt)).toBe(actionNodeIdentity(retry));
  });
});

describe('历史快照：完整运行时校验', () => {
  const invalid: [string, (snapshot: Record<string, unknown>) => void][] = [
    ['未知阶段', state => { state.phase = '未知'; }],
    ['越界发牌座位', state => { state.dealer = 4; }],
    ['非整数领出座位', state => { state.leader = 0.5; }],
    ['缺少 seed', state => { delete state.seed; }],
    ['非有限 seed', state => { state.seed = Infinity; }],
    ['缺少 history', state => { delete state.history; }],
    ['非文本 history', state => { state.history = [42]; }],
    ['重复牌张', state => { const hands = state.hands as unknown[][]; hands[0][0] = hands[1][0]; }],
    ['缺失牌张', state => { (state.hands as unknown[][])[0].pop(); }],
    ['非法牌点', state => { (state.hands as { rank: string }[][])[0][0].rank = 'joker'; }],
    ['非法花色', state => { (state.kitty as { suit: string }[])[0].suit = 'X'; }],
    ['手牌座位数', state => { state.hands = []; }],
    ['底牌张数', state => { (state.kitty as unknown[]).pop(); }],
    ['比分座位数', state => { state.scores = [0]; }],
    ['负比分', state => { state.scores = [-1, 0]; }],
    ['非整数比分', state => { state.scores = [0.5, 0]; }],
    ['已达目标但阶段未终局', state => { state.scores = [5, 0]; }],
    ['targetWins 零值', state => { state.targetWins = 0; }],
    ['targetWins 与规则不一致', state => { state.targetWins = 6; }],
    ['规则常量缺失', state => { delete (state.rules as Record<string, unknown>).bidStep; }],
    ['规则常量被改', state => { (state.rules as Record<string, unknown>).minBid = 65; }],
    ['叫分顺序错误', state => { state.bidOrder = [0, 1, 2, 3]; }],
    ['叫分记录座位错误', state => { state.bidding = [{ seat: 0, bid: 70 }]; state.highestBid = 70; state.highestBidder = 0; }],
    ['非法叫分档位', state => { state.bidding = [{ seat: 1, bid: 71 }]; state.highestBid = 71; state.highestBidder = 1; }],
    ['最高叫分不匹配', state => { state.highestBid = 70; }],
    ['提前出现结算', state => { state.result = {}; }],
    ['提前出现出牌历史', state => { state.trick = [{ seat: 1, card: (state.hands as unknown[][])[1][0] }]; }],
    ['非五分倍数吃分', state => { state.defenderTrickPoints = 1; }],
  ];
  it.each(invalid)('读取拒绝坏快照：%s', (_label, mutate) => {
    const state = rawSnapshot(); mutate(state);
    expect(() => readRaw(state)).toThrow(HistoryProtocolError);
  });

  it('写入前拒绝坏快照，不能先把非有限数值 JSON 化', () => {
    const state = createGame(1); state.seed = NaN;
    expect(() => sanitizeHistorySnapshot(state)).toThrow(HistoryProtocolError);
  });

  it('写入前拒绝自定义 scoring，不允许 JSON 丢函数后误挂 basicScoring', () => {
    const state = createGame(731, { scoring: context => basicScoring(context) });
    let serialized = false;
    Object.defineProperty(state, 'toJSON', { value: () => { serialized = true; return {}; } });
    expect(() => sanitizeHistorySnapshot(state)).toThrow(/结算规则|scoring/);
    expect(serialized).toBe(false);
  });

  it('读取拒绝伪造的已序列化 scoring 规则字段', () => {
    const state = rawSnapshot(); (state.rules as Record<string, unknown>).scoring = 'custom';
    expect(() => readRaw(state)).toThrow(HistoryProtocolError);
  });

  it('真实牌墩的座位、赢家、得分、剩余牌归属与结算都按引擎重放校验', () => {
    const end = finishedState();
    for (const mutate of [
      (state: GameState) => { state.completedTricks[0].winner = (state.completedTricks[0].winner + 1) % 4; },
      (state: GameState) => { state.completedTricks[0].points += 5; },
      (state: GameState) => { state.completedTricks[0].cards[1].seat = state.completedTricks[0].cards[0].seat; },
      (state: GameState) => { state.lastPoints += 5; },
      (state: GameState) => { state.result!.unplayedPoints = (state.result!.unplayedPoints ?? 0) + 5; },
      (state: GameState) => { state.result!.winnerSide = 1 - state.result!.winnerSide; },
      (state: GameState) => { state.scores = [0, 0]; },
      (state: GameState) => { state.phase = 'playing'; state.result = null; },
    ]) {
      const snapshot = rawSnapshot(end); mutate(snapshot as unknown as GameState);
      expect(() => readRaw(snapshot)).toThrow(HistoryProtocolError);
    }
  });

  it('出牌阶段不允许把分牌扣底，即使牌张仍然完整且唯一', () => {
    const snapshot = rawSnapshot(playingState()) as unknown as GameState;
    const index = snapshot.hands[0].findIndex(card => cardPoints(card) > 0);
    [snapshot.kitty[0], snapshot.hands[0][index]] = [snapshot.hands[0][index], snapshot.kitty[0]];
    expect(() => readRaw(snapshot as unknown as Record<string, unknown>)).toThrow(/分牌不能埋牌/);
  });
});

describe('历史协议：严格版本、命令与跨环境摘要', () => {
  it.each(['protocolVersion', 'ruleSetId', 'ruleVersion'])('信封必填字段 %s 缺失不能回退当前值', key => {
    const input = envelope(createGame(1)); delete input[key];
    expect(() => readHistorySnapshot(input)).toThrow(HistoryProtocolError);
  });
  it.each([undefined, null, '2', 0, 1, 3, NaN])('拒绝缺失、非整数或旧协议版本 %s', version => {
    expect(() => readHistorySnapshot({ ...envelope(createGame(1)), protocolVersion: version })).toThrow(/协议版本/);
  });
  it('旧版不完整快照错误解释 seed/history 无法安全恢复', () => {
    const snapshot = rawSnapshot(); delete snapshot.seed; delete snapshot.history;
    expect(() => readHistorySnapshot({ protocolVersion: 1, ruleSetId: RULE_SET_ID, ruleVersion: RULE_VERSION, snapshot })).toThrow(/seed.*history|history.*seed/);
  });
  it('未知规则与非数字规则版本严格拒绝', () => {
    const input = envelope(createGame(1));
    expect(() => readHistorySnapshot({ ...input, ruleSetId: 'other' })).toThrow(/规则集/);
    expect(() => readHistorySnapshot({ ...input, ruleVersion: 2 })).toThrow(/规则版本/);
    expect(() => readHistorySnapshot({ ...input, ruleVersion: '1' })).toThrow(/规则版本/);
    expect(() => readVersioned('{"v":2}', '列')).toThrow(/data/);
  });

  it.each([
    { kind: 'bid', seat: -1, bid: 70 }, { kind: 'bid', seat: 4, bid: 70 },
    { kind: 'bid', seat: 0.5, bid: 70 }, { kind: 'bid', seat: 0, bid: 71 },
    { kind: 'bid', seat: 0, bid: 65 }, { kind: 'bid', seat: 0, bid: 105 },
    { kind: 'bid', seat: 0 }, { kind: 'bid', seat: 0, bid: '70' },
    { kind: 'trump', seat: 0, trump: 'X' }, { kind: 'bury', seat: 0, cards: {} },
    { kind: 'bury', seat: 0, cards: [] },
    { kind: 'bury', seat: 0, cards: Array.from({ length: 4 }, () => ({ suit: 'S', rank: '2' })) },
    { kind: 'bury', seat: 0, cards: ['2', '3', '4', '5'].map(rank => ({ suit: 'S', rank })) },
    { kind: 'play', seat: 0, card: { suit: 'S', rank: 'joker' } },
  ])('拒绝非法动作 %#', value => { expect(() => commandValue(value)).toThrow(HistoryProtocolError); });

  it('合法叫分、定主、非分牌扣底与 nextHand 通过白名单', () => {
    for (const value of [
      { kind: 'bid', seat: 3, bid: null }, { kind: 'bid', seat: 0, bid: 100 },
      { kind: 'trump', seat: 1, trump: 'C' }, { kind: 'nextHand' },
      { kind: 'bury', seat: 1, cards: ['2', '3', '4', '6'].map(rank => ({ suit: 'S', rank })) },
    ]) expect(commandValue(value)).toEqual(value);
  });

  it('无 crypto、有 crypto 或 subtle 均始终产生相同纯 JS SHA-256', () => {
    const value = { 中文: '随机源只能由存储和裁判读取', cards: [1, 2, 3] };
    const expected = 'sha256:' + createHash('sha256').update(canonicalJson(value)).digest('hex');
    for (const crypto of [undefined, {}, { subtle: {} }]) {
      vi.stubGlobal('crypto', crypto);
      expect(contentDigest(value)).toBe(expected);
      expect(contentDigest(value)).toMatch(/^sha256:[0-9a-f]{64}$/);
    }
  });
});

describe('历史恢复：100 分搭档明牌观察不泄露 seed', () => {
  it('叫分、定主与扣底仍隐藏搭档，扣底成功后公开剩余牌并持续同步', () => {
    const trump = trumpState(4242, 100);
    const declarer = trump.declarer!, partner = partnerOf(declarer), observer = (declarer + 1) % 4;
    const burying = declareTrump(trump, declarer, 'S');
    for (const state of [createGame(4242), trump, burying]) {
      const observation = observeDecision(restore(state), observer);
      expect(observation).not.toHaveProperty('seed');
      expect(observation).not.toHaveProperty('history');
      expect(observation).not.toHaveProperty('hands');
      expect(observation).not.toHaveProperty('revealedHand');
    }
    let playing = playingState(4242, 100);
    for (let i = 0; i < 3; i++) {
      const observation = observeDecision(restore(playing), observer);
      expect(observation).not.toHaveProperty('seed');
      expect(observation).not.toHaveProperty('hands');
      expect(observation).not.toHaveProperty('kitty');
      expect(observation).not.toHaveProperty('knownBuriedCards');
      if (observation.phase !== 'playing') throw new Error('样本必须在出牌阶段');
      expect(observation.revealedHand?.seat).toBe(partner);
      expect(observation.revealedHand?.cards.map(cardId)).toEqual(playing.hands[partner].map(cardId));
      const actor = currentSeat(playing);
      playing = playCard(playing, actor, legalMoves(playing, actor)[0]);
    }
  });
});
