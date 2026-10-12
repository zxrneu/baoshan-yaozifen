/** 历史 HTTP 信封与导出（SRP）：私有快照显式编码，完整校验后才能替换活动局。 */
import type { GameState } from '../engine';
import { nextHand } from '../engine';
import { applyAiAction } from '../ai/applyAction';
import type { ActionNodeRecord, BranchRecord, EvaluationRecord, HandRecord, HistoryCommitInput, MatchRecord, MatchRecordInput, HandRecordInput, BranchRecordInput, ProfileVersionInput, ProfileVersionRecord, SeatAssignmentInput, SeatAssignmentRecord, MatchStatus } from './contracts';
import { HISTORY_PROTOCOL_VERSION, RULE_SET_ID, RULE_VERSION } from './contracts';
import { contentDigest } from './json';
import { isRecord, HistoryProtocolError } from './errors';
import { readHistorySnapshot, sanitizeHistorySnapshot } from './snapshot';
import { commandValue, actionNodeDigest } from './commands';

export interface HistoryWrite {
  protocolVersion: number;
  match?: MatchRecordInput;
  hand?: HandRecordInput;
  branch?: BranchRecordInput;
  profiles?: ProfileVersionInput[];
  assignments?: SeatAssignmentInput[];
  commit?: HistoryCommitInput;
  evaluations?: EvaluationRecord[];
  evaluationStatuses?: { evaluationId: string; status: 'applied' | 'stale'; appliedNodeId?: string }[];
  status?: { matchId: string; status: MatchStatus; endedAt?: number };
}
export type HandListItem = Omit<HandRecord, 'startSnapshot'> & { seatNames?: string[] };
export interface HandDetail {
  match: MatchRecord;
  hand: HandRecord;
  branches: BranchRecord[];
  nodes: ActionNodeRecord[];
  evaluations: EvaluationRecord[];
  profiles: ProfileVersionRecord[];
  assignments: SeatAssignmentRecord[];
}
export function wireSnapshot(state: GameState) {
  return { protocolVersion: HISTORY_PROTOCOL_VERSION, ruleSetId: RULE_SET_ID, ruleVersion: RULE_VERSION, snapshot: sanitizeHistorySnapshot(state) };
}
export function encodeWrite(packet: HistoryWrite): string {
  return JSON.stringify({ ...packet,
    hand: packet.hand ? { ...packet.hand, startSnapshot: wireSnapshot(packet.hand.startSnapshot) } : undefined,
    commit: packet.commit ? { ...packet.commit, node: { ...packet.commit.node, state: wireSnapshot(packet.commit.node.state) } } : undefined });
}
/** 集中适配经过对象/协议校验的 DTO；领域字段仍由 Repository 校验。 */
export function decodeWrite(value: unknown): HistoryWrite {
  if (!isRecord(value) || value.protocolVersion !== HISTORY_PROTOCOL_VERSION) throw new HistoryProtocolError('历史写入协议版本不支持');
  const packet = value as unknown as HistoryWrite;
  if (packet.hand) packet.hand = { ...packet.hand, startSnapshot: readHistorySnapshot(packet.hand.startSnapshot) };
  if (packet.commit) packet.commit = { ...packet.commit, node: { ...packet.commit.node, state: readHistorySnapshot(packet.commit.node.state), command: commandValue(packet.commit.node.command) } };
  if (![packet.match, packet.hand, packet.branch, packet.commit, packet.status, packet.profiles, packet.assignments, packet.evaluations, packet.evaluationStatuses].some(Boolean)) throw new HistoryProtocolError('历史写入为空');
  return packet;
}
export function exportHand(detail: HandDetail): string {
  const data = { ...detail, hand: { ...detail.hand, startSnapshot: wireSnapshot(detail.hand.startSnapshot) },
    nodes: detail.nodes.map(node => ({ ...node, state: wireSnapshot(node.state) })) };
  return JSON.stringify({ format: 'game-history', protocolVersion: HISTORY_PROTOCOL_VERSION, data, digest: contentDigest(data) }, null, 2);
}
export function readHandDetail(json: string): HandDetail {
  const envelope: unknown = JSON.parse(json);
  if (!isRecord(envelope) || envelope.format !== 'game-history' || envelope.protocolVersion !== HISTORY_PROTOCOL_VERSION || !isRecord(envelope.data)) throw new HistoryProtocolError('历史导出格式或版本不支持');
  if (contentDigest(envelope.data) !== envelope.digest) throw new HistoryProtocolError('历史导出摘要不一致');
  const detail = envelope.data as unknown as HandDetail;
  if (!detail.match || detail.match.ruleSetId !== RULE_SET_ID || detail.match.ruleVersion !== RULE_VERSION || !detail.hand || !Array.isArray(detail.nodes) || !Array.isArray(detail.branches) || !Array.isArray(detail.profiles) || !Array.isArray(detail.assignments) || !Array.isArray(detail.evaluations)) throw new HistoryProtocolError('历史结构或规则版本不支持');
  if (detail.hand.matchId !== detail.match.matchId) throw new HistoryProtocolError('历史副归属错误');
  detail.hand = { ...detail.hand, startSnapshot: readHistorySnapshot(detail.hand.startSnapshot) };
  detail.nodes = detail.nodes.map(node => ({ ...node, command: commandValue(node.command), state: readHistorySnapshot(node.state) }));
  const byId = new Map(detail.nodes.map(node => [node.nodeId, node]));
  if (byId.size !== detail.nodes.length) throw new HistoryProtocolError('历史节点重复');
  for (const branch of detail.branches) {
    if (branch.handId !== detail.hand.handId) throw new HistoryProtocolError('历史分支归属错误');
    const nodes = detail.nodes.filter(node => node.branchId === branch.branchId).sort((a,b) => a.seq-b.seq);
    let parent = branch.sourceNodeId;
    let before = parent ? byId.get(parent)?.state : detail.hand.startSnapshot;
    let seq = parent ? (byId.get(parent)?.seq ?? -2) + 1 : 0;
    if (!before) throw new HistoryProtocolError('历史分支起点缺失');
    for (const node of nodes) {
      if (node.parentId !== parent || node.seq !== seq++) throw new HistoryProtocolError('历史路径断链');
      const after = node.command.kind === 'nextHand' ? nextHand(before) : applyAiAction(before, node.command);
      if (after === before || actionNodeDigest({ state: after }) !== node.stateDigest || actionNodeDigest({ state: node.state }) !== node.stateDigest) throw new HistoryProtocolError('历史动作与局面摘要不一致');
      before = node.state; parent = node.nodeId;
    }
    if (parent !== (branch.tipNodeId ?? branch.sourceNodeId)) throw new HistoryProtocolError('历史游标不一致');
  }
  if (detail.nodes.some(node => !detail.branches.some(branch => branch.branchId === node.branchId))) throw new HistoryProtocolError('历史节点分支缺失');
  return detail;
}
export function resumableState(detail: HandDetail): { state: GameState; branch: BranchRecord } {
  const branch = detail.branches.find(value => value.kind === 'actual');
  if (!branch || detail.match.status !== 'in_progress') throw new HistoryProtocolError('只能恢复进行中的实际对局');
  const state = branch.tipNodeId ? detail.nodes.find(node => node.nodeId === branch.tipNodeId)?.state : detail.hand.startSnapshot;
  if (!state || state.phase === 'matchEnd' || detail.hand.result) throw new HistoryProtocolError('本副已结束，不能恢复');
  return { state, branch };
}
