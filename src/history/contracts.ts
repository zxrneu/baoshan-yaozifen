/** 版本化历史契约（ISP / DIP）：浏览器与服务端共用类型，不依赖 SQL、UI 或网络。 */
import type { Suit } from '../cards';
import type { GameState, Phase } from '../engine';
import type { DecisionContext } from '../ai/types';
import type { SessionCommand } from '../workbench/session';
import type { DecisionObservation } from '../ai/decisionObservation';

/** 历史协议版本：JSON 字段语义变化时递增；SQL schema 独立管理，旧版本显式拒绝而不是静默重算。 */
export const HISTORY_PROTOCOL_VERSION = 2;
/** 规则集标识：目前只有基础规则 basic-v1。 */
export const RULE_SET_ID = 'basic-v1';
/** 规则实现版本：规则语义变化（例如结算阈值）时递增。 */
export const RULE_VERSION = 1;

export type MatchStatus = 'in_progress' | 'completed' | 'abandoned' | 'failed';
export type MatchSource = 'human' | 'ai' | 'bench' | 'simulation' | 'import';
export type BranchKind = 'actual' | 'branch';
export type NodeSource = 'human' | 'manual' | 'ai' | 'hint';
export type EvaluationStatus = 'evaluated' | 'applied' | 'stale';
export type SeatAssignmentKind = 'human' | 'ai';
export type SimulationStatus = 'pending' | 'running' | 'completed' | 'cancelled' | 'failed';

export const MATCH_STATUSES: readonly MatchStatus[] = ['in_progress', 'completed', 'abandoned', 'failed'];
export const MATCH_SOURCES: readonly MatchSource[] = ['human', 'ai', 'bench', 'simulation', 'import'];
export const BRANCH_KINDS: readonly BranchKind[] = ['actual', 'branch'];
export const NODE_SOURCES: readonly NodeSource[] = ['human', 'manual', 'ai', 'hint'];
export const EVALUATION_STATUSES: readonly EvaluationStatus[] = ['evaluated', 'applied', 'stale'];
export const SEAT_ASSIGNMENT_KINDS: readonly SeatAssignmentKind[] = ['human', 'ai'];
export const SIMULATION_STATUSES: readonly SimulationStatus[] = ['pending', 'running', 'completed', 'cancelled', 'failed'];

/** 规则配置中与历史兼容性相关的字段：不匹配即拒绝，避免按当前实现静默重算旧局。 */
export const RULE_MATCH_KEYS = ['minBid', 'bidStep', 'maxBid', 'kittySize', 'handSize'] as const;

/** 版本化 JSON 列：未知或不兼容版本显式报错；安全转换由存储迁移负责。 */
export interface Versioned<T> {
  readonly v: number;
  readonly data: T;
}

export const versioned = <T>(data: T, v = HISTORY_PROTOCOL_VERSION): Versioned<T> => ({ v, data });

// ---------------------------------------------------------------------------
// 写入输入（P0.2 从 GameSession 提交边界构造这些输入）
// ---------------------------------------------------------------------------

export interface MatchRecordInput {
  /** 外部稳定 ID（不能直接用进程内会话序号）；缺省时随机生成，调用方重试应复用已取得的 ID。 */
  matchId?: string;
  startedAt: number;
  endedAt?: number | null;
  source: MatchSource;
  status?: MatchStatus;
  targetWins: number;
  appVersion?: string;
  implementationVersion?: string;
}

export interface HandRecordInput {
  handId?: string;
  matchId: string;
  handIndex: number;
  /** 本副起点完整快照（默认留档 seed，供逐字节重放）。 */
  startSnapshot: GameState;
  startedAt: number;
  endedAt?: number | null;
  declarer?: number | null;
  bid?: number | null;
  trump?: Suit | null;
  result?: GameState['result'];
  unplayedPoints?: number | null;
}

export interface BranchRecordInput {
  branchId?: string;
  handId: string;
  /** 分支起点节点；默认分支（原始路径）为 null。 */
  sourceNodeId?: string | null;
  name: string;
  kind?: BranchKind;
  createdAt: number;
}

export interface ActionNodeInput {
  nodeId?: string;
  branchId: string;
  parentId?: string | null;
  seq: number;
  command: SessionCommand;
  source: NodeSource;
  /** 提交后的完整可执行局面；存储保留私有 seed 与 history，不得直接传给 AI。 */
  state: GameState;
  createdAt: number;
  /** 校验用的持久化局面摘要（包含 seed 与 history）；不是节点身份或 AI 观察指纹。 */
  digest?: string;
  checkpoint?: boolean;
}

export interface EvaluationInput {
  evaluationId?: string;
  nodeId: string;
  requestId: string;
  sessionId: string;
  seat: number;
  phase: Phase;
  purpose: DecisionContext['purpose'];
  /** 当时传给引擎的阶段观察（已脱敏投影），不得包含其他座位暗牌或 seed。 */
  observation: DecisionObservation;
  /** 默认 after：在节点局面评估；before 用于将提交前评估附到已执行动作节点。 */
  observationPoint?: 'before' | 'after';
  candidates: unknown;
  recommended: unknown;
  status: EvaluationStatus;
  /** 已采用评估指向真正执行后的持久节点，未采用时为空。 */
  appliedNodeId?: string | null;
  latencyMs: number;
  profileVersionId?: string | null;
  modelName?: string | null;
  engineType?: string | null;
  fallbackReason?: string | null;
  errorDetails?: string | null;
  createdAt: number;
}

export interface ProfileVersionInput {
  profileVersionId?: string;
  profileId: string;
  version: string;
  configHash: string;
  type: string;
  name: string;
  /** 脱敏参数：不得包含 apiKey、完整凭据或网络认证信息。 */
  parameters: Record<string, unknown>;
  implementationVersion?: string | null;
  createdAt: number;
}

export interface SeatAssignmentInput {
  assignmentId?: string;
  handId: string;
  branchId: string;
  /** 配置变更所在节点；开局为 null。 */
  nodeId?: string | null;
  seat: number;
  kind: SeatAssignmentKind;
  profileVersionId?: string | null;
  createdAt: number;
}

/** 一次提交边界内需要原子写入的全部内容。 */
export interface HistoryCommitInput {
  matchId: string;
  node: ActionNodeInput;
  /** 更新分支游标；缺省用 node.branchId。 */
  branchId?: string;
  sourceNodeId?: string | null;
  branchName?: string;
  branchKind?: BranchKind;
  nodeId?: string;
  /** 提交时若正好结束一副牌，则同事务写入结算摘要。 */
  handSummary?: HandSummaryPatch;
  evaluation?: EvaluationInput;
  /** 提交后各座位的实际配置版本；仅在有变化时需要重记。 */
  seatAssignments?: SeatAssignmentInput[];
}

/** 历史表 HandResult 字段白名单：副结算的持久化列必须与规则结果保持一致。 */
export const HAND_RESULT_KEYS = ['bid', 'declarer', 'trump', 'declarerPoints', 'defenderPoints', 'buriedPoints', 'success', 'winnerSide'] as const;

export interface HandSummaryPatch {
  endedAt: number;
  declarer: number | null;
  bid: number | null;
  trump: Suit | null;
  result: GameState['result'];
  unplayedPoints: number | null;
}

// ---------------------------------------------------------------------------
// 记录（读取结果）
// ---------------------------------------------------------------------------

export interface MatchRecord {
  matchId: string;
  startedAt: number;
  endedAt: number | null;
  source: MatchSource;
  status: MatchStatus;
  targetWins: number;
  ruleSetId: string;
  ruleVersion: number;
  appVersion: string | null;
  implementationVersion: string | null;
  handCount?: number;
}

export interface HandRecord {
  handId: string;
  matchId: string;
  handIndex: number;
  startSnapshot: GameState;
  startedAt: number;
  endedAt: number | null;
  declarer: number | null;
  bid: number | null;
  trump: Suit | null;
  result: GameState['result'];
  unplayedPoints: number | null;
}

export interface BranchRecord {
  branchId: string;
  handId: string;
  sourceNodeId: string | null;
  name: string;
  tipNodeId: string | null;
  kind: BranchKind;
  createdAt: number;
  nodeCount?: number;
}

export interface ActionNodeRecord {
  nodeId: string;
  branchId: string;
  parentId: string | null;
  seq: number;
  command: SessionCommand;
  source: NodeSource;
  state: GameState;
  stateDigest: string;
  checkpointId: string | null;
  createdAt: number;
}

export interface EvaluationRecord extends EvaluationInput {
  evaluationId: string;
}

export interface ProfileVersionRecord extends ProfileVersionInput {
  profileVersionId: string;
}

export interface SeatAssignmentRecord extends SeatAssignmentInput {
  assignmentId: string;
}

export interface HistoryCommitResult {
  nodeId: string;
  branchId: string;
  /** 重复提交同一节点时为 true（幂等命中，不是错误）。 */
  duplicated: boolean;
}

export interface MatchQuery {
  status?: MatchStatus; source?: MatchSource; limit?: number; offset?: number;
  from?: number; to?: number; engineType?: string; bid?: number;
}

/** Repository 对上层暴露的唯一契约；SQL 与驱动锁在实现内部。 */
export interface HistoryRepository {
  writeHistory(packet: import('./transport').HistoryWrite): void;
  createMatch(input: MatchRecordInput): MatchRecord;
  getMatch(matchId: string): MatchRecord | null;
  listMatches(query?: MatchQuery): MatchRecord[];
  updateMatchStatus(matchId: string, status: MatchStatus, endedAt?: number | null): void;

  createHand(input: HandRecordInput): HandRecord;
  getHand(handId: string): HandRecord | null;
  listHands(matchId: string): HandRecord[];
  updateHandSummary(handId: string, patch: HandSummaryPatch): void;

  createBranch(input: BranchRecordInput): BranchRecord;
  getBranch(branchId: string): BranchRecord | null;
  listBranches(handId: string): BranchRecord[];

  appendActionNode(input: ActionNodeInput): ActionNodeRecord;
  /** 幂等入口：一次事务写入节点、分支游标、结算摘要与评估。 */
  recordCommit(input: HistoryCommitInput): HistoryCommitResult;
  getActionNode(nodeId: string): ActionNodeRecord | null;
  listActionNodes(branchId: string): ActionNodeRecord[];

  recordEvaluation(input: EvaluationInput): EvaluationRecord;
  listEvaluations(nodeId: string): EvaluationRecord[];
  /** 请求序号只在持久节点内唯一，不能使用进程内 requestId 作全局主键。 */
  getEvaluationByRequest(nodeId: string, requestId: string): EvaluationRecord | null;
  updateEvaluationStatus(evaluationId: string, status: EvaluationStatus, appliedNodeId?: string): void;

  recordProfileVersion(input: ProfileVersionInput): ProfileVersionRecord;
  getProfileVersion(profileVersionId: string): ProfileVersionRecord | null;
  listProfileVersions(profileId: string): ProfileVersionRecord[];

  recordSeatAssignment(input: SeatAssignmentInput): SeatAssignmentRecord;
  listSeatAssignments(handId: string, branchId?: string): SeatAssignmentRecord[];

  schemaVersion(): number;
  integrityCheck(): { foreignKeyViolations: string[]; orphanNodes: number; digestMismatches: number };
  backup(destination: string): void;
  backupAsync(destination: string): Promise<string>;
  close(): void;
}
