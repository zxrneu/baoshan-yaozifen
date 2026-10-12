/** P0.1 仓储缺陷回归：合法引擎状态、失败原子性、幂等与归属隔离（SRP）。 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { DatabaseSync } from 'node:sqlite';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { bid, createGame, currentBidder } from '../src/engine';
import { SqliteHistoryRepository } from '../server/history/sqliteRepository';
import { observeDecision } from '../src/ai/decisionObservation';
import { contentDigest, HISTORY_PROTOCOL_VERSION, HistoryProtocolError } from '../src/history/protocol';
import { MIGRATIONS } from '../server/history/migrations';

function raw(repo: SqliteHistoryRepository): DatabaseSync { return Reflect.get(repo, 'db') as DatabaseSync; }
describe('SQLite 存储回归', () => {
  let repo: SqliteHistoryRepository;
  beforeEach(() => { repo = new SqliteHistoryRepository({ path: ':memory:' }); });
  afterEach(() => { repo.close(); });
  function fixture() {
    const start = createGame(4242);
    const match = repo.createMatch({ source: 'human', startedAt: 1, targetWins: 5 });
    const hand = repo.createHand({ matchId: match.matchId, handIndex: 0, startSnapshot: start, startedAt: 1 });
    const branch = repo.createBranch({ handId: hand.handId, name: '真实', createdAt: 1 });
    const seat = currentBidder(start)!;
    const state = bid(start, seat, null);
    const node = { branchId: branch.branchId, parentId: null, seq: 0, command: { kind: 'bid' as const, seat, bid: null }, source: 'human' as const, state, createdAt: 2 };
    return { start, match, hand, branch, node };
  }
  it('缺省节点 ID 的提交重试稳定，跨分支同局面不会串身份', () => {
    const f = fixture();
    const first = repo.recordCommit({ matchId: f.match.matchId, node: f.node });
    expect(repo.recordCommit({ matchId: f.match.matchId, node: { ...f.node, createdAt: 9 } })).toEqual({ ...first, duplicated: true });
    const branch = repo.createBranch({ handId: f.hand.handId, kind: 'branch', name: '从起点', createdAt: 2 });
    const other = repo.recordCommit({ matchId: f.match.matchId, node: { ...f.node, branchId: branch.branchId } });
    expect(other.nodeId).not.toBe(first.nodeId);
    expect(repo.listActionNodes(f.branch.branchId)).toHaveLength(1);
  });
  it('重复节点 ID 内容或分支冲突不能伪装确认成功', () => {
    const f = fixture();
    repo.recordCommit({ matchId: f.match.matchId, nodeId: 'fixed', node: f.node });
    expect(() => repo.recordCommit({ matchId: f.match.matchId, nodeId: 'fixed', node: { ...f.node, source: 'manual' } })).toThrow(/冲突/);
    expect(() => repo.recordCommit({ matchId: f.match.matchId, nodeId: 'fixed', node: { ...f.node, command: { kind: 'bid', seat: 1, bid: 70 } } })).toThrow(/冲突/);
    const alt = repo.createBranch({ handId: f.hand.handId, kind: 'branch', name: '假设', createdAt: 3 });
    expect(() => repo.recordCommit({ matchId: f.match.matchId, nodeId: 'fixed', node: { ...f.node, branchId: alt.branchId } })).toThrow(/冲突/);
  });
  it('节点坏摘要在写前拒绝，append 与 commit 都不推进游标', () => {
    const f = fixture();
    expect(() => repo.appendActionNode({ ...f.node, digest: 'bad' })).toThrow(/指纹|摘要/);
    expect(() => repo.recordCommit({ matchId: f.match.matchId, node: { ...f.node, digest: 'bad' } })).toThrow(/指纹|摘要/);
    expect(repo.listActionNodes(f.branch.branchId)).toHaveLength(0);
    expect(repo.getBranch(f.branch.branchId)!.tipNodeId).toBeNull();
  });
  it('append 更新游标时显式 SQL 故障回滚整个节点', () => {
    const f = fixture();
    raw(repo).exec("CREATE TRIGGER fail_tip BEFORE UPDATE OF tip_node_id ON branches BEGIN SELECT RAISE(ABORT, 'injected tip failure'); END");
    expect(() => repo.appendActionNode(f.node)).toThrow(/injected tip failure/);
    expect(repo.listActionNodes(f.branch.branchId)).toHaveLength(0);
    expect(repo.getBranch(f.branch.branchId)!.tipNodeId).toBeNull();
  });
  it('支线第二步按末端序号连续，首步不能绕过 source', () => {
    const f = fixture();
    const n0 = repo.appendActionNode(f.node);
    const s2 = bid(f.node.state, currentBidder(f.node.state)!, null);
    const n1 = repo.appendActionNode({ ...f.node, parentId: n0.nodeId, seq: 1, command: { kind: 'bid', seat: 2, bid: null }, state: s2 });
    const alt = repo.createBranch({ handId: f.hand.handId, sourceNodeId: n1.nodeId, name: '假设', createdAt: 3 });
    expect(() => repo.appendActionNode({ ...f.node, branchId: alt.branchId })).toThrow(/父节点/);
    const s3 = bid(s2, currentBidder(s2)!, null);
    const a = repo.appendActionNode({ ...f.node, branchId: alt.branchId, parentId: n1.nodeId, seq: 2, command: { kind: 'bid', seat: 3, bid: null }, state: s3 });
    const s4 = bid(s3, currentBidder(s3)!, null);
    const b = repo.appendActionNode({ ...f.node, branchId: alt.branchId, parentId: a.nodeId, seq: 3, command: { kind: 'bid', seat: 0, bid: null }, state: s4 });
    expect(b.seq).toBe(3);
    expect(repo.listActionNodes(alt.branchId)).toHaveLength(2);
  });
  it('提交 matchId 和分支所属场必须一致', () => {
    const f = fixture();
    expect(() => repo.recordCommit({ matchId: f.hand.handId, node: f.node })).toThrow(/比赛|场|match/);
    expect(repo.listActionNodes(f.branch.branchId)).toHaveLength(0);
  });
  it('支线结算拒绝更新共享副摘要且整笔回滚', () => {
    const f = fixture();
    const branch = repo.createBranch({ handId: f.hand.handId, kind: 'branch', name: '假设', createdAt: 2 });
    expect(() => repo.recordCommit({ matchId: f.match.matchId, node: { ...f.node, branchId: branch.branchId }, handSummary: { endedAt: 3, declarer: 1, bid: 70, trump: 'S', result: null, unplayedPoints: 0 } })).toThrow(/支线|真实/);
    expect(repo.getHand(f.hand.handId)!.result).toBeNull();
    expect(repo.listActionNodes(branch.branchId)).toHaveLength(0);
  });
  it('节点命令与前一局面转换必须一致而不是保存任意合法状态', () => {
    const f = fixture();
    expect(() => repo.appendActionNode({ ...f.node, state: f.start })).toThrow(/动作|局面/);
    expect(repo.listActionNodes(f.branch.branchId)).toHaveLength(0);
  });
  it('拒绝跨副源节点、跨分支座位绑定、不存在配置和非法座位', () => {
    const f = fixture(); const n = repo.appendActionNode(f.node);
    const otherHand = repo.createHand({ matchId: f.match.matchId, handIndex: 1, startSnapshot: f.start, startedAt: 3 });
    expect(() => repo.createBranch({ handId: otherHand.handId, sourceNodeId: n.nodeId, name: '跨副', createdAt: 3 })).toThrow();
    const input = { handId: f.hand.handId, branchId: f.branch.branchId, seat: 0, kind: 'human' as const, createdAt: 3 };
    expect(() => repo.recordSeatAssignment({ ...input, handId: otherHand.handId })).toThrow();
    expect(() => repo.recordSeatAssignment({ ...input, nodeId: 'missing' })).toThrow();
    expect(() => repo.recordSeatAssignment({ ...input, profileVersionId: 'missing' })).toThrow();
    expect(() => repo.recordSeatAssignment({ ...input, seat: 9 })).toThrow();
    expect(() => raw(repo).prepare('INSERT INTO seat_assignments VALUES(?,?,?,?,?,?,?,?)').run('bad', f.hand.handId, f.branch.branchId, 'missing', 0, 'human', null, 1)).toThrow();
    expect(repo.integrityCheck().foreignKeyViolations).toEqual([]);
  });
  it('错误详情、回退信息和大小写变体凭据不得落库，正常 maxTokens 可保存', () => {
    const f = fixture(); const n = repo.appendActionNode(f.node);
    const e = { nodeId: n.nodeId, requestId: 'req', sessionId: 's', seat: 1, phase: 'bidding' as const, purpose: 'auto' as const, observation: observeDecision(f.node.state, 1), candidates: null, recommended: null, status: 'evaluated' as const, latencyMs: 1, createdAt: 3 };
    expect(() => repo.recordEvaluation({ ...e, errorDetails: 'Authorization: Bearer sk-demo' })).toThrow(/禁止落库/);
    expect(() => repo.recordEvaluation({ ...e, fallbackReason: 'https://user:pass@example.test/v1' })).toThrow(/禁止落库/);
    expect(() => repo.recordEvaluation({ ...e, observation: Object.assign({}, e.observation, { access_token: 'secret' }) })).toThrow(/禁止落库/);
    const p = { profileId: 'llm', version: '1', configHash: contentDigest({ maxTokens: 1024 }), type: 'llm', name: '本地', parameters: { maxTokens: 1024, temperature: 0.5 }, createdAt: 3 };
    expect(repo.recordProfileVersion(p).parameters.maxTokens).toBe(1024);
    expect(() => repo.recordProfileVersion({ ...p, configHash: 'other', parameters: { baseUrl: 'https://example.test' } })).toThrow(/凭据|端点/);
  });
  it('重复配置 hash 内容冲突与评估缺失节点明确拒绝', () => {
    const f = fixture(); const n = repo.appendActionNode(f.node);
    const p = { profileId: 'p', version: '1', configHash: 'fixed', type: 'llm', name: '本地', parameters: {}, createdAt: 3 };
    repo.recordProfileVersion(p);
    expect(() => repo.recordProfileVersion({ ...p, parameters: { temperature: 1 } })).toThrow(/冲突/);
    const e = { nodeId: n.nodeId, requestId: 'req', sessionId: 's', seat: 1, phase: 'bidding' as const, purpose: 'auto' as const, observation: observeDecision(f.node.state, 1), candidates: null, recommended: null, status: 'evaluated' as const, latencyMs: 1, createdAt: 3 };
    repo.recordEvaluation(e);
    expect(() => repo.recordEvaluation({ ...e, nodeId: 'missing' })).toThrow(/不存在/);
  });
});

describe('SQLite 迁移与只读保护', () => {
  const dirs: string[] = [];
  const path = () => { const dir = mkdtempSync(join(tmpdir(), 'history-regression-')); dirs.push(dir); return join(dir, 'history.db'); };
  afterEach(() => { for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true }); });
  it('未来版本数据库拒绝前不执行 DDL 或改变文件', () => {
    const file = path(); const db = new DatabaseSync(file);
    db.exec("CREATE TABLE schema_migrations(version INTEGER PRIMARY KEY, name TEXT NOT NULL, applied_at INTEGER NOT NULL); INSERT INTO schema_migrations VALUES(99,'future',1)"); db.close();
    const before = readFileSync(file);
    expect(() => new SqliteHistoryRepository({ path: file })).toThrow(/高于/);
    expect(readFileSync(file)).toEqual(before);
    const check = new DatabaseSync(file, { readOnly: true });
    expect(check.prepare('SELECT version FROM schema_migrations').all()).toEqual([{ version: 99 }]); check.close();
  });
  it('旧 schema 空库可以追加迁移，不改写 v1 定义', () => {
    const file = path(); const db = new DatabaseSync(file);
    db.exec('CREATE TABLE schema_migrations(version INTEGER PRIMARY KEY, name TEXT NOT NULL, applied_at INTEGER NOT NULL)');
    for (const statement of MIGRATIONS[0].statements) db.exec(statement);
    db.prepare('INSERT INTO schema_migrations VALUES(?,?,?)').run(1, MIGRATIONS[0].name, 1); db.close();
    const repo = new SqliteHistoryRepository({ path: file });
    expect(repo.schemaVersion()).toBeGreaterThan(1); repo.close();
  });
  it('已填充 v2 库追加升级保留动作、分支、观察与配置参数', () => {
    const file = path(); const db = new DatabaseSync(file);
    db.exec('CREATE TABLE schema_migrations(version INTEGER PRIMARY KEY, name TEXT NOT NULL, applied_at INTEGER NOT NULL)');
    for (const migration of MIGRATIONS.slice(0, 2)) {
      for (const statement of migration.statements) db.exec(statement);
      db.prepare('INSERT INTO schema_migrations VALUES(?,?,?)').run(migration.version, migration.name, 1);
    }
    const start = createGame(4242), state = bid(start, 1, null);
    const encode = (game: typeof start) => JSON.stringify({ v: HISTORY_PROTOCOL_VERSION, data: {
      protocolVersion: HISTORY_PROTOCOL_VERSION, ruleSetId: 'basic-v1', ruleVersion: 1, snapshot: game,
    } });
    db.exec("INSERT INTO matches VALUES('m',1,NULL,'human','in_progress',5,'basic-v1',1,NULL,NULL)");
    db.prepare('INSERT INTO hands VALUES(?,?,?,?,?,?,?,?,?,?,?)').run('h','m',0,encode(start),1,null,null,null,null,null,null);
    db.exec("INSERT INTO branches VALUES('b','h',NULL,'真实',NULL,'actual',1)");
    // 摘要算法与写入协议共享，旧库只缺少 v3 的 JSON 信封与复合请求键。
    const digest = contentDigest({ state: JSON.parse(JSON.stringify(state)) });
    db.prepare('INSERT INTO action_nodes VALUES(?,?,?,?,?,?,?,?,?,?)').run('n','b',null,0,JSON.stringify({ kind: 'bid', seat: 1, bid: null }),'human',encode(state),digest,null,2);
    db.exec("UPDATE branches SET tip_node_id='n'; INSERT INTO profile_versions VALUES('p','llm','1','hash','llm','默认','{\"maxTokens\":1024}',NULL,1)");
    db.prepare('INSERT INTO evaluations VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)').run('e','n','r','s',2,'bidding','hint',JSON.stringify(observeDecision(state,2)),null,null,'evaluated',1,'p',null,null,null,null,3);
    db.exec("INSERT INTO seat_assignments VALUES('a','h','b',NULL,0,'ai','p',1)");
    db.close();
    const repo = new SqliteHistoryRepository({ path: file });
    try {
      expect(repo.getActionNode('n')!.state).toEqual(state);
      expect(repo.getBranch('b')!.tipNodeId).toBe('n');
      expect(repo.getEvaluationByRequest('n','r')!.observation).toEqual(observeDecision(state,2));
      expect(repo.getProfileVersion('p')!.parameters).toEqual({ maxTokens: 1024 });
      expect(repo.listSeatAssignments('h')).toHaveLength(1);
      expect(repo.integrityCheck().foreignKeyViolations).toEqual([]);
    } finally { repo.close(); }
  });
  it('在线备份可只读打开，且不会覆盖已有文件', async () => {
    const file = path(); const target = path();
    const repo = new SqliteHistoryRepository({ path: file });
    try {
      const match = repo.createMatch({ source: 'human', startedAt: 1, targetWins: 5 });
      expect(await repo.backupAsync(target)).toBe(target);
      const restored = new SqliteHistoryRepository({ path: target, readonly: true });
      try { expect(restored.getMatch(match.matchId)).toEqual(match); } finally { restored.close(); }
      const before = readFileSync(target);
      await expect(repo.backupAsync(target)).rejects.toThrow(/已存在/);
      expect(readFileSync(target)).toEqual(before);
    } finally { repo.close(); }
  });
  it('迁移遇到旧库重复 seq 时回滚并保留原库', () => {
    const file = path(); const db = new DatabaseSync(file);
    db.exec('CREATE TABLE schema_migrations(version INTEGER PRIMARY KEY, name TEXT NOT NULL, applied_at INTEGER NOT NULL)');
    for (const statement of MIGRATIONS[0].statements) db.exec(statement);
    db.prepare('INSERT INTO schema_migrations VALUES(?,?,?)').run(1, MIGRATIONS[0].name, 1);
    db.exec("INSERT INTO matches VALUES('m',1,NULL,'human','in_progress',5,'basic-v1',1,NULL,NULL); INSERT INTO hands VALUES('h','m',0,'{}',1,NULL,NULL,NULL,NULL,NULL,NULL); INSERT INTO branches VALUES('b','h',NULL,'真实',NULL,'actual',1); INSERT INTO action_nodes VALUES('n1','b',NULL,0,'{}','human','{}','x',NULL,1); INSERT INTO action_nodes VALUES('n2','b',NULL,0,'{}','human','{}','x',NULL,1)"); db.close();
    expect(() => new SqliteHistoryRepository({ path: file })).toThrow(HistoryProtocolError);
    const check = new DatabaseSync(file, { readOnly: true });
    expect(check.prepare('SELECT version FROM schema_migrations').all()).toEqual([{ version: 1 }]);
    expect(check.prepare('SELECT COUNT(*) AS n FROM action_nodes').get()).toEqual({ n: 2 }); check.close();
  });
  it('readonly 不建库不迁移不能写入，重复 close 安全', () => {
    const file = path(); const writable = new SqliteHistoryRepository({ path: file });
    const match = writable.createMatch({ source: 'human', startedAt: 1, targetWins: 5 }); writable.close();
    const readonly = new SqliteHistoryRepository({ path: file, readonly: true });
    expect(readonly.getMatch(match.matchId)).not.toBeNull();
    expect(() => readonly.createMatch({ source: 'human', startedAt: 2, targetWins: 5 })).toThrow();
    readonly.close(); expect(() => readonly.close()).not.toThrow();
    expect(() => new SqliteHistoryRepository({ path: join(file, '..', 'missing.db'), readonly: true })).toThrow();
  });
  it('跨关闭重开缺省 ID 的重试仍幂等，节点状态保存种子与历史', () => {
    const file = path(); let repo = new SqliteHistoryRepository({ path: file }); const start = createGame(4242);
    const match = repo.createMatch({ source: 'human', startedAt: 1, targetWins: 5 }); const hand = repo.createHand({ matchId: match.matchId, handIndex: 0, startSnapshot: start, startedAt: 1 }); const branch = repo.createBranch({ handId: hand.handId, name: '真实', createdAt: 1 });
    const node = { branchId: branch.branchId, seq: 0, command: { kind: 'bid' as const, seat: 1, bid: null }, source: 'human' as const, state: bid(start, 1, null), createdAt: 2 };
    const commit = repo.recordCommit({ matchId: match.matchId, node }); repo.close(); repo = new SqliteHistoryRepository({ path: file });
    expect(repo.recordCommit({ matchId: match.matchId, node }).duplicated).toBe(true);
    expect(repo.getActionNode(commit.nodeId)!.state).toEqual(node.state);
    const stored = raw(repo).prepare('SELECT state FROM action_nodes').get()!;
    expect(JSON.parse(String(stored.state)).v).toBe(HISTORY_PROTOCOL_VERSION); repo.close();
  });
});
