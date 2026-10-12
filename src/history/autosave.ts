/** 自动存档编排（SRP / DIP）：同步捕获合法提交，无界顺序队列在事务确认后报告保存。 */
import { GameSession, type SessionCommit } from '../workbench/session';
import { HISTORY_PROTOCOL_VERSION, type ProfileVersionInput, type SeatAssignmentInput, type EvaluationRecord } from './contracts';
import { newHistoryId } from './ids';
import { type HistoryWrite, type HandDetail, resumableState, encodeWrite, decodeWrite } from './transport';

export interface HistoryConfiguration {
  profiles: ProfileVersionInput[];
  seats: Pick<SeatAssignmentInput, 'seat' | 'kind' | 'profileVersionId'>[];
}
export interface SaveState { status: 'saving' | 'saved' | 'error' | 'unsupported'; pending: number; error?: string }
interface Position { matchId: string; handId: string; branchId: string; nodeId: string | null; seq: number; handIndex: number; actual: boolean }
interface Options {
  write: (packet: HistoryWrite) => Promise<void>;
  configuration: () => HistoryConfiguration;
  source?: 'human' | 'bench' | 'import';
  journal?: Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;
}
const JOURNAL_KEY = 'baoshan_history_pending_v2';
export class HistoryRecorder {
  private queue: HistoryWrite[] = [];
  private running: Promise<void> | null = null;
  private listeners = new Set<() => void>();
  private state: SaveState = { status: 'saved', pending: 0 };
  private positions = new Map<string, Position>();
  private tips = new Map<string, string | null>();
  private runtimeSession = '';
  private position!: Position;
  private unsubscribers: (() => void)[];
  private evaluations = new Map<string, { runtimeNode: string; record: Omit<EvaluationRecord, 'nodeId'>; epoch: number }>();
  private restoring = false;
  private corruptJournal: string | null = null;
  private completedMatches = new Set<string>();
  constructor(private session: GameSession, private options: Options) {
    try {
      const pending = options.journal?.getItem(JOURNAL_KEY);
      if (pending) this.queue = (JSON.parse(pending) as unknown[]).map(decodeWrite);
    } catch { this.corruptJournal = options.journal?.getItem(JOURNAL_KEY) ?? ''; this.state = { status: 'error', pending: 0, error: '待保存记录损坏，原文已保留，请导出记录排查' }; session.setMode('paused'); }
    this.unsubscribers = [session.subscribeCommits(event => this.capture(event)), session.subscribe(() => {
      queueMicrotask(() => this.invalidateEvaluations());
      if (!this.restoring && this.runtimeSession !== session.getSnapshot().cursor.sessionId) this.start();
    })];
    this.start();
  }
  subscribe = (listener: () => void) => { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; };
  getSnapshot = () => this.state;
  private publish(status: SaveState['status'], error?: string) {
    this.state = { status, pending: this.queue.length, error }; this.listeners.forEach(listener => listener());
  }
  private journal() {
    if (!this.options.journal || this.corruptJournal !== null) return;
    if (this.queue.length) this.options.journal.setItem(JOURNAL_KEY, `[${this.queue.map(encodeWrite).join(',')}]`);
    else this.options.journal.removeItem(JOURNAL_KEY);
  }
  private enqueue(packet: Omit<HistoryWrite, 'protocolVersion'>) {
    // 克隆动作与快照；调用方后续修改不改变已排队事实。
    this.queue.push(decodeWrite(JSON.parse(encodeWrite({ ...packet, protocolVersion: HISTORY_PROTOCOL_VERSION }))));
    try { this.journal(); } catch { this.fail('浏览器待保存记录写入失败，请重试'); return; }
    if (this.state.status !== 'error') { this.publish('saving'); void this.flush(); }
  }
  private fail(message: string) { this.publish('error', message); this.session.setMode('paused'); }
  async flush(): Promise<void> {
    if (this.running) return this.running;
    if (this.state.status === 'error') return;
    this.running = Promise.resolve().then(async () => {
      while (this.queue.length) {
        const packet = this.queue[0];
        try {
          await this.options.write(packet);
          this.queue.shift(); this.journal();
        } catch { this.fail('未保存：历史服务写入失败，已暂停自动推进；请重试保存'); return; }
      }
      this.publish('saved');
    }).finally(() => { this.running = null; });
    return this.running;
  }
  async retry() {
    if (this.corruptJournal !== null && this.options.journal?.getItem(JOURNAL_KEY) !== null) { this.fail('待保存记录损坏，原文已保留，请先导出记录排查'); return; }
    this.corruptJournal = null;
    if (this.running) await this.running; this.publish('saving'); try { this.journal(); } catch { this.fail('浏览器待保存记录写入失败，请重试'); return; } await this.flush(); }
  private assignments(position: Position, configuration: HistoryConfiguration, at: number): SeatAssignmentInput[] {
    return configuration.seats.map(seat => ({ ...seat, assignmentId: newHistoryId('assignment'), handId: position.handId, branchId: position.branchId, nodeId: position.nodeId, createdAt: at }));
  }
  private start() {
    const { game, cursor } = this.session.getSnapshot(); const at = Date.now();
    if (this.runtimeSession && this.position && !this.completedMatches.has(this.position.matchId)) this.enqueue({ status: { matchId: this.position.matchId, status: 'abandoned', endedAt: at } });
    this.runtimeSession = cursor.sessionId;
    this.positions.clear(); this.tips.clear();
    this.position = { matchId: newHistoryId('match'), handId: newHistoryId('hand'), branchId: newHistoryId('branch'), nodeId: null, seq: -1, handIndex: 0, actual: true };
    this.positions.set(cursor.nodeId, this.position); this.tips.set(this.position.branchId, null);
    const config = this.options.configuration();
    if (game.phase === 'matchEnd') this.completedMatches.add(this.position.matchId);
    this.enqueue({ match: { matchId: this.position.matchId, source: this.options.source ?? 'human', targetWins: game.targetWins, startedAt: at, ...(game.phase === 'matchEnd' ? { status:'completed' as const, endedAt:at } : {}), appVersion: '0.1.0', implementationVersion: 'history-v2' },
      hand: { handId: this.position.handId, matchId: this.position.matchId, handIndex: 0, startSnapshot: game, startedAt: at, declarer:game.declarer, bid:game.highestBid || null, trump:game.trump, ...(game.result ? { result:game.result, endedAt:at, unplayedPoints:game.result.unplayedPoints ?? 0 } : {}) },
      branch: { branchId: this.position.branchId, handId: this.position.handId, name: '实际对局', kind: 'actual', createdAt: at },
      profiles: config.profiles, assignments: this.assignments(this.position, config, at) });
  }
  private capture(event: SessionCommit) {
    const origin = this.positions.get(event.from.nodeId);
    if (!origin) { this.fail('历史起点未关联，请先重开或恢复已保存对局'); return; }
    const at = Date.now(); const config = this.options.configuration();
    let parent = origin;
    let branch: HistoryWrite['branch'];
    if (this.tips.get(origin.branchId) !== origin.nodeId) {
      parent = { ...origin, branchId: newHistoryId('branch'), actual: false };
      branch = { branchId: parent.branchId, handId: parent.handId, sourceNodeId: origin.nodeId, name: '接管路径', kind: 'branch', createdAt: at };
    }
    const nodeId = newHistoryId('node');
    const target = { ...parent, nodeId, seq: parent.seq + 1 };
    // 新分支先建立再提交；由 recordCommit 的原子分支入口完成。
    const packet: Omit<HistoryWrite, 'protocolVersion'> = { profiles: config.profiles, commit: {
      matchId: parent.matchId, node: { nodeId, branchId: origin.branchId, parentId: parent.nodeId, seq: target.seq, command: event.command, source: event.source, state: event.after, createdAt: at, checkpoint: target.seq % 20 === 0 },
      ...(branch ? { branchId: parent.branchId, sourceNodeId: parent.nodeId, branchName: branch.name, branchKind: 'branch' as const } : {}),
      seatAssignments: this.assignments(target, config, at),
      ...(parent.actual && event.after.result && event.command.kind !== 'nextHand' ? { handSummary: { endedAt: at, declarer: event.after.declarer, bid: event.after.highestBid, trump: event.after.trump, result: event.after.result, unplayedPoints: event.after.result.unplayedPoints ?? 0 } } : {}),
    } };
    if (event.requestId) {
      const entry = this.evaluations.get(event.requestId);
      if (entry) {
        packet.evaluationStatuses = [{ evaluationId: entry.record.evaluationId, status: 'applied', appliedNodeId: nodeId }];
        this.evaluations.delete(event.requestId);
      }
    }
    this.position = target; this.tips.set(target.branchId, target.nodeId);
    if (event.command.kind === 'nextHand') {
      this.position = { ...target, handId: newHistoryId('hand'), branchId: newHistoryId('branch'), handIndex: target.handIndex + 1, seq: -1, nodeId: null, actual: true };
      packet.hand = { handId: this.position.handId, matchId: target.matchId, handIndex: this.position.handIndex, startSnapshot: event.after, startedAt: at };
      packet.branch = { branchId: this.position.branchId, handId: this.position.handId, name: '实际对局', kind: 'actual', createdAt: at };
      packet.assignments = this.assignments(this.position, config, at);
      this.tips.set(this.position.branchId, null);
    }
    if (event.after.phase === 'matchEnd' && parent.actual) {
      packet.status = { matchId: target.matchId, status: 'completed', endedAt: at }; this.completedMatches.add(target.matchId);
    }
    this.positions.set(event.to.nodeId, this.position); this.enqueue(packet);
  }
  configurationChanged() {
    const position = this.positions.get(this.session.getSnapshot().cursor.nodeId);
    if (!position) return;
    const config = this.options.configuration(); this.enqueue({ profiles: config.profiles, assignments: this.assignments(position, config, Date.now()) });
  }
  recordEvaluation(runtimeNode: string, record: Omit<EvaluationRecord, 'nodeId'>) {
    const position = this.positions.get(runtimeNode); if (!position || this.evaluations.has(record.requestId)) return;
    this.evaluations.set(record.requestId, { runtimeNode, record, epoch: this.session.getSnapshot().cursor.epoch });
    this.enqueue({ profiles: this.options.configuration().profiles, evaluations: [{ ...record, nodeId: position.nodeId ?? `root:${position.branchId}`, observationPoint: 'after' }] });
  }
  private invalidateEvaluations() {
    const cursor = this.session.getSnapshot().cursor;
    const updates: NonNullable<HistoryWrite['evaluationStatuses']> = [];
    for (const [id, entry] of this.evaluations) {
      if (entry.runtimeNode !== cursor.nodeId || entry.epoch !== cursor.epoch) {
        updates.push({ evaluationId: entry.record.evaluationId, status: 'stale' }); this.evaluations.delete(id);
      }
    }
    if (updates.length) this.enqueue({ evaluationStatuses: updates });
  }
  /** 校验在调用前完成；恢复原持久身份并暂停，不重复创建或覆盖历史。 */
  resume(detail: HandDetail) {
    const { state, branch } = resumableState(detail);
    const lastHand = detail.hand;
    if (detail.match.matchId !== this.position.matchId) this.enqueue({ status: { matchId: this.position.matchId, status: 'abandoned', endedAt: Date.now() } });
    this.restoring = true;
    try { this.session.replace(state); } finally { this.restoring = false; }
    this.runtimeSession = this.session.getSnapshot().cursor.sessionId;
    const node = detail.nodes.find(value => value.nodeId === branch.tipNodeId);
    this.position = { matchId: detail.match.matchId, handId: lastHand.handId, branchId: branch.branchId, nodeId: branch.tipNodeId, seq: node?.seq ?? -1, handIndex: lastHand.handIndex, actual: true };
    this.positions.clear(); this.positions.set(this.session.getSnapshot().cursor.nodeId, this.position); this.tips.set(branch.branchId, branch.tipNodeId);
  }
  exportPending(): string {
    return JSON.stringify({ format: 'pending-game-history', protocolVersion: HISTORY_PROTOCOL_VERSION,
      corruptJournal: this.corruptJournal, packets: this.queue.map(packet => JSON.parse(encodeWrite(packet))) }, null, 2);
  }
  dispose() { this.unsubscribers.forEach(unsubscribe => unsubscribe()); }
}
