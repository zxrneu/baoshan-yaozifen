/**
 * SQLite 历史仓储（SOLID - SRP / LSP / DIP）。
 * 通过驱动与行适配器访问内置 SQLite；本模块只编排 SQL 和提交事务。
 * 对外实现共享 HistoryRepository 契约，领域校验与连接迁移各自独立。
 */
import type { DatabaseSync } from 'node:sqlite';
import { existsSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { GameState, bid, declareTrump, bury, playCard, nextHand } from '../../src/engine';
import {
  ActionNodeInput,
  ActionNodeRecord,
  BranchKind,
  BranchRecord,
  BranchRecordInput,
  EvaluationInput,
  EvaluationRecord,
  EvaluationStatus,
  EVALUATION_STATUSES,
  HandRecord,
  HandRecordInput,
  HandSummaryPatch,
  HistoryCommitInput,
  HistoryCommitResult,
  HistoryProtocolError,
  HistoryRepository,
  MatchRecord,
  MatchQuery,
  MatchRecordInput,
  MatchStatus,
  MATCH_SOURCES,
  MATCH_STATUSES,
  NODE_SOURCES,
  NodeSource,
  ProfileVersionInput,
  ProfileVersionRecord,
  RULE_SET_ID,
  RULE_VERSION,
  SEAT_ASSIGNMENT_KINDS,
  SeatAssignmentInput,
  SeatAssignmentRecord,
  actionNodeIdentity,
  canonicalJson,
  commandValue,
  isRecord,
  writeVersioned,
  readVersioned,
} from '../../src/history/protocol';
import { openDatabase } from './database';
import type { SqliteHistoryOptions } from './database';
export type { SqliteHistoryOptions } from './database';
import { loadSqliteModule } from './sqliteDriver';
import { derivedHistoryId, newHistoryId } from '../../src/history/ids';
import { encodeNodeState, nodeSnapshotSource, nodeStateDigest, decodeNodeState } from './snapshotCodec';
import { matchFromRow, handFromRow, branchFromRow, nodeFromRow, evaluationFromRow, profileVersionFromRow, assignmentFromRow } from './rowMappers';
import { assertEvaluationObservation, assertHandSummary, assertInteger, assertSafeValue, assertSeat, assertTimestamp } from './validation';
export { DEFAULT_HISTORY_DB_PATH, resolveHistoryDbPath } from '../../src/history/environment';

import type { HistoryWrite } from '../../src/history/transport';

type Row = Record<string, unknown>;

function storedTimestamp(value: number): number {
  return assertTimestamp(value);
}

export class SqliteHistoryRepository implements HistoryRepository {
  private readonly db: DatabaseSync;
  private closed = false;
  private transactionDepth = 0;

  constructor(options: SqliteHistoryOptions) {
    this.db = openDatabase(options);
  }

  /** HTTP 包的一次事务：起点、跨副、配置与结算不能留下半份记录。 */
  writeHistory(packet: HistoryWrite): void {
    this.transaction(() => {
      if (packet.match) this.createMatch(packet.match);
      for (const profile of packet.profiles ?? []) this.recordProfileVersion(profile);
      // nextHand 保存在旧副动作链，随后原子创建新副起点。
      if (packet.commit) this.recordCommit(packet.commit);
      if (packet.hand) this.createHand(packet.hand);
      if (packet.branch) this.createBranch(packet.branch);
      for (const assignment of packet.assignments ?? []) this.recordSeatAssignment(assignment);
      for (const evaluation of packet.evaluations ?? []) this.recordEvaluation(evaluation);
      for (const update of packet.evaluationStatuses ?? []) this.updateEvaluationStatus(update.evaluationId, update.status, update.appliedNodeId);
      if (packet.status) this.updateMatchStatus(packet.status.matchId, packet.status.status, packet.status.endedAt);
    });
  }

  schemaVersion(): number {
    return Number((this.db.prepare('SELECT MAX(version) AS v FROM schema_migrations').get() as Row).v ?? 0);
  }

  // -------------------------------------------------------------------------
  // 比赛
  // -------------------------------------------------------------------------

  createMatch(input: MatchRecordInput): MatchRecord {
    assertInteger(input.targetWins, '目标胜副', 1);
    if (!MATCH_SOURCES.includes(input.source) || !MATCH_STATUSES.includes(input.status ?? 'in_progress')) throw new HistoryProtocolError('非法比赛来源或状态');
    const matchId = input.matchId ?? newHistoryId('match');
    const record: MatchRecord = {
      matchId,
      startedAt: storedTimestamp(input.startedAt),
      endedAt: input.endedAt ?? null,
      source: input.source,
      status: input.status ?? 'in_progress',
      targetWins: input.targetWins,
      ruleSetId: RULE_SET_ID,
      ruleVersion: RULE_VERSION,
      appVersion: input.appVersion ?? null,
      implementationVersion: input.implementationVersion ?? null,
    };
    if (record.endedAt !== null) {
      assertTimestamp(record.endedAt);
      if (record.endedAt < record.startedAt) throw new HistoryProtocolError('比赛结束时间早于开始时间');
    }
    const previous = this.getMatch(matchId);
    if (previous) {
      for (const key of ['startedAt', 'source', 'targetWins', 'appVersion', 'implementationVersion'] as const) {
        if (canonicalJson(previous[key]) !== canonicalJson(record[key])) throw new HistoryProtocolError(`比赛 ${matchId} 的身份内容冲突`);
      }
      if ((input.status !== undefined && input.status !== previous.status)
        || (input.endedAt !== undefined && input.endedAt !== previous.endedAt)) throw new HistoryProtocolError('比赛状态冲突，请通过 updateMatchStatus 显式更新');
      return previous;
    }
    this.db
      .prepare(
        `INSERT INTO matches (match_id, started_at, ended_at, source, status, target_wins, rule_set_id, rule_version, app_version, implementation_version)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
`,
      )
      .run(
        record.matchId,
        record.startedAt,
        record.endedAt,
        record.source,
        record.status,
        record.targetWins,
        record.ruleSetId,
        record.ruleVersion,
        record.appVersion,
        record.implementationVersion,
      );
    const stored = this.getMatch(matchId);
    if (!stored) throw new HistoryProtocolError(`比赛 ${matchId} 写入后不可读`);
    return stored;
  }

  getMatch(matchId: string): MatchRecord | null {
    const row = this.db.prepare('SELECT * FROM matches WHERE match_id = ?').get(matchId) as Row | undefined;
    return row ? matchFromRow(row) : null;
  }

  listMatches(query: MatchQuery = {}): MatchRecord[] {
    const where: string[] = [];
    const params: unknown[] = [];
    if (query.status) {
      where.push('status = ?');
      params.push(query.status);
    }
    if (query.source) {
      where.push('source = ?');
      params.push(query.source);
    }
    if (query.from !== undefined) { assertInteger(query.from, '开始时间'); where.push('m.started_at >= ?'); params.push(query.from); }
    if (query.to !== undefined) { assertInteger(query.to, '结束时间'); where.push('m.started_at <= ?'); params.push(query.to); }
    if (query.from !== undefined && query.to !== undefined && query.from > query.to) throw new HistoryProtocolError('时间筛选范围非法');
    if (query.engineType) {
      if (!['bridge','algorithm','llm','laya'].includes(query.engineType)) throw new HistoryProtocolError('历史引擎筛选非法');
      where.push('EXISTS (SELECT 1 FROM hands h JOIN seat_assignments a ON a.hand_id=h.hand_id JOIN profile_versions p ON p.profile_version_id=a.profile_version_id WHERE h.match_id=m.match_id AND p.type=?)'); params.push(query.engineType);
    }
    if (query.bid !== undefined) {
      if (![70,75,80,85,90,95,100].includes(query.bid)) throw new HistoryProtocolError('历史叫分筛选非法');
      where.push(`EXISTS (SELECT 1 FROM hands h WHERE h.match_id=m.match_id AND (h.bid=? OR (h.result IS NULL AND EXISTS (SELECT 1 FROM branches b JOIN action_nodes n ON n.node_id=b.tip_node_id WHERE b.hand_id=h.hand_id AND json_extract(n.state,'$.data.snapshot.highestBid')=?))))`); params.push(query.bid,query.bid);
    }
    assertInteger(query.limit ?? 50, '分页数量', 1);
    assertInteger(query.offset ?? 0, '分页偏移');
    const limit = Math.min(query.limit ?? 50, 500);
    params.push(limit, Math.max(query.offset ?? 0, 0));
    const rows = this.db
      .prepare(
        `SELECT m.*, (SELECT COUNT(*) FROM hands h WHERE h.match_id = m.match_id) AS hand_count
         FROM matches m ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
         ORDER BY m.started_at DESC, m.match_id DESC LIMIT ? OFFSET ?`,
      )
      .all(...(params as never[])) as Row[];
    return rows.map(row => matchFromRow(row));
  }

  updateMatchStatus(matchId: string, status: MatchStatus, endedAt: number | null = null): void {
    const match = this.getMatch(matchId);
    if (!match) throw new HistoryProtocolError(`比赛 ${matchId} 不存在`);
    if (!MATCH_STATUSES.includes(status)) throw new HistoryProtocolError('非法比赛状态');
    if (endedAt !== null && assertTimestamp(endedAt) < match.startedAt) throw new HistoryProtocolError('比赛结束时间早于开始时间');
    this.db.prepare('UPDATE matches SET status = ?, ended_at = COALESCE(?, ended_at) WHERE match_id = ?').run(status, endedAt, matchId);
  }

  // -------------------------------------------------------------------------
  // 副
  // -------------------------------------------------------------------------

  createHand(input: HandRecordInput): HandRecord {
    assertInteger(input.handIndex, '副号');
    const match = this.getMatch(input.matchId);
    if (!match) throw new HistoryProtocolError(`比赛 ${input.matchId} 不存在`);
    const handId = input.handId ?? newHistoryId('hand');
    const snapshot = encodeNodeState(input.startSnapshot);
    if (input.startSnapshot.targetWins !== match.targetWins) throw new HistoryProtocolError('副起点目标胜副与比赛不一致');
    if (input.result != null || input.endedAt != null || input.unplayedPoints != null) {
      assertHandSummary({ endedAt: input.endedAt!, declarer: input.declarer ?? null, bid: input.bid ?? null,
        trump: input.trump ?? null, result: input.result ?? null, unplayedPoints: input.unplayedPoints ?? null }, input.startSnapshot, input.startedAt);
    } else if ((input.declarer != null && input.declarer !== input.startSnapshot.declarer)
      || (input.bid != null && input.bid !== input.startSnapshot.highestBid)
      || (input.trump != null && input.trump !== input.startSnapshot.trump)) {
      throw new HistoryProtocolError('副合同摘要与起点不一致');
    }
    const previous = this.getHand(handId);
    if (previous) {
      if (previous.matchId !== input.matchId || previous.handIndex !== input.handIndex
        || previous.startedAt !== input.startedAt || encodeNodeState(previous.startSnapshot) !== snapshot) {
        throw new HistoryProtocolError(`副 ${handId} 的身份内容冲突`);
      }
      for (const key of ['endedAt', 'declarer', 'bid', 'trump', 'result', 'unplayedPoints'] as const) {
        if (input[key] !== undefined && canonicalJson(previous[key]) !== canonicalJson(input[key])) throw new HistoryProtocolError(`副 ${handId} 的摘要内容冲突`);
      }
      return previous;
    }
    this.db
      .prepare(
        `INSERT INTO hands (hand_id, match_id, hand_index, start_snapshot, started_at, ended_at, declarer, bid, trump, result, unplayed_points)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
`,
      )
      .run(
        handId,
        input.matchId,
        input.handIndex,
        snapshot,
        storedTimestamp(input.startedAt),
        input.endedAt ?? null,
        input.declarer ?? null,
        input.bid ?? null,
        input.trump ?? null,
        input.result === undefined || input.result === null ? null : writeVersioned(input.result),
        input.unplayedPoints ?? null,
      );
    const stored = this.getHand(handId);
    if (!stored) throw new HistoryProtocolError(`副 ${handId} 写入后不可读`);
    return stored;
  }

  getHand(handId: string): HandRecord | null {
    const row = this.db.prepare('SELECT * FROM hands WHERE hand_id = ?').get(handId) as Row | undefined;
    return row ? handFromRow(row) : null;
  }

  listHands(matchId: string): HandRecord[] {
    const rows = this.db.prepare('SELECT * FROM hands WHERE match_id = ? ORDER BY hand_index').all(matchId) as Row[];
    return rows.map(row => handFromRow(row));
  }

  updateHandSummary(handId: string, patch: HandSummaryPatch): void {
    const hand = this.getHand(handId);
    if (!hand) throw new HistoryProtocolError(`副 ${handId} 不存在`);
    const actual = this.listBranches(handId).find(branch => branch.kind === 'actual');
    const terminal = actual?.tipNodeId ? this.getActionNode(actual.tipNodeId)!.state : hand.startSnapshot;
    assertHandSummary(patch, terminal, hand.startedAt);
    if (hand.result !== null && (canonicalJson(hand.result) !== canonicalJson(patch.result) || hand.endedAt !== patch.endedAt)) {
      throw new HistoryProtocolError('已确认副结算内容冲突');
    }
    this.db
      .prepare('UPDATE hands SET ended_at = ?, declarer = ?, bid = ?, trump = ?, result = ?, unplayed_points = ? WHERE hand_id = ?')
      .run(
        patch.endedAt,
        patch.declarer,
        patch.bid,
        patch.trump,
        writeVersioned(patch.result),
        patch.unplayedPoints,
        handId,
      );
  }

  // -------------------------------------------------------------------------
  // 分支
  // -------------------------------------------------------------------------

  createBranch(input: BranchRecordInput): BranchRecord {
    const branchId = input.branchId ?? newHistoryId('branch');
    const kind: BranchKind = input.kind ?? (input.sourceNodeId ? 'branch' : 'actual');
    if (!this.getHand(input.handId)) throw new HistoryProtocolError(`副 ${input.handId} 不存在`);
    if (kind === 'actual' && input.sourceNodeId) throw new HistoryProtocolError('真实分支不能指定源节点');
    if (input.sourceNodeId) {
      const source = this.getActionNode(input.sourceNodeId);
      if (!source || this.getBranch(source.branchId)?.handId !== input.handId) throw new HistoryProtocolError('分支源节点不存在或属于另一副');
    }
    const previous = this.getBranch(branchId);
    if (previous) {
      if (previous.handId !== input.handId || previous.sourceNodeId !== (input.sourceNodeId ?? null) || previous.kind !== kind || previous.name !== input.name) throw new HistoryProtocolError(`分支 ${branchId} 的身份内容冲突`);
      return previous;
    }
    if (kind === 'actual' && this.listBranches(input.handId).some(branch => branch.kind === 'actual')) throw new HistoryProtocolError('一副只能有一条真实分支');
    this.db
      .prepare(
        `INSERT INTO branches (branch_id, hand_id, source_node_id, name, tip_node_id, kind, created_at)
         VALUES (?, ?, ?, ?, NULL, ?, ?)
`,
      )
      .run(branchId, input.handId, input.sourceNodeId ?? null, input.name, kind, storedTimestamp(input.createdAt));
    const stored = this.getBranch(branchId);
    if (!stored) throw new HistoryProtocolError(`分支 ${branchId} 写入后不可读`);
    return stored;
  }

  getBranch(branchId: string): BranchRecord | null {
    const row = this.db.prepare('SELECT * FROM branches WHERE branch_id = ?').get(branchId) as Row | undefined;
    return row ? branchFromRow(row) : null;
  }

  listBranches(handId: string): BranchRecord[] {
    const rows = this.db
      .prepare(
        `SELECT b.*, (SELECT COUNT(*) FROM action_nodes n WHERE n.branch_id = b.branch_id) AS node_count
         FROM branches b WHERE b.hand_id = ? ORDER BY b.created_at`,
      )
      .all(handId) as Row[];
    return rows.map(row => branchFromRow(row));
  }

  // -------------------------------------------------------------------------
  // 动作节点
  // -------------------------------------------------------------------------

  appendActionNode(input: ActionNodeInput): ActionNodeRecord {
    return this.transaction(() => this.insertNode(input));
  }

  private transaction<T>(operation: () => T): T {
    const savepoint = `history_${this.transactionDepth++}`;
    const nested = this.transactionDepth > 1;
    this.db.exec(nested ? `SAVEPOINT ${savepoint}` : 'BEGIN IMMEDIATE');
    try {
      const result = operation();
      this.db.exec(nested ? `RELEASE ${savepoint}` : 'COMMIT');
      return result;
    } catch (error) {
      this.db.exec(nested ? `ROLLBACK TO ${savepoint}` : 'ROLLBACK');
      if (nested) this.db.exec(`RELEASE ${savepoint}`);
      throw error;
    } finally { this.transactionDepth--; }
  }

  getActionNode(nodeId: string): ActionNodeRecord | null {
    const row = this.db.prepare('SELECT * FROM action_nodes WHERE node_id = ?').get(nodeId) as Row | undefined;
    return row ? nodeFromRow(row) : null;
  }

  listActionNodes(branchId: string): ActionNodeRecord[] {
    const rows = this.db.prepare('SELECT * FROM action_nodes WHERE branch_id = ? ORDER BY seq').all(branchId) as Row[];
    return rows.map(row => nodeFromRow(row));
  }

  /**
   * 父指针与 seq 连续校验：断链或乱序即拒绝写入，避免历史不可重放。
   *
   * 一条分支有两种合法的首节点来源：
   * 1. 主干分支：首节点 parentId 为 null，seq 为 0；
   * 2. 支线分支：由 sourceNodeId 分叉而来，首节点 parentId 即该源节点——它属于**另一条**分支，
   *    此时分支自身 tipNodeId 仍为 null。因此「父节点必须同分支」只对非首节点成立。
   * 支线首节点的 seq 取源节点 seq + 1，保证沿父指针回溯时序号连续。
   */
  private assertChainIntegrity(branchId: string, parentId: string | null, seq: number): void {
    const branch = this.getBranch(branchId);
    if (!branch) throw new HistoryProtocolError(`分支 ${branchId} 不存在`);
    const expected = branch.nodeCount === undefined ? this.countNodes(branchId) : branch.nodeCount;

    if (expected === 0) {
      // 首节点：主干要求空父指针，支线要求父指针等于自己的分叉源节点。
      const isBranchRoot = branch.sourceNodeId !== null && parentId === branch.sourceNodeId;
      if (parentId !== branch.sourceNodeId) {
        throw new HistoryProtocolError(
          `分支 ${branchId} 的首个动作父节点应为${branch.sourceNodeId ? `源节点 ${branch.sourceNodeId}` : '空'}，实际为 ${parentId}`,
        );
      }
      const firstSeq = isBranchRoot ? (this.getActionNode(parentId as string)?.seq ?? -1) + 1 : 0;
      if (isBranchRoot && firstSeq === 0) {
        throw new HistoryProtocolError(`分支 ${branchId} 的源节点 ${parentId} 不存在，无法确定起始序号`);
      }
      if (seq !== firstSeq) {
        throw new HistoryProtocolError(`分支 ${branchId} 的首个动作序号应为 ${firstSeq}，实际为 ${seq}`);
      }
      return;
    }

    // 非首节点：必须接在当前末端之后，且父节点确属本分支。
    if (branch.tipNodeId !== parentId) {
      throw new HistoryProtocolError(
        `动作父节点 ${parentId ?? '(空)'} 与分支 ${branchId} 当前末端 ${branch.tipNodeId ?? '(空)'} 不一致`,
      );
    }
    if (parentId !== null) {
      const parent = this.getActionNode(parentId);
      if (!parent) throw new HistoryProtocolError(`父节点 ${parentId} 不存在`);
      if (parent.branchId !== branchId) throw new HistoryProtocolError(`父节点 ${parentId} 不属于分支 ${branchId}`);
      if (seq !== parent.seq + 1) throw new HistoryProtocolError(`动作序号 ${seq} 应接在父节点序号 ${parent.seq} 后`);
    }
  }

  private countNodes(branchId: string): number {
    return Number((this.db.prepare('SELECT COUNT(*) AS c FROM action_nodes WHERE branch_id = ?').get(branchId) as Row).c);
  }

  private insertNode(input: ActionNodeInput): ActionNodeRecord {
    // 指纹与落库局面必须来自同一份信封化数据，否则读回校验必然报「历史被外部修改」。
    const snapshot = nodeSnapshotSource(input);
    const digest = nodeStateDigest(snapshot);
    if (input.digest !== undefined && input.digest !== digest) throw new HistoryProtocolError('节点局面指纹与提交摘要不一致');
    const command = commandValue(input.command);
    assertNodeSource(input.source);
    if (!Number.isSafeInteger(input.seq) || input.seq < 0) throw new HistoryProtocolError('动作序号必须是非负整数');
    const nodeId = input.nodeId ?? derivedHistoryId('node', actionNodeIdentity({ ...input, command, state: snapshot }));
    const state = encodeNodeState(snapshot);
    const existing = this.getActionNode(nodeId);
    if (existing) {
      this.assertNodeRetry(existing, { ...input, command, state: snapshot });
      return existing;
    }
    this.assertChainIntegrity(input.branchId, input.parentId ?? null, input.seq);
    this.assertTransition({ ...input, command, state: snapshot });
    this.db
      .prepare(
        `INSERT INTO action_nodes (node_id, branch_id, parent_id, seq, command, source, state, state_digest, checkpoint_id, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        nodeId,
        input.branchId,
        input.parentId ?? null,
        input.seq,
        canonicalJson(command),
        input.source,
        state,
        digest,
        input.checkpoint ? newHistoryId('checkpoint') : null,
        storedTimestamp(input.createdAt),
      );
    this.db.prepare('UPDATE branches SET tip_node_id = ? WHERE branch_id = ?').run(nodeId, input.branchId);
    const stored = this.getActionNode(nodeId);
    if (!stored) throw new HistoryProtocolError(`节点 ${nodeId} 写入后不可读`);
    return stored;
  }

  private assertNodeRetry(existing: ActionNodeRecord, input: ActionNodeInput): void {
    if (existing.branchId !== input.branchId || existing.parentId !== (input.parentId ?? null) || existing.seq !== input.seq || existing.source !== input.source || Boolean(existing.checkpointId) !== Boolean(input.checkpoint) || canonicalJson(existing.command) !== canonicalJson(input.command) || existing.stateDigest !== nodeStateDigest(input.state)) {
      throw new HistoryProtocolError(`节点 ${existing.nodeId} 的幂等身份内容冲突`);
    }
  }

  /** 写前验证动作确实把已确认父局面转换到提交局面，不保存任意合法却不可重放的状态。 */
  private assertTransition(input: ActionNodeInput): void {
    const branch = this.getBranch(input.branchId)!;
    const before = input.parentId ? this.getActionNode(input.parentId)?.state : this.getHand(branch.handId)?.startSnapshot;
    if (!before) throw new HistoryProtocolError('动作缺少可恢复的父局面');
    const command = input.command;
    let after: GameState;
    switch (command.kind) {
      case 'bid': after = bid(before, command.seat, command.bid); break;
      case 'trump': after = declareTrump(before, command.seat, command.trump); break;
      case 'bury': after = bury(before, command.seat, command.cards); break;
      case 'play': after = playCard(before, command.seat, command.card); break;
      case 'nextHand': after = nextHand(before); break;
    }
    if (after === before || nodeStateDigest(after) !== nodeStateDigest(input.state)) throw new HistoryProtocolError('动作与提交后的局面不一致');
  }

  // -------------------------------------------------------------------------
  // 提交边界（幂等事务）
  // -------------------------------------------------------------------------

  /**
   * 一次事务写入：动作节点 + 分支游标 + 可选的副结算、评估、座位绑定。
   * 幂等键是派生出的 nodeId：同一提交重试直接返回 duplicated，不重复插入。
   */
  recordCommit(input: HistoryCommitInput): HistoryCommitResult {
    const node = input.node;
    const branchId = input.branchId ?? node.branchId;
    const snapshot = nodeSnapshotSource(node);
    const command = commandValue(node.command);
    const effective = { ...node, branchId, command, state: snapshot };
    const digest = nodeStateDigest(snapshot);
    if (node.digest !== undefined && node.digest !== digest) throw new HistoryProtocolError('节点局面指纹与提交摘要不一致');
    if (input.nodeId && node.nodeId && input.nodeId !== node.nodeId) throw new HistoryProtocolError('提交节点 ID 冲突');
    const nodeId = input.nodeId ?? node.nodeId ?? derivedHistoryId('node', actionNodeIdentity(effective));
    return this.transaction(() => {
      let branch = this.getBranch(branchId);
      if (!branch && input.branchName !== undefined && input.sourceNodeId !== undefined) {
        const origin = this.getBranch(node.branchId);
        if (!origin) throw new HistoryProtocolError('提交引用的原始分支不存在');
        const originHand = this.getHand(origin.handId)!;
        if (originHand.matchId !== input.matchId) throw new HistoryProtocolError('提交比赛 matchId 与原始分支所属场不一致');
        branch = this.createBranch({ branchId, handId: origin.handId, sourceNodeId: input.sourceNodeId, name: input.branchName, kind: input.branchKind ?? 'branch', createdAt: node.createdAt });
      }
      if (!branch) throw new HistoryProtocolError(`提交引用的分支 ${branchId} 不存在`);
      const hand = this.getHand(branch.handId);
      if (!hand || hand.matchId !== input.matchId) throw new HistoryProtocolError('提交比赛 matchId 与分支所属场不一致');
      if (input.handSummary && branch.kind !== 'actual') throw new HistoryProtocolError('支线结算不能更新真实副摘要');
      if (input.handSummary) assertHandSummary(input.handSummary, snapshot, hand.startedAt);
      const existing = this.getActionNode(nodeId);
      if (existing) {
        this.assertNodeRetry(existing, effective);
        this.assertCommitRetry(input, branch, existing);
        return { nodeId, branchId, duplicated: true };
      }
      this.insertNode({ ...effective, nodeId });
      if (input.handSummary) this.updateHandSummary(hand.handId, input.handSummary);
      if (input.evaluation) {
        if (input.evaluation.nodeId !== nodeId) throw new HistoryProtocolError('评估节点与提交节点冲突');
        this.insertEvaluation(input.evaluation);
      }
      if (input.seatAssignments) for (const assignment of input.seatAssignments) {
        if (assignment.handId !== hand.handId || assignment.branchId !== branchId || (assignment.nodeId != null && assignment.nodeId !== nodeId)) throw new HistoryProtocolError('座位绑定与提交归属冲突');
        this.insertSeatAssignment({ ...assignment, nodeId });
      }
      return { nodeId, branchId, duplicated: false };
    });
  }

  /** 重试不是第二次写入：附属数据也必须匹配已经确认的事实。 */
  private assertCommitRetry(input: HistoryCommitInput, branch: BranchRecord, node: ActionNodeRecord): void {
    if (input.evaluation) {
      const stored = this.getEvaluationByRequest(input.evaluation.nodeId, input.evaluation.requestId);
      if (!stored || !this.sameEvaluation(stored, input.evaluation)) throw new HistoryProtocolError('重复提交评估内容冲突');
    }
    if (input.handSummary) {
      const hand = this.getHand(branch.handId)!;
      for (const key of ['endedAt','declarer','bid','trump','result','unplayedPoints'] as const) {
        if (canonicalJson(hand[key]) !== canonicalJson(input.handSummary[key])) throw new HistoryProtocolError('重复提交副摘要内容冲突');
      }
    }
    for (const assignment of input.seatAssignments ?? []) {
      const target = { ...assignment, nodeId: node.nodeId };
      if (!this.listSeatAssignments(branch.handId, branch.branchId).some(stored => this.sameAssignment(stored, target))) throw new HistoryProtocolError('重复提交座位绑定内容冲突');
    }
  }

  // -------------------------------------------------------------------------
  // 评估
  // -------------------------------------------------------------------------

  recordEvaluation(input: EvaluationInput): EvaluationRecord {
    return this.insertEvaluation(input);
  }

  private insertEvaluation(input: EvaluationInput): EvaluationRecord {
    const evaluationId = input.evaluationId ?? newHistoryId('evaluation');
    this.assertObservationSanitized(input);
    const existingByRequest = this.getEvaluationByRequest(input.nodeId, input.requestId);
    if (existingByRequest) {
      if (!this.sameEvaluation(existingByRequest, input)) throw new HistoryProtocolError(`评估请求 ${input.requestId} 的身份内容冲突`);
      return existingByRequest;
    }
    if (input.nodeId.startsWith('root:')) {
      const branch = this.getBranch(input.nodeId.slice(5));
      if (!branch) throw new HistoryProtocolError('评估起点分支不存在');
      const state = branch.sourceNodeId ? this.getActionNode(branch.sourceNodeId)!.state : this.getHand(branch.handId)!.startSnapshot;
      if ((input.observationPoint ?? 'after') !== 'after') throw new HistoryProtocolError('起点评估只支持 after');
      assertEvaluationObservation(input, state);
      if (!Number.isFinite(input.latencyMs) || input.latencyMs < 0) throw new HistoryProtocolError('评估耗时必须是非负有限数');
      if (!EVALUATION_STATUSES.includes(input.status)) throw new HistoryProtocolError('非法评估状态');
      const record = { ...input, evaluationId, observationPoint: 'after' as const, latencyMs: Math.round(input.latencyMs) };
      this.db.prepare('INSERT INTO initial_evaluations (evaluation_id,branch_id,request_id,profile_version_id,status,data) VALUES (?,?,?,?,?,?)')
        .run(evaluationId, branch.branchId, input.requestId, input.profileVersionId ?? null, input.status, writeVersioned(record));
      return record;
    }
    const node = this.getActionNode(input.nodeId);
    if (!node) throw new HistoryProtocolError('评估引用的节点不存在');
    const observationPoint = input.observationPoint ?? 'after';
    if (!['before', 'after'].includes(observationPoint)) throw new HistoryProtocolError('非法评估观察位置');
    const state = observationPoint === 'after' ? node.state : node.parentId
      ? this.getActionNode(node.parentId)!.state : this.getHand(this.getBranch(node.branchId)!.handId)!.startSnapshot;
    assertEvaluationObservation(input, state);
    if (input.profileVersionId && !this.getProfileVersion(input.profileVersionId)) throw new HistoryProtocolError('评估引用的配置版本不存在');
    assertSeat(input.seat);
    if (!Number.isFinite(input.latencyMs) || input.latencyMs < 0) throw new HistoryProtocolError('评估耗时必须是非负有限数');
    this.db
      .prepare(
        `INSERT INTO evaluations (evaluation_id, node_id, request_id, session_id, seat, phase, purpose, observation, candidates, recommended,
           status, latency_ms, profile_version_id, model_name, engine_type, fallback_reason, error_details, created_at, observation_point)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        evaluationId,
        input.nodeId,
        input.requestId,
        input.sessionId,
        input.seat,
        input.phase,
        input.purpose ?? null,
        writeVersioned(input.observation),
        input.candidates === undefined || input.candidates === null ? null : writeVersioned(input.candidates),
        input.recommended === undefined || input.recommended === null ? null : writeVersioned(input.recommended),
        input.status,
        Math.round(input.latencyMs),
        input.profileVersionId ?? null,
        input.modelName ?? null,
        input.engineType ?? null,
        input.fallbackReason ?? null,
        input.errorDetails ?? null,
        storedTimestamp(input.createdAt),
        observationPoint,
      );
    const stored = this.db.prepare('SELECT * FROM evaluations WHERE evaluation_id = ?').get(evaluationId) as Row;
    return evaluationFromRow(stored);
  }

  /** 持久化字段统一检查，包括诊断文本；完整牌局只能进私有 snapshot 列，不能进观察。 */
  private assertObservationSanitized(input: EvaluationInput): void {
    assertSafeValue(input, `评估 ${input.requestId}`, true);
  }

  private sameEvaluation(stored: EvaluationRecord, input: EvaluationInput): boolean {
    const { evaluationId: storedId, createdAt: storedAt, status: storedStatus, ...a } = stored;
    const { evaluationId: inputId, createdAt: inputAt, status: inputStatus, ...b } = input;
    void storedAt; void storedStatus; void inputAt; void inputStatus;
    const normalized = (value: typeof a) => ({ ...value, appliedNodeId: undefined, observationPoint: value.observationPoint ?? 'after', purpose: value.purpose ?? null, candidates: value.candidates ?? null, recommended: value.recommended ?? null, profileVersionId: value.profileVersionId ?? null, modelName: value.modelName ?? null, engineType: value.engineType ?? null, fallbackReason: value.fallbackReason ?? null, errorDetails: value.errorDetails ?? null, latencyMs: Math.round(value.latencyMs) });
    return (!inputId || inputId === storedId) && canonicalJson(normalized(a)) === canonicalJson(normalized(b));
  }

  private initialEvaluation(row: Row): EvaluationRecord {
    return { ...readVersioned<EvaluationRecord>(String(row.data), '起点评估')!, status: row.status as EvaluationStatus, appliedNodeId: row.applied_node_id as string | null };
  }
  listEvaluations(nodeId: string): EvaluationRecord[] {
    if (nodeId.startsWith('root:')) return (this.db.prepare('SELECT * FROM initial_evaluations WHERE branch_id=?').all(nodeId.slice(5)) as Row[]).map(row => this.initialEvaluation(row));
    const rows = this.db.prepare('SELECT * FROM evaluations WHERE node_id = ? ORDER BY created_at').all(nodeId) as Row[];
    return rows.map(row => evaluationFromRow(row));
  }

  getEvaluationByRequest(nodeId: string, requestId: string): EvaluationRecord | null {
    if (nodeId.startsWith('root:')) {
      const row = this.db.prepare('SELECT * FROM initial_evaluations WHERE branch_id=? AND request_id=?').get(nodeId.slice(5), requestId) as Row | undefined;
      return row ? this.initialEvaluation(row) : null;
    }
    const row = this.db.prepare('SELECT * FROM evaluations WHERE node_id = ? AND request_id = ?').get(nodeId, requestId) as Row | undefined;
    return row ? evaluationFromRow(row) : null;
  }

  updateEvaluationStatus(evaluationId: string, status: EvaluationStatus, appliedNodeId?: string): void {
    const root = this.db.prepare('SELECT status FROM initial_evaluations WHERE evaluation_id=?').get(evaluationId);
    const table = root ? 'initial_evaluations' : 'evaluations';
    const previous = root ?? this.db.prepare('SELECT status FROM evaluations WHERE evaluation_id=?').get(evaluationId);
    if (!previous) throw new HistoryProtocolError(`评估 ${evaluationId} 不存在`);
    if (!EVALUATION_STATUSES.includes(status)) throw new HistoryProtocolError('非法评估状态');
    if (previous.status !== 'evaluated' && previous.status !== status) throw new HistoryProtocolError('评估已进入终态，不能改写状态');
    if (appliedNodeId && (status !== 'applied' || !this.getActionNode(appliedNodeId))) throw new HistoryProtocolError('采用评估必须指向合法执行节点');
    const stored = this.db.prepare(`SELECT applied_node_id FROM ${table} WHERE evaluation_id=?`).get(evaluationId);
    if (stored?.applied_node_id && appliedNodeId && stored.applied_node_id !== appliedNodeId) throw new HistoryProtocolError('已采用评估不能改写执行节点');
    this.db.prepare(`UPDATE ${table} SET status = ?, applied_node_id=COALESCE(?,applied_node_id) WHERE evaluation_id = ?`).run(status, appliedNodeId ?? null, evaluationId);
  }

  // -------------------------------------------------------------------------
  // 配置版本
  // -------------------------------------------------------------------------

  recordProfileVersion(input: ProfileVersionInput): ProfileVersionRecord {
    const profileVersionId = input.profileVersionId ?? newHistoryId('profileVersion');
    assertSafeValue(input, `配置 ${input.profileId}`);
    if (!isRecord(input.parameters)) throw new HistoryProtocolError('配置参数必须是对象');
    const sameVersion = this.db.prepare('SELECT config_hash FROM profile_versions WHERE profile_id=? AND version=?').get(input.profileId, input.version);
    if (sameVersion && sameVersion.config_hash !== input.configHash) throw new HistoryProtocolError('配置版本内容冲突，修改配置必须使用新版本');
    const existing = this.db
      .prepare('SELECT * FROM profile_versions WHERE profile_id = ? AND config_hash = ?')
      .get(input.profileId, input.configHash) as Row | undefined;
    if (existing) {
      const stored = profileVersionFromRow(existing);
      for (const key of ['version','type','name','parameters','implementationVersion'] as const) {
        if (canonicalJson(stored[key] ?? null) !== canonicalJson(input[key] ?? null)) throw new HistoryProtocolError(`配置 ${input.profileId} 的 hash 内容冲突`);
      }
      if (input.profileVersionId && input.profileVersionId !== stored.profileVersionId) throw new HistoryProtocolError('配置版本 ID 冲突');
      return stored;
    }
    this.db
      .prepare(
        `INSERT INTO profile_versions (profile_version_id, profile_id, version, config_hash, type, name, parameters, implementation_version, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        profileVersionId,
        input.profileId,
        input.version,
        input.configHash,
        input.type,
        input.name,
        writeVersioned(input.parameters),
        input.implementationVersion ?? null,
        storedTimestamp(input.createdAt),
      );
    const stored = this.db.prepare('SELECT * FROM profile_versions WHERE profile_version_id = ?').get(profileVersionId) as Row;
    return profileVersionFromRow(stored);
  }

  getProfileVersion(profileVersionId: string): ProfileVersionRecord | null {
    const row = this.db.prepare('SELECT * FROM profile_versions WHERE profile_version_id = ?').get(profileVersionId) as Row | undefined;
    return row ? profileVersionFromRow(row) : null;
  }

  listProfileVersions(profileId: string): ProfileVersionRecord[] {
    const rows = this.db
      .prepare('SELECT * FROM profile_versions WHERE profile_id = ? ORDER BY created_at DESC')
      .all(profileId) as Row[];
    return rows.map(row => profileVersionFromRow(row));
  }

  // -------------------------------------------------------------------------
  // 座位绑定
  // -------------------------------------------------------------------------

  recordSeatAssignment(input: SeatAssignmentInput): SeatAssignmentRecord {
    return this.insertSeatAssignment(input);
  }

  private insertSeatAssignment(input: SeatAssignmentInput): SeatAssignmentRecord {
    const assignmentId = input.assignmentId ?? newHistoryId('assignment');
    assertSeat(input.seat); assertAssignmentKind(input.kind);
    if ((input.kind === 'ai' && !input.profileVersionId) || (input.kind === 'human' && input.profileVersionId != null)) throw new HistoryProtocolError('人工座位不能指定配置，AI 座位必须指定配置版本');
    const branch = this.getBranch(input.branchId);
    if (!branch || branch.handId !== input.handId) throw new HistoryProtocolError('座位绑定分支不属于指定副');
    if (input.nodeId && this.getActionNode(input.nodeId)?.branchId !== input.branchId) throw new HistoryProtocolError('座位绑定节点不存在或不属于指定分支');
    if (input.profileVersionId && !this.getProfileVersion(input.profileVersionId)) throw new HistoryProtocolError('座位绑定配置版本不存在');
    const previous = this.db.prepare('SELECT * FROM seat_assignments WHERE assignment_id=?').get(assignmentId) as Row | undefined;
    if (previous) {
      const stored = assignmentFromRow(previous);
      if (!this.sameAssignment(stored, input)) throw new HistoryProtocolError('座位绑定身份内容冲突');
      return stored;
    }
    this.db
      .prepare(
        `INSERT INTO seat_assignments (assignment_id, hand_id, branch_id, node_id, seat, kind, profile_version_id, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)
`,
      )
      .run(
        assignmentId,
        input.handId,
        input.branchId,
        input.nodeId ?? null,
        input.seat,
        input.kind,
        input.profileVersionId ?? null,
        storedTimestamp(input.createdAt),
      );
    const row = this.db.prepare('SELECT * FROM seat_assignments WHERE assignment_id = ?').get(assignmentId) as Row;
    return assignmentFromRow(row);
  }

  listSeatAssignments(handId: string, branchId?: string): SeatAssignmentRecord[] {
    const rows = branchId
      ? (this.db
          .prepare('SELECT * FROM seat_assignments WHERE hand_id = ? AND branch_id = ? ORDER BY created_at, seat, rowid')
          .all(handId, branchId) as Row[])
      : (this.db.prepare('SELECT * FROM seat_assignments WHERE hand_id = ? ORDER BY created_at, seat, rowid').all(handId) as Row[]);
    return rows.map(row => assignmentFromRow(row));
  }

  private sameAssignment(stored: SeatAssignmentRecord, input: SeatAssignmentInput): boolean {
    return (!input.assignmentId || input.assignmentId === stored.assignmentId) && stored.handId === input.handId && stored.branchId === input.branchId && stored.nodeId === (input.nodeId ?? null) && stored.seat === input.seat && stored.kind === input.kind && (stored.profileVersionId ?? null) === (input.profileVersionId ?? null);
  }

  // -------------------------------------------------------------------------
  // 维护
  // -------------------------------------------------------------------------

  /** 一致性自检：外键、孤儿子节点、指纹与赢家字段。供启动与测试调用。 */
  integrityCheck(): { foreignKeyViolations: string[]; orphanNodes: number; digestMismatches: number } {
    const foreignKeyViolations = (this.db.prepare('PRAGMA foreign_key_check').all() as Row[]).map(row => canonicalJson(row));
    const orphanNodes = Number(
      (this.db
        .prepare(
          `SELECT COUNT(*) AS c FROM action_nodes n
           WHERE n.parent_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM action_nodes p WHERE p.node_id = n.parent_id)`,
        )
        .get() as Row).c,
    );
    let digestMismatches = 0;
    for (const row of this.db.prepare('SELECT node_id, state, state_digest FROM action_nodes').all() as Row[]) {
      try {
        if (String(row.state_digest) !== nodeStateDigest(decodeNodeState(row.state as string))) digestMismatches += 1;
      } catch {
        digestMismatches += 1;
      }
    }
    return { foreignKeyViolations, orphanNodes, digestMismatches };
  }

  /** 在线一致性备份：目标必须是新文件，避免覆盖已有历史或备份。 */
  async backupAsync(destination: string): Promise<string> {
    if (existsSync(destination)) throw new HistoryProtocolError('备份目标已存在，请选择新文件');
    const dir = dirname(destination);
    if (dir && dir !== '.' && !existsSync(dir)) mkdirSync(dir, { recursive: true });
    const { backup } = loadSqliteModule();
    await backup(this.db, destination);
    return destination;
  }

  backup(destination: string): void {
    if (existsSync(destination)) throw new HistoryProtocolError('备份目标已存在，请选择新文件');
    const dir = dirname(destination);
    if (dir && dir !== '.' && !existsSync(dir)) mkdirSync(dir, { recursive: true });
    this.db.prepare('VACUUM INTO ?').run(destination);
  }

  isClosed(): boolean { return this.closed; }

  saveSimulationRun(run: import('../../src/history/simulation').SimulationRun): void {
    assertSafeValue(run, '模拟配置');
    this.db.prepare('INSERT INTO simulation_runs(run_id,created_at,data) VALUES (?,?,?) ON CONFLICT(run_id) DO UPDATE SET data=excluded.data').run(run.runId,run.createdAt,JSON.stringify(run));
  }
  getSimulationRun(runId: string): import('../../src/history/simulation').SimulationRun | null {
    const row=this.db.prepare('SELECT data FROM simulation_runs WHERE run_id=?').get(runId) as Row | undefined;
    return row ? JSON.parse(String(row.data)) : null;
  }
  listSimulationRuns(): import('../../src/history/simulation').SimulationRun[] {
    return (this.db.prepare('SELECT data FROM simulation_runs ORDER BY created_at DESC LIMIT 100').all() as Row[]).map(row=>JSON.parse(String(row.data)));
  }
  saveSimulationBoard(board: import('../../src/history/simulation').SimulationBoard): void {
    assertSafeValue(board, '模拟结果');
    this.db.prepare('INSERT INTO simulation_boards(board_id,run_id,board_index,data) VALUES (?,?,?,?) ON CONFLICT(board_id) DO UPDATE SET data=excluded.data').run(board.boardId,board.runId,board.index,JSON.stringify(board));
  }
  listSimulationBoards(runId: string): import('../../src/history/simulation').SimulationBoard[] {
    return (this.db.prepare('SELECT data FROM simulation_boards WHERE run_id=? ORDER BY board_index').all(runId) as Row[]).map(row=>JSON.parse(String(row.data)));
  }

  close(): void {
    if (this.closed) return;
    this.db.close(); this.closed = true;
  }
}

/** 动作节点来源与座位绑定的合法值校验（供 P0.2 提交边界复用）。 */
export function assertNodeSource(source: string): asserts source is NodeSource {
  if (!NODE_SOURCES.includes(source as NodeSource)) throw new HistoryProtocolError(`未知的动作来源 ${source}`);
}

export function assertAssignmentKind(kind: string): void {
  if (!SEAT_ASSIGNMENT_KINDS.includes(kind as SeatAssignmentRecord['kind'])) {
    throw new HistoryProtocolError(`未知的座位绑定类型 ${kind}`);
  }
}
