/** 历史协议缺口回归（SRP）：身份冲突、摘要一致性、观察投影与不可变配置。 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { bid, createGame, currentSeat, playCard } from '@yaozifen/game-core';
import { observeDecision } from '@yaozifen/game-view/decisionObservation';
import { SqliteHistoryRepository } from '@yaozifen/server/history/sqliteRepository';
import { canonicalJson, HistoryProtocolError } from '@yaozifen/protocol/protocol';
import { historyEndingAction, historyPlayingState } from './fixtures/history';

describe('历史仓储：持久化不变量', () => {
  let repo: SqliteHistoryRepository;
  beforeEach(() => { repo = new SqliteHistoryRepository({ path: ':memory:' }); });
  afterEach(() => repo.close());
  function fixture(start = createGame(4242)) {
    const match = repo.createMatch({ matchId: 'm', source: 'human', startedAt: 1, targetWins: 5 });
    const hand = repo.createHand({ handId: 'h', matchId: match.matchId, handIndex: 0, startSnapshot: start, startedAt: 1 });
    const branch = repo.createBranch({ branchId: 'b', handId: hand.handId, name: '真实', createdAt: 1 });
    return { start, match, hand, branch };
  }
  function firstNode() {
    const f = fixture();
    const state = bid(f.start, currentSeat(f.start), 70);
    const node = repo.appendActionNode({ nodeId: 'n', branchId: 'b', seq: 0,
      command: { kind: 'bid', seat: currentSeat(f.start), bid: 70 }, source: 'ai', state, createdAt: 2 });
    return { ...f, node };
  }
  it('相同 matchId 的不同来源或目标胜副拒绝，重试保留原记录', () => {
    const f = fixture();
    expect(() => repo.createMatch({ matchId: 'm', source: 'ai', startedAt: 1, targetWins: 5 })).toThrow(/冲突/);
    expect(() => repo.createMatch({ matchId: 'm', source: 'human', startedAt: 1, targetWins: 3 })).toThrow(/冲突/);
    expect(repo.getMatch('m')).toEqual(f.match);
  });
  it('相同 handId 的不同起点或归属拒绝', () => {
    fixture();
    expect(() => repo.createHand({ handId: 'h', matchId: 'm', handIndex: 0, startSnapshot: createGame(9), startedAt: 1 })).toThrow(/冲突/);
    expect(() => repo.createHand({ handId: 'h', matchId: 'm', handIndex: 1, startSnapshot: createGame(4242), startedAt: 1 })).toThrow(/冲突/);
  });
  it('创建重试中的副结算不能悄悄丢弃，结束状态只能显式更新', () => {
    fixture();
    expect(() => repo.createHand({ handId: 'h', matchId: 'm', handIndex: 0, startSnapshot: createGame(4242),
      startedAt: 1, endedAt: 2 })).toThrow(HistoryProtocolError);
    expect(() => repo.createMatch({ matchId: 'm', source: 'human', startedAt: 1, targetWins: 5, status: 'completed' })).toThrow(/冲突|状态/);
  });
  it.each([0, -1, 1.5, NaN, Infinity])('非法目标胜副 %s 不得入库', targetWins => {
    expect(() => repo.createMatch({ source: 'human', startedAt: 1, targetWins })).toThrow(HistoryProtocolError);
    expect(repo.listMatches()).toHaveLength(0);
  });
  it('副起点目标胜副必须与比赛一致，副号必须是非负整数', () => {
    fixture();
    expect(() => repo.createHand({ matchId: 'm', handIndex: 1, startSnapshot: createGame(1, { targetWins: 3 }), startedAt: 1 })).toThrow(/目标|胜副/);
    expect(() => repo.createHand({ matchId: 'm', handIndex: -1, startSnapshot: createGame(1), startedAt: 1 })).toThrow(HistoryProtocolError);
    expect(repo.listHands('m')).toHaveLength(1);
  });
  it('一副只能有一条真实路径，假设分支仍可从副起点建立', () => {
    fixture();
    expect(() => repo.createBranch({ handId: 'h', name: '第二真实路径', createdAt: 2 })).toThrow();
    expect(repo.createBranch({ handId: 'h', kind: 'branch', name: '假设', createdAt: 2 }).kind).toBe('branch');
  });
  it('不能通过公开摘要接口给未结束副写入任意结算', () => {
    fixture();
    const { after } = historyEndingAction();
    expect(() => repo.updateHandSummary('h', { endedAt: 3, declarer: after.declarer, bid: after.highestBid,
      trump: after.trump, result: after.result, unplayedPoints: after.result!.unplayedPoints! })).toThrow(/结束|结算/);
    expect(repo.getHand('h')!.result).toBeNull();
  });
  it('结束提交的未打出分必须与真实结算一致，拒绝时整笔回滚', () => {
    const { before, command, after } = historyEndingAction();
    fixture(before);
    expect(() => repo.recordCommit({ matchId: 'm', node: { branchId: 'b', seq: 0, command, source: 'ai', state: after, createdAt: 2 },
      handSummary: { endedAt: 3, declarer: after.declarer, bid: after.highestBid, trump: after.trump, result: after.result,
        unplayedPoints: after.result!.unplayedPoints! + 5 } })).toThrow(/未打出分|摘要/);
    expect(repo.listActionNodes('b')).toHaveLength(0);
    expect(repo.getHand('h')!.endedAt).toBeNull();
  });
  it('同配置 version 不允许对应多个 hash', () => {
    const p = { profileId: 'p', version: '1', configHash: 'a', type: 'llm', name: '默认', parameters: {}, createdAt: 1 };
    repo.recordProfileVersion(p);
    expect(() => repo.recordProfileVersion({ ...p, configHash: 'b', parameters: { temperature: 1 } })).toThrow(/版本|冲突/);
    expect(repo.listProfileVersions('p')).toHaveLength(1);
  });
  it('Human 不能引用引擎版本，AI 必须引用已保存配置', () => {
    fixture();
    const profile = repo.recordProfileVersion({ profileId: 'p', version: '1', configHash: 'a', type: 'llm', name: '默认', parameters: {}, createdAt: 1 });
    const a = { handId: 'h', branchId: 'b', seat: 0, createdAt: 2 };
    expect(() => repo.recordSeatAssignment({ ...a, kind: 'ai' })).toThrow(/配置/);
    expect(() => repo.recordSeatAssignment({ ...a, kind: 'human', profileVersionId: profile.profileVersionId })).toThrow(/配置|Human|人工/);
    expect(repo.listSeatAssignments('h')).toHaveLength(0);
  });
  it('观察不能夹带另一座位暗牌，不能拿对方手牌冒充自己的手牌', () => {
    const f = firstNode();
    const e = { nodeId: f.node.nodeId, requestId: 'r', sessionId: 's', seat: 2, phase: 'bidding' as const, purpose: 'auto' as const,
      observation: observeDecision(f.node.state, 2), candidates: [], recommended: null, status: 'evaluated' as const, latencyMs: 1, createdAt: 3 };
    expect(() => repo.recordEvaluation({ ...e, observation: Object.assign({}, e.observation, { opponentHand: f.node.state.hands[0] }) })).toThrow(HistoryProtocolError);
    expect(() => repo.recordEvaluation({ ...e, observation: { ...e.observation, ownHand: f.node.state.hands[0] } })).toThrow(HistoryProtocolError);
    expect(repo.recordEvaluation(e).observation).toEqual(e.observation);
  });
  it('100 分只有成功扣底后的搭档明牌能进入评估，并核对剩余牌', () => {
    const start = historyPlayingState(100); fixture(start);
    const seat = currentSeat(start), command = { kind: 'play' as const, seat, card: start.hands[seat][0] };
    // 使用规则执行而不是手造节点。
    const node = repo.appendActionNode({ branchId: 'b', seq: 0, command, source: 'ai', state: playCard(start, seat, command.card), createdAt: 2 });
    const observation = observeDecision(node.state, 0);
    const e = { nodeId: node.nodeId, requestId: 'r', sessionId: 's', seat: 0, phase: 'playing' as const, purpose: 'hint' as const,
      observation, candidates: [], recommended: null, status: 'evaluated' as const, latencyMs: 1, createdAt: 3 };
    expect(repo.recordEvaluation(e).observation).toEqual(observation);
    expect(() => repo.recordEvaluation({ ...e, requestId: 'bad', observation: Object.assign({}, observation, { revealedHand: { seat: 0, cards: start.hands[0] } }) })).toThrow(HistoryProtocolError);
  });
  it('同运行时 requestId 在不同持久节点上不会撞键，单节点重试仍幂等', () => {
    const f = firstNode();
    const e = { nodeId: f.node.nodeId, requestId: 'game-1-request-1', sessionId: 'game-1', seat: 2, phase: 'bidding' as const,
      purpose: 'hint' as const, observation: observeDecision(f.node.state, 2), candidates: [], recommended: null,
      status: 'evaluated' as const, latencyMs: 1, createdAt: 3 };
    const first = repo.recordEvaluation(e);
    const after = bid(f.node.state, 2, null);
    const next = repo.appendActionNode({ branchId: 'b', parentId: f.node.nodeId, seq: 1,
      command: { kind: 'bid', seat: 2, bid: null }, source: 'ai', state: after, createdAt: 4 });
    const second = repo.recordEvaluation({ ...e, nodeId: next.nodeId, seat: 3, observation: observeDecision(after, 3) });
    expect(second.evaluationId).not.toBe(first.evaluationId);
    expect(repo.recordEvaluation(e).evaluationId).toBe(first.evaluationId);
  });
  it('更新不存在记录不能返回成功，评估终态不能回到已评估', () => {
    const f = firstNode();
    expect(() => repo.updateMatchStatus('missing', 'completed')).toThrow(/不存在/);
    expect(() => repo.updateEvaluationStatus('missing', 'applied')).toThrow(/不存在/);
    const evaluation = repo.recordEvaluation({ nodeId: f.node.nodeId, requestId: 'r', sessionId: 's', seat: 2,
      phase: 'bidding', purpose: 'auto', observation: observeDecision(f.node.state, 2), candidates: [], recommended: null,
      status: 'evaluated', latencyMs: 1, createdAt: 3 });
    repo.updateEvaluationStatus(evaluation.evaluationId, 'applied');
    expect(() => repo.updateEvaluationStatus(evaluation.evaluationId, 'evaluated')).toThrow(/终态/);
  });
  it('规范化 JSON 不得把非有限数字、Date 或函数静默变为不同数据', () => {
    for (const value of [{ n: NaN }, { n: Infinity }, { date: new Date(0) }, { fn: () => 1 }]) {
      expect(() => canonicalJson(value)).toThrow(HistoryProtocolError);
    }
    const cyclic: Record<string, unknown> = {}; cyclic.self = cyclic;
    expect(() => canonicalJson(cyclic)).toThrow(HistoryProtocolError);
  });
});
