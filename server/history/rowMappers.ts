/** SQLite 行到历史契约的适配（SRP）：集中恢复版本化 JSON 和校验局面指纹。 */
import type { GameState } from '../../src/engine';
import type { ActionNodeRecord, BranchRecord, BranchKind, EvaluationInput, EvaluationRecord, EvaluationStatus,
  HandRecord, MatchRecord, MatchSource, MatchStatus, NodeSource, ProfileVersionRecord, SeatAssignmentRecord } from '../../src/history/protocol';
import { HistoryProtocolError, commandValue, isRecord, readHistorySnapshot, readVersioned, suitOrNull } from '../../src/history/protocol';
import { decodeNodeState, nodeStateDigest } from './snapshotCodec';

type Row = Record<string, unknown>;

export function matchFromRow(row: Row, hands = 0): MatchRecord {
  return {
    matchId: String(row.match_id),
    startedAt: Number(row.started_at),
    endedAt: row.ended_at === null || row.ended_at === undefined ? null : Number(row.ended_at),
    source: String(row.source) as MatchSource,
    status: String(row.status) as MatchStatus,
    targetWins: Number(row.target_wins),
    ruleSetId: String(row.rule_set_id),
    ruleVersion: Number(row.rule_version),
    appVersion: (row.app_version as string | null) ?? null,
    implementationVersion: (row.implementation_version as string | null) ?? null,
    handCount: row.hand_count === undefined ? hands : Number(row.hand_count),
  };
}

export function handFromRow(row: Row): HandRecord {
  const result = readVersioned<GameState['result']>(row.result as string | null, `副 ${row.hand_id} 的结算`);
  if (result !== null && !isRecord(result)) throw new HistoryProtocolError(`副 ${row.hand_id} 的结算格式非法`);
  return {
    handId: String(row.hand_id),
    matchId: String(row.match_id),
    handIndex: Number(row.hand_index),
    startSnapshot: readHistorySnapshot(readVersioned<Record<string, unknown>>(row.start_snapshot as string, `副 ${row.hand_id} 的起点快照`)),
    startedAt: Number(row.started_at),
    endedAt: row.ended_at === null || row.ended_at === undefined ? null : Number(row.ended_at),
    declarer: row.declarer === null || row.declarer === undefined ? null : Number(row.declarer),
    bid: row.bid === null || row.bid === undefined ? null : Number(row.bid),
    trump: suitOrNull(row.trump),
    result,
    unplayedPoints: row.unplayed_points === null || row.unplayed_points === undefined ? null : Number(row.unplayed_points),
  };
}

export function branchFromRow(row: Row): BranchRecord {
  return {
    branchId: String(row.branch_id),
    handId: String(row.hand_id),
    sourceNodeId: (row.source_node_id as string | null) ?? null,
    name: String(row.name),
    tipNodeId: (row.tip_node_id as string | null) ?? null,
    kind: String(row.kind) as BranchKind,
    createdAt: Number(row.created_at),
    nodeCount: row.node_count === undefined ? undefined : Number(row.node_count),
  };
}

export function nodeFromRow(row: Row): ActionNodeRecord {
  const snapshot = decodeNodeState(row.state as string);
  const digest = String(row.state_digest);
  // 读回时用与写入完全相同的函数重算指纹：文件被外部改写会立即被发现。
  if (digest !== nodeStateDigest(snapshot)) {
    throw new HistoryProtocolError(`节点 ${row.node_id} 的局面指纹与内容不一致（历史可能被外部修改）`);
  }
  return {
    nodeId: String(row.node_id),
    branchId: String(row.branch_id),
    parentId: (row.parent_id as string | null) ?? null,
    seq: Number(row.seq),
    command: commandValue(JSON.parse(String(row.command))),
    source: String(row.source) as NodeSource,
    state: snapshot,
    stateDigest: digest,
    checkpointId: (row.checkpoint_id as string | null) ?? null,
    createdAt: Number(row.created_at),
  };
}

export function evaluationFromRow(row: Row): EvaluationRecord {
  return {
    evaluationId: String(row.evaluation_id),
    appliedNodeId: row.applied_node_id as string | null,
    nodeId: String(row.node_id),
    requestId: String(row.request_id),
    sessionId: String(row.session_id),
    seat: Number(row.seat),
    phase: String(row.phase) as EvaluationInput['phase'],
    purpose: (row.purpose as EvaluationInput['purpose']) ?? undefined,
    observation: readVersioned<EvaluationInput['observation']>(String(row.observation), '评估观察')!,
    observationPoint: row.observation_point as EvaluationInput['observationPoint'],
    candidates: readVersioned(row.candidates as string | null, '评估候选'),
    recommended: readVersioned(row.recommended as string | null, '评估推荐'),
    status: String(row.status) as EvaluationStatus,
    latencyMs: Number(row.latency_ms),
    profileVersionId: (row.profile_version_id as string | null) ?? null,
    modelName: (row.model_name as string | null) ?? null,
    engineType: (row.engine_type as string | null) ?? null,
    fallbackReason: (row.fallback_reason as string | null) ?? null,
    errorDetails: (row.error_details as string | null) ?? null,
    createdAt: Number(row.created_at),
  };
}

export function profileVersionFromRow(row: Row): ProfileVersionRecord {
  return {
    profileVersionId: String(row.profile_version_id),
    profileId: String(row.profile_id),
    version: String(row.version),
    configHash: String(row.config_hash),
    type: String(row.type),
    name: String(row.name),
    parameters: readVersioned<Record<string, unknown>>(String(row.parameters), '配置参数')!,
    implementationVersion: (row.implementation_version as string | null) ?? null,
    createdAt: Number(row.created_at),
  };
}

export function assignmentFromRow(row: Row): SeatAssignmentRecord {
  return {
    assignmentId: String(row.assignment_id),
    handId: String(row.hand_id),
    branchId: String(row.branch_id),
    nodeId: (row.node_id as string | null) ?? null,
    seat: Number(row.seat),
    kind: String(row.kind) as SeatAssignmentRecord['kind'],
    profileVersionId: (row.profile_version_id as string | null) ?? null,
    createdAt: Number(row.created_at),
  };
}
