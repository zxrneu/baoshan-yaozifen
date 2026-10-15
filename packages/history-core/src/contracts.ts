/** 历史仓储端口（DIP）：领域记录复用协议包，存储实现由 Node 应用注入。 */
export * from "@yaozifen/protocol/contracts";
import type { ActionNodeInput, ActionNodeRecord, BranchRecord, BranchRecordInput, EvaluationInput, EvaluationRecord, EvaluationStatus, HandRecord, HandRecordInput, HandSummaryPatch, HistoryCommitInput, HistoryCommitResult, MatchQuery, MatchRecord, MatchRecordInput, MatchStatus, ProfileVersionInput, ProfileVersionRecord, SeatAssignmentInput, SeatAssignmentRecord } from "@yaozifen/protocol/contracts";

/** Repository 对上层暴露的唯一契约；SQL 与驱动锁在实现内部。 */
export interface HistoryRepository {
  writeHistory(packet: import('@yaozifen/history-core/transport').HistoryWrite): void;
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

  saveSimulationRun(run: import('@yaozifen/history-core/simulation').SimulationRun): void;
  getSimulationRun(runId: string): import('@yaozifen/history-core/simulation').SimulationRun | null;
  listSimulationRuns(): import('@yaozifen/history-core/simulation').SimulationRun[];
  saveSimulationBoard(board: import('@yaozifen/history-core/simulation').SimulationBoard): void;
  listSimulationBoards(runId: string): import('@yaozifen/history-core/simulation').SimulationBoard[];

  schemaVersion(): number;
  integrityCheck(): { foreignKeyViolations: string[]; orphanNodes: number; digestMismatches: number };
  backup(destination: string): void;
  backupAsync(destination: string): Promise<string>;
  close(): void;
}
