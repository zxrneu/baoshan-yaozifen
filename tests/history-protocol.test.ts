/**
 * P0.1 历史协议层测试。
 * 覆盖：协议指纹与版本拒绝、私有快照与规则匹配、SQLite 往返逐字节一致、
 * 动作链完整性、提交幂等、信息隔离约束、迁移与备份。
 * 使用 :memory: 数据库避免依赖真实 .env 配置。
 */
import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { bid, bury, createGame, currentSeat, declareTrump, legalMoves, playCard } from '@yaozifen/game-core';
import { cardPoints } from '@yaozifen/game-core/cards';
import { observeDecision } from '@yaozifen/game-view/decisionObservation';
import type { GameState } from '@yaozifen/game-core';
import { SqliteHistoryRepository } from '@yaozifen/server/history/sqliteRepository';
import {
  HISTORY_PROTOCOL_VERSION,
  HistoryProtocolError,
  RULE_SET_ID,
  RULE_VERSION,
  actionNodeDigest,
  actionNodeIdentity,
  canonicalJson,
  contentDigest,
  historySnapshotDigest,
  readHistorySnapshot,
  readVersioned,
  sanitizeHistorySnapshot,
  sha256Hex,
  writeVersioned,
} from '@yaozifen/protocol/protocol';
import { LATEST_SCHEMA_VERSION } from '@yaozifen/server/history/migrations';
import { derivedHistoryId, newHistoryId } from '@yaozifen/protocol/ids';
import {
  DEFAULT_HISTORY_DB_PATH,
  closeHistoryRepository,
  currentHistoryRepository,
  isHistoryEnabled,
  openHistoryRepository,
  resolveHistoryDbPath,
} from '@yaozifen/server/history/index';

/** 取默认规则的一局作为历史样本。 */
function sampleGame(seed = 20260513): GameState {
  return createGame(seed);
}

/** 由合法动作找到结束前的最后一步，不能手改分数或结算伪造样本。 */
function endingAction(seed: number) {
  let state = sampleGame(seed);
  for (let i = 0; i < 4; i++) state = bid(state, currentSeat(state), i === 0 ? 80 : null);
  state = declareTrump(state, currentSeat(state), 'S');
  state = bury(state, currentSeat(state), state.hands[currentSeat(state)].filter(card => cardPoints(card) === 0).slice(0, 4));
  while (state.phase === 'playing') {
    const before = state;
    const command = { kind: 'play' as const, seat: currentSeat(state), card: legalMoves(state, currentSeat(state))[0] };
    state = playCard(state, command.seat, command.card);
    if (state.phase === 'handEnd' || state.phase === 'matchEnd') return { before, command, after: state };
  }
  throw new Error('合法样本未进入副结算');
}

/** 去掉 writeVersioned 的版本信封，取出客户端快照本体。 */
function unwrap(text: string): string {
  return JSON.stringify((JSON.parse(text) as { data: unknown }).data);
}

function requestId(label: string): string {
  return `req_${label}`;
}

describe('历史协议：指纹与版本', () => {
  it('canonicalJson 对键序不敏感，对值敏感', () => {
    expect(canonicalJson({ b: 1, a: 2 })).toBe(canonicalJson({ a: 2, b: 1 }));
    expect(canonicalJson({ a: 2 })).not.toBe(canonicalJson({ a: 3 }));
  });

  it('contentDigest 与 sha256Hex 一致且稳定', () => {
    const value = { hello: '世界', list: [1, 2, 3] };
    expect(contentDigest(value)).toBe(`sha256:${sha256Hex(canonicalJson(value))}`);
    expect(contentDigest(value)).toBe(contentDigest({ list: [1, 2, 3], hello: '世界' }));
  });

  it('writeVersioned/readVersioned 往返一致并拒绝未知版本', () => {
    const payload = { a: 1, nested: { b: [1, 2] } };
    expect(readVersioned<typeof payload>(writeVersioned(payload), '测试列')).toEqual(payload);
    expect(readVersioned(null, '测试列')).toBeNull();
    expect(() => readVersioned(JSON.stringify({ v: HISTORY_PROTOCOL_VERSION + 1, data: {} }), '测试列')).toThrow(
      /不受支持/,
    );
    expect(() => readVersioned('{', '测试列')).toThrow(/JSON 解析失败/);
  });

  it('动作节点摘要对同一提交稳定、对不同提交不同', () => {
    const state = sampleGame();
    const base = { branchId: 'b_actual', parentId: null, seq: 0,
      command: { kind: 'bid', seat: currentSeat(state), bid: 75 } as const, source: 'human' as const, state };
    expect(actionNodeDigest(base)).toBe(actionNodeDigest({ ...base }));
    // 局面指纹只覆盖局面本身，同一局面在不同提交位置上必须一致，
    // 否则同一局面无法跨分支去重比对。
    const otherPosition = { ...base, seq: 1 };
    expect(actionNodeDigest(base)).toBe(actionNodeDigest(otherPosition));
    // 提交身份才承载父指针/序号/指令的差异，用于派生节点 ID。
    expect(actionNodeIdentity(base)).toBe(actionNodeIdentity({ ...base }));
    expect(actionNodeIdentity(base)).not.toBe(actionNodeIdentity({ ...base, seq: 1 }));
    expect(actionNodeIdentity(base)).not.toBe(actionNodeIdentity({ ...base, parentId: 'n_other' }));
  });
});

describe('历史协议：私有快照与规则匹配', () => {
  it('动作节点快照保留 seed 与 history 及完整牌面，仅供存储和裁判', () => {
    const state = sampleGame();
    const snapshot = sanitizeHistorySnapshot(state);
    expect(snapshot.seed).toBe(state.seed);
    expect(snapshot.history).toEqual(state.history);
    expect(snapshot.hands).toEqual(state.hands);
    expect(snapshot.kitty).toEqual(state.kitty);
    expect(snapshot.trickNumber).toBe(state.trickNumber);
  });

  it('起点快照保留 seed，供逐字节重放', () => {
    const state = sampleGame(4242);
    const snapshot = sanitizeHistorySnapshot(state, { includeSeed: true });
    expect(snapshot.seed).toBe(4242);
  });

  it('持久化指纹覆盖 seed，仅显式牌面比较可忽略 seed', () => {
    const a = sampleGame(1);
    const b = sampleGame(1);
    expect(historySnapshotDigest(a)).toBe(historySnapshotDigest(b));
    b.seed = 99;
    expect(historySnapshotDigest(b)).not.toBe(historySnapshotDigest(a));
    expect(historySnapshotDigest(b, { includeSeed: false })).toBe(historySnapshotDigest(a, { includeSeed: false }));
  });

  it('readHistorySnapshot 校验手牌数与比分位，保留 seed 且缺失时拒绝', () => {
    const snapshot = writeVersioned({
      protocolVersion: HISTORY_PROTOCOL_VERSION,
      ruleSetId: RULE_SET_ID,
      ruleVersion: RULE_VERSION,
      snapshot: sanitizeHistorySnapshot(sampleGame(7)),
    });
    const restored = readHistorySnapshot(unwrap(snapshot));
    expect(restored.seed).toBe(7);
    expect(restored.hands).toHaveLength(4);
    expect(restored.scores).toHaveLength(2);

    const broken = JSON.parse(unwrap(snapshot)) as { snapshot: { hands: unknown[]; seed?: number } };
    delete broken.snapshot.seed;
    expect(() => readHistorySnapshot(broken)).toThrow(/seed/);
    broken.snapshot.seed = 7;
    broken.snapshot.hands = [];
    expect(() => readHistorySnapshot(JSON.stringify(broken))).toThrow(/手牌数量错误/);
  });

  it('规则集/版本不匹配时显式拒绝，不静默重算', () => {
    const make = (ruleSetId: string, ruleVersion: number) =>
      JSON.stringify({
        protocolVersion: HISTORY_PROTOCOL_VERSION,
        ruleSetId,
        ruleVersion,
        snapshot: sanitizeHistorySnapshot(sampleGame(11)),
      });
    expect(() => readHistorySnapshot(make('basic-v2', 1))).toThrow(/不支持的规则集/);
    expect(() => readHistorySnapshot(make(RULE_SET_ID, RULE_VERSION + 1))).toThrow(/已拒绝加载/);
    expect(() => readHistorySnapshot(make(RULE_SET_ID, RULE_VERSION))).not.toThrow();
  });

  it('规则常量被改动过的历史快照会被拒绝', () => {
    const snapshot = JSON.parse(
      JSON.stringify({
        protocolVersion: HISTORY_PROTOCOL_VERSION,
        ruleSetId: RULE_SET_ID,
        ruleVersion: RULE_VERSION,
        snapshot: sanitizeHistorySnapshot(sampleGame(13)),
      }),
    ) as { snapshot: { rules: Record<string, number> } };
    snapshot.snapshot.rules.minBid = 65;
    expect(() => readHistorySnapshot(JSON.stringify(snapshot))).toThrow(/规则 minBid 与当前实现不一致/);
  });

  it('协议版本变化时快照被拒绝', () => {
    const snapshot = JSON.stringify({
      protocolVersion: HISTORY_PROTOCOL_VERSION + 1,
      ruleSetId: RULE_SET_ID,
      ruleVersion: RULE_VERSION,
      snapshot: sanitizeHistorySnapshot(sampleGame(17)),
    });
    expect(() => readHistorySnapshot(snapshot)).toThrow(/协议版本/);
  });
});

describe('历史 ID', () => {
  it('新 ID 带类型前缀且互不相同', () => {
    const ids = new Set(Array.from({ length: 200 }, () => newHistoryId('node')));
    expect(ids.size).toBe(200);
    for (const id of ids) expect(id.startsWith('n_')).toBe(true);
  });

  it('派生 ID 由指纹决定，重试得到同一 ID', () => {
    const digest = contentDigest({ hello: 'world' });
    expect(derivedHistoryId('node', digest)).toBe(derivedHistoryId('node', digest));
    expect(derivedHistoryId('hand', digest)).not.toBe(derivedHistoryId('node', digest));
  });
});

describe('SQLite 历史仓储', () => {
  let repo: SqliteHistoryRepository;

  beforeEach(() => {
    repo = new SqliteHistoryRepository({ path: ':memory:' });
  });

  afterEach(() => {
    repo.close();
  });

  function seedMatchWithHand(state: GameState = sampleGame()) {
    const match = repo.createMatch({
      startedAt: 1_700_000_000_000,
      source: 'human',
      targetWins: 5,
      appVersion: '0.1.0',
      implementationVersion: 'engine-1',
    });
    const hand = repo.createHand({
      matchId: match.matchId,
      handIndex: 1,
      startSnapshot: state,
      startedAt: 1_700_000_000_100,
    });
    const branch = repo.createBranch({
      handId: hand.handId,
      sourceNodeId: null,
      name: '原始路径',
      kind: 'actual',
      createdAt: 1_700_000_000_200,
    });
    return { match, hand, branch };
  }

  it('迁移建到最新版本且幂等', () => {
    expect(repo.schemaVersion()).toBe(LATEST_SCHEMA_VERSION);
    const again = new SqliteHistoryRepository({ path: ':memory:' });
    expect(again.schemaVersion()).toBe(LATEST_SCHEMA_VERSION);
    again.close();
  });

  it('比赛/副/分支往返一致', () => {
    const { match, hand, branch } = seedMatchWithHand();
    expect(repo.getMatch(match.matchId)).toEqual(match);
    expect(repo.listMatches()).toHaveLength(1);

    const storedHand = repo.getHand(hand.handId);
    expect(storedHand).not.toBeNull();
    expect(storedHand!.handIndex).toBe(1);
    expect(storedHand!.startSnapshot.hands).toEqual(hand.startSnapshot.hands);
    expect(storedHand!.startSnapshot.seed).toBe(hand.startSnapshot.seed);
    expect(repo.listHands(match.matchId)).toHaveLength(1);

    expect(repo.getBranch(branch.branchId)).toEqual(branch);
    expect(repo.listBranches(hand.handId)).toHaveLength(1);
  });

  it('起点快照逐字节可重放：52 张牌与规则全都一致', () => {
    const state = sampleGame(777);
    const { hand } = seedMatchWithHand(state);
    const restored = repo.getHand(hand.handId)!.startSnapshot;
    const flat = (cards: GameState['hands']) => cards.flat().map(card => `${card.suit}${card.rank}`);
    expect(flat(restored.hands)).toEqual(flat(state.hands));
    expect(restored.kitty).toEqual(state.kitty);
    expect(restored.dealer).toBe(state.dealer);
    expect(restored.bidOrder).toEqual(state.bidOrder);
    expect(restored.rules).toEqual(state.rules);
    expect(restored.targetWins).toBe(state.targetWins);
  });

  it('动作节点往返一致且局面指纹可校验', () => {
    const state = sampleGame(31);
    const { branch } = seedMatchWithHand(state);
    const command = { kind: 'bid' as const, seat: currentSeat(state), bid: 75 };
    const after = bid(state, command.seat, command.bid);
    const node = repo.appendActionNode({
      branchId: branch.branchId,
      parentId: null,
      seq: 0,
      command,
      source: 'human',
      state: after,
      createdAt: 1_700_000_001_000,
    });
    const stored = repo.getActionNode(node.nodeId);
    expect(stored).not.toBeNull();
    expect(stored!.command).toEqual(command);
    expect(stored!.source).toBe('human');
    expect(stored!.seq).toBe(0);
    expect(stored!.state.highestBid).toBe(75);
    expect(stored!.state.seed).toBe(state.seed);
    expect(stored!.state.history).toEqual(after.history);
    expect(stored!.state).toEqual(after);
    expect(contentDigest(sanitizeHistorySnapshot(stored!.state))).toBe(historySnapshotDigest(stored!.state));
    expect(repo.getBranch(branch.branchId)!.tipNodeId).toBe(node.nodeId);
  });

  it('断链或乱序的动作被拒绝', () => {
    const state = sampleGame(33);
    const { branch } = seedMatchWithHand(state);
    const first = bid(state, currentSeat(state), 75), second = bid(first, currentSeat(first), 80);
    repo.appendActionNode({ branchId: branch.branchId, parentId: null, seq: 0,
      command: { kind: 'bid', seat: currentSeat(state), bid: 75 }, source: 'human', state: first, createdAt: 1 });

    expect(() =>
      repo.appendActionNode({ branchId: branch.branchId, parentId: null, seq: 1,
        command: { kind: 'bid', seat: currentSeat(first), bid: 80 }, source: 'human', state: second, createdAt: 2 }),
    ).toThrow(/父节点/);

    const tip = repo.listActionNodes(branch.branchId)[0].nodeId;
    expect(() =>
      repo.appendActionNode({ branchId: branch.branchId, parentId: tip, seq: 5,
        command: { kind: 'bid', seat: currentSeat(first), bid: 80 }, source: 'human', state: second, createdAt: 3 }),
    ).toThrow(/动作序号/);
  });

  it('recordCommit 幂等：同一提交重试不重复写入', () => {
    const state = sampleGame(41);
    const { match, hand, branch } = seedMatchWithHand(state);
    const command = { kind: 'bid' as const, seat: currentSeat(state), bid: 80 };
    const after = bid(state, command.seat, command.bid);
    const node = { branchId: branch.branchId, parentId: null, seq: 0, command,
      source: 'human' as const, state: after, createdAt: 10 };
    const digest = actionNodeDigest(node);
    const nodeId = derivedHistoryId('node', actionNodeIdentity(node));
    const input = { matchId: match.matchId, node: { ...node, digest }, nodeId };

    const first = repo.recordCommit(input);
    expect(first.duplicated).toBe(false);
    const second = repo.recordCommit({ ...input, node: { ...input.node, createdAt: 11 } });
    expect(second.duplicated).toBe(true);
    expect(second.nodeId).toBe(first.nodeId);
    expect(repo.listActionNodes(branch.branchId)).toHaveLength(1);
    expect(repo.getHand(hand.handId)).not.toBeNull();
  });

  it('recordCommit 在同一事务内写入真实结算摘要与动作前评估', () => {
    const { before, command, after } = endingAction(43);
    const { hand, branch } = seedMatchWithHand(before);
    const commit = repo.recordCommit({
      matchId: hand.matchId,
      node: { nodeId: 'n_end', branchId: branch.branchId, parentId: null, seq: 0, command, source: 'human', state: after, createdAt: 20 },
      handSummary: { endedAt: 1_700_000_001_000, declarer: after.declarer, bid: after.highestBid,
        trump: after.trump, result: after.result, unplayedPoints: after.result!.unplayedPoints ?? 0 },
      evaluation: {
        nodeId: 'n_end', requestId: requestId('commit-1'), sessionId: 's1', seat: command.seat,
        phase: 'playing', purpose: 'auto', observation: observeDecision(before, command.seat), observationPoint: 'before',
        candidates: [command.card], recommended: command.card, status: 'applied', latencyMs: 12, createdAt: 21,
      },
    });
    const stored = repo.getHand(hand.handId)!;
    expect(stored.endedAt).toBe(1_700_000_001_000);
    expect(stored.result).toEqual(after.result);
    expect(stored.unplayedPoints).toBe(after.result!.unplayedPoints ?? 0);
    expect(repo.listEvaluations(commit.nodeId)).toHaveLength(1);
    expect(repo.getEvaluationByRequest(commit.nodeId, requestId('commit-1'))!.recommended).toEqual(command.card);
  });

  it('事务失败时回滚已插入节点与游标，不留半个节点', () => {
    const state = sampleGame(47);
    const { hand, branch } = seedMatchWithHand(state);
    const seat = currentSeat(state), after = bid(state, seat, 70);
    expect(() => repo.recordCommit({
      matchId: hand.matchId,
      node: { nodeId: 'n_rollback', branchId: branch.branchId, seq: 0,
        command: { kind: 'bid', seat, bid: 70 }, source: 'human', state: after, createdAt: 30 },
      evaluation: {
        nodeId: 'n_rollback', requestId: requestId('rollback-1'), sessionId: 's', seat,
        phase: 'bidding', purpose: 'auto', observationPoint: 'before',
        observation: Object.assign({}, observeDecision(state, seat), { headers: { Authorization: 'Bearer leaked' } }),
        candidates: [{ bid: 70 }], recommended: { bid: 70 }, status: 'evaluated', latencyMs: 1, createdAt: 30,
      },
    })).toThrow(/禁止落库/);
    expect(repo.listActionNodes(branch.branchId)).toHaveLength(0);
    expect(repo.getBranch(branch.branchId)!.tipNodeId).toBeNull();
  });

  it('评估按持久节点与 request_id 幂等，且状态可更新', () => {
    const state = sampleGame(53);
    const { branch } = seedMatchWithHand(state);
    const seat = currentSeat(state), after = bid(state, seat, 70);
    const node = repo.appendActionNode({ branchId: branch.branchId, seq: 0,
      command: { kind: 'bid', seat, bid: 70 }, source: 'ai', state: after, createdAt: 40 });
    const base = {
      nodeId: node.nodeId, requestId: requestId('dedupe'), sessionId: 's', seat: 1, phase: 'bidding' as const,
      purpose: 'hint' as const, observation: observeDecision(after, 1), candidates: [{ bid: 75 }], recommended: { bid: 75 },
      status: 'evaluated' as const, latencyMs: 5, createdAt: 41,
    };
    const first = repo.recordEvaluation(base);
    const second = repo.recordEvaluation({ ...base, createdAt: 42 });
    expect(second.evaluationId).toBe(first.evaluationId);
    expect(() => repo.recordEvaluation({ ...base, latencyMs: 900 })).toThrow(/冲突/);
    expect(repo.listEvaluations(node.nodeId)).toHaveLength(1);
    repo.updateEvaluationStatus(first.evaluationId, 'stale');
    expect(repo.listEvaluations(node.nodeId)[0].status).toBe('stale');
  });

  it('信息隔离：观察中出现 seed 或凭据时拒绝落库', () => {
    const state = sampleGame(59);
    const { branch } = seedMatchWithHand(state);
    const seat = currentSeat(state), after = bid(state, seat, 70);
    const node = repo.appendActionNode({ branchId: branch.branchId, seq: 0,
      command: { kind: 'bid', seat, bid: 70 }, source: 'ai', state: after, createdAt: 50 });
    const valid = observeDecision(after, 0);
    const make = (observation: typeof valid) => ({
      nodeId: node.nodeId, requestId: requestId('leak'), sessionId: 's', seat: 0,
      phase: 'bidding' as const, purpose: 'auto' as const, observation,
      candidates: [{ bid: 70 }], recommended: { bid: 70 }, status: 'evaluated' as const, latencyMs: 1, createdAt: 51,
    });
    expect(() => repo.recordEvaluation(make(Object.assign({}, valid, { seed: 12345 })))).toThrow(HistoryProtocolError);
    expect(() => repo.recordEvaluation(make(Object.assign({}, valid, { headers: { Authorization: 'Bearer x' } })))).toThrow(/禁止落库/);
    expect(() => repo.recordEvaluation(make(valid))).not.toThrow();
  });

  it('配置版本按 (profile_id, config_hash) 幂等，并拒绝凭据字段', () => {
    const input = {
      profileId: 'p1', version: '1.0.0', configHash: 'hash-a', type: 'llm', name: '本地模型',
      parameters: { model: 'qwen', temperature: 0.7 }, createdAt: 60,
    };
    const first = repo.recordProfileVersion(input);
    const second = repo.recordProfileVersion({ ...input, parameters: { model: 'qwen', temperature: 0.7 } });
    expect(second.profileVersionId).toBe(first.profileVersionId);
    expect(repo.listProfileVersions('p1')).toHaveLength(1);
    expect(repo.getProfileVersion(first.profileVersionId)!.parameters).toEqual({ model: 'qwen', temperature: 0.7 });

    expect(() =>
      repo.recordProfileVersion({ ...input, configHash: 'hash-b', parameters: { apiKey: 'sk-secret' } }),
    ).toThrow(/凭据/);
    expect(() =>
      repo.recordProfileVersion({ ...input, configHash: 'hash-c', parameters: { nested: { authToken: 'x' } } }),
    ).toThrow(/凭据/);
  });

  it('座位配置版本变更按分支记录并可查询', () => {
    const state = sampleGame(61);
    const { hand, branch } = seedMatchWithHand(state);
    const profile = repo.recordProfileVersion({
      profileId: 'p2', version: '1', configHash: 'hash-sa', type: 'optimized', name: 'PIMC', parameters: {}, createdAt: 70,
    });
    repo.recordSeatAssignment({ handId: hand.handId, branchId: branch.branchId, seat: 0, kind: 'human', createdAt: 71 });
    repo.recordSeatAssignment({
      handId: hand.handId, branchId: branch.branchId, seat: 1, kind: 'ai', profileVersionId: profile.profileVersionId, createdAt: 72,
    });
    const assignments = repo.listSeatAssignments(hand.handId, branch.branchId);
    expect(assignments).toHaveLength(2);
    expect(assignments.find(item => item.seat === 0)!.kind).toBe('human');
    expect(assignments.find(item => item.seat === 1)!.profileVersionId).toBe(profile.profileVersionId);
  });

  it('分支可记录支线及其起点节点，保留原始路径', () => {
    const state = sampleGame(67);
    const { hand, branch } = seedMatchWithHand(state);
    const seat = currentSeat(state), after = bid(state, seat, 75);
    const node = repo.appendActionNode({ branchId: branch.branchId, seq: 0,
      command: { kind: 'bid', seat, bid: 75 }, source: 'human', state: after, createdAt: 80 });
    const alt = repo.createBranch({ handId: hand.handId, sourceNodeId: node.nodeId, name: '假设：加叫', kind: 'branch', createdAt: 81 });
    const nextSeat = currentSeat(after), alternative = bid(after, nextSeat, 80);
    const branched = repo.appendActionNode({ branchId: alt.branchId, parentId: node.nodeId, seq: 1,
      command: { kind: 'bid', seat: nextSeat, bid: 80 }, source: 'manual', state: alternative, createdAt: 82 });
    expect(branched.seq).toBe(1);
    expect(repo.listActionNodes(alt.branchId)).toHaveLength(1);
    expect(repo.listBranches(hand.handId)).toHaveLength(2);
    expect(repo.getBranch(branch.branchId)!.tipNodeId).toBe(node.nodeId);
  });

  it('外键约束阻止孤儿记录', () => {
    expect(() =>
      repo.createHand({ matchId: 'missing-match', handIndex: 1, startSnapshot: sampleGame(), startedAt: 1 }),
    ).toThrow();
    expect(() =>
      repo.createBranch({ handId: 'missing-hand', name: 'x', createdAt: 1 }),
    ).toThrow();
  });

  it('完整性自检通过，且外部改写局面会被指纹发现', () => {
    const state = sampleGame(71);
    const { branch } = seedMatchWithHand(state);
    repo.appendActionNode({
      branchId: branch.branchId, parentId: null, seq: 0,
      command: { kind: 'bid', seat: currentSeat(state), bid: 70 }, source: 'human', state: bid(state, currentSeat(state), 70), createdAt: 90,
    });
    const report = repo.integrityCheck();
    expect(report.foreignKeyViolations).toHaveLength(0);
    expect(report.orphanNodes).toBe(0);
    expect(report.digestMismatches).toBe(0);

    // 直接篡改底层行，模拟历史文件被外部工具改动。
    const raw = repo as unknown as { db: { prepare: (sql: string) => { run: (...args: unknown[]) => void } } };
    raw.db.prepare('UPDATE action_nodes SET state = ?').run(JSON.stringify({ v: 1, data: { tampered: true } }));
    expect(report.foreignKeyViolations).toBeDefined();
    expect(() => repo.listActionNodes(branch.branchId)).toThrow(HistoryProtocolError);
    expect(repo.integrityCheck().digestMismatches).toBeGreaterThan(0);
  });

  it('备份到文件后可重新打开并读到同样的历史', () => {
    const dir = mkdtempSync(join(tmpdir(), 'history-backup-'));
    const target = join(dir, 'snapshot.db');
    try {
      const state = sampleGame(73);
      const { match, hand } = seedMatchWithHand(state);
      repo.backup(target);
      expect(existsSync(target)).toBe(true);

      const reopened = new SqliteHistoryRepository({ path: target });
      expect(reopened.getMatch(match.matchId)!.matchId).toBe(match.matchId);
      expect(reopened.getHand(hand.handId)!.startSnapshot.hands).toEqual(hand.startSnapshot.hands);
      reopened.close();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('历史库开关与路径解析', () => {
  const dirs: string[] = [];
  const tempPath = (name = 'history.db'): string => {
    const dir = mkdtempSync(join(tmpdir(), 'history-env-'));
    dirs.push(dir);
    return join(dir, name);
  };

  afterEach(() => {
    closeHistoryRepository();
    for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
  });

  it('GAME_HISTORY 关闭时返回 null 而不是抛错', () => {
    for (const flag of ['off', '0', 'false', 'no', 'disabled', 'OFF', ' off ']) {
      expect(isHistoryEnabled({ GAME_HISTORY: flag })).toBe(false);
      expect(openHistoryRepository({ path: tempPath(), env: { GAME_HISTORY: flag } })).toBeNull();
    }
    expect(isHistoryEnabled({})).toBe(true);
    expect(isHistoryEnabled({ GAME_HISTORY: 'on' })).toBe(true);
  });

  it('显式 force 只用于自检，绕过开关后仍可打开', () => {
    const repo = openHistoryRepository({ path: tempPath(), force: true, env: { GAME_HISTORY: 'off' } });
    expect(repo).not.toBeNull();
    expect(repo!.integrityCheck().digestMismatches).toBe(0);
  });

  it('路径按 GAME_DB_PATH 解析，缺省回退 DEFAULT_HISTORY_DB_PATH', () => {
    expect(resolveHistoryDbPath({ GAME_DB_PATH: 'data/history.db' })).toBe('data/history.db');
    expect(resolveHistoryDbPath({ GAME_DB_PATH: '/tmp/abs.db' })).toBe('/tmp/abs.db');
    expect(resolveHistoryDbPath({ GAME_DB_PATH: '   ' })).toBe(DEFAULT_HISTORY_DB_PATH);
    expect(resolveHistoryDbPath({})).toBe(DEFAULT_HISTORY_DB_PATH);
  });

  it('同一路径复用同一实例，切换路径时释放旧连接', () => {
    const path = tempPath();
    const first = openHistoryRepository({ path, force: true, env: {} });
    const again = openHistoryRepository({ path, force: true, env: {} });
    expect(again).toBe(first);

    const other = openHistoryRepository({ path: tempPath('other.db'), force: true, env: {} });
    expect(other).not.toBe(first);
    expect(currentHistoryRepository()).toBe(other);
  });
});
