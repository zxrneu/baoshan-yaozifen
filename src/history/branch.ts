/** 历史分支会话（SRP / DIP）：事务确认后推进独立游标，取消令迟到请求失效，原路径只读。 */
import { currentSeat, nextHand, type GameState } from '../engine';
import { applyAiAction } from '../ai/applyAction';
import { BridgeEngine } from '../ai/bridge/bridgeEngine';
import { EnginePlayerAgent } from '../ai/engines/engineAdapter';
import { DecisionLogger } from '../ai/engines/decisionLogger';
import { ThinkingService } from '../ai/engines/thinkingService';
import type { DecisionEngine } from '../ai/engines/engineTypes';
import type { SessionCommand } from '../workbench/session';
import { cloneGameState } from '../workbench/snapshot';
import { type HistoryWrite, type HandDetail, encodeWrite } from './transport';
import { validatedReplay } from './replay';
import type { HistoryConfiguration } from './autosave';
import type { ActionNodeRecord, BranchRecord, EvaluationRecord, ProfileVersionRecord } from './contracts';
import { HISTORY_PROTOCOL_VERSION } from './contracts';
import { actionNodeDigest, commandValue } from './commands';
import { newHistoryId, derivedHistoryId } from './ids';
import { captureEvaluation } from './capture';

export interface BranchOptions {
  write: (packet: HistoryWrite) => Promise<void>;
  configuration: HistoryConfiguration;
  name?: string;
  reload?: () => Promise<HandDetail>;
}
interface PendingSave { packet:HistoryWrite; node:ActionNodeRecord; branch:BranchRecord }
export class HistoryBranch {
  private detail: HandDetail;
  private state: GameState;
  private parentId: string | null;
  private seq: number;
  private originBranchId: string;
  private branch: BranchRecord;
  private configuration: HistoryConfiguration;
  private revision = 0;
  private controller: AbortController | null = null;
  private thinking = new ThinkingService();
  private pending: PendingSave | null = null;
  private saving = false;
  private needsReload = false;
  private evaluating = false;
  constructor(detail: HandDetail, sourceNodeId: string | null, private options: BranchOptions) {
    this.detail = validatedReplay(detail);
    const node = sourceNodeId ? this.detail.nodes.find(value => value.nodeId === sourceNodeId) : null;
    if (sourceNodeId && !node) throw new Error('分支来源节点不存在');
    this.state = cloneGameState(node?.state ?? this.detail.hand.startSnapshot);
    this.parentId = sourceNodeId; this.seq = node?.seq ?? -1;
    this.originBranchId = node?.branchId ?? this.detail.branches.find(value => value.kind === 'actual')!.branchId;
    this.branch = { branchId:newHistoryId('branch'), handId:detail.hand.handId, sourceNodeId,
      name:options.name?.trim() || '反事实分支', kind:'branch', tipNodeId:null, createdAt:Date.now() };
    this.configuration = structuredClone(options.configuration);
  }
  private assertReady() { if (this.pending || this.saving || this.evaluating || this.needsReload) throw new Error('请等待当前请求完成或重试未保存分支'); }
  async apply(command: SessionCommand): Promise<void> {
    this.assertReady(); this.cancel();
    await this.submit(command, 'manual');
  }
  private async submit(command: SessionCommand, source: 'manual' | 'ai', evaluation?: Omit<EvaluationRecord,'nodeId'>) {
    command = commandValue(command);
    if (command.kind === 'nextHand' && this.state.phase !== 'handEnd') throw new Error('只能从副结算进入下一副');
    const after = command.kind === 'nextHand' ? nextHand(this.state) : applyAiAction(this.state, command);
    if (after === this.state) throw new Error('动作没有改变局面');
    const at=Date.now(); const nodeId=newHistoryId('node'); const first=!this.detail.branches.some(value => value.branchId === this.branch.branchId);
    const node:ActionNodeRecord={nodeId,branchId:this.branch.branchId,parentId:this.parentId,seq:this.seq+1,command,source,state:cloneGameState(after),createdAt:at,stateDigest:actionNodeDigest({state:after}),checkpointId:null};
    const branch={...this.branch,tipNodeId:nodeId};
    const profiles = structuredClone(this.configuration.profiles);
    const packet:HistoryWrite={protocolVersion:HISTORY_PROTOCOL_VERSION,profiles,commit:{matchId:this.detail.match.matchId,
      node:{...node,branchId:first ? this.originBranchId : branch.branchId},
      ...(first ? {branchId:branch.branchId,sourceNodeId:branch.sourceNodeId,branchName:branch.name,branchKind:'branch' as const} : {}),
      seatAssignments:this.configuration.seats.map(seat=>({...seat,assignmentId:newHistoryId('assignment'),handId:branch.handId,branchId:branch.branchId,nodeId,createdAt:at})),
      ...(evaluation ? {evaluation:{...evaluation,nodeId,observationPoint:'before',status:'applied',appliedNodeId:nodeId}} : {}) }};
    this.pending={packet,node,branch}; await this.retry();
  }
  async retry(): Promise<void> {
    if (this.saving) throw new Error('分支正在保存');
    if (!this.pending) { if(this.needsReload) await this.reload(); return; }
    const pending=this.pending; this.saving=true;
    try {
      await this.options.write(pending.packet);
      this.detail.nodes.push(pending.node);
      const position=this.detail.branches.findIndex(value=>value.branchId===pending.branch.branchId);
      if(position<0) this.detail.branches.push(pending.branch); else this.detail.branches[position]=pending.branch;
      for(const profile of pending.packet.profiles ?? []) if(profile.profileVersionId && !this.detail.profiles.some(value=>value.profileVersionId===profile.profileVersionId)) this.detail.profiles.push(profile as ProfileVersionRecord);
      this.detail.assignments.push(...(pending.packet.commit?.seatAssignments ?? []).map(value=>({...value,assignmentId:value.assignmentId!})));
      if(pending.packet.commit?.evaluation) this.detail.evaluations.push(pending.packet.commit.evaluation as EvaluationRecord);
      this.state=pending.node.state; this.parentId=pending.node.nodeId; this.seq=pending.node.seq; this.branch=pending.branch; this.pending=null;
      if(this.options.reload) { this.needsReload=true; await this.reload(); }
    } finally { this.saving=false; }
  }
  private async reload() {
    if(!this.options.reload) return;
    const detail=validatedReplay(await this.options.reload());
    if(detail.hand.handId!==this.detail.hand.handId || detail.match.matchId!==this.detail.match.matchId || detail.branches.find(branch=>branch.branchId===this.branch.branchId)?.tipNodeId!==this.parentId) throw new Error('保存后的详情尚未同步当前分支节点');
    this.detail=detail; this.needsReload=false;
  }
  async step(engine: DecisionEngine): Promise<boolean> {
    this.assertReady(); if(currentSeat(this.state)<0) return false;
    const revision=this.revision; const controller=new AbortController(); this.controller=controller; this.evaluating=true;
    const logger=new DecisionLogger();
    const agent=new EnginePlayerAgent({engine,fallbackEngine:new BridgeEngine(),logger,thinkingService:this.thinking});
    const context={sessionId:this.branch.branchId,nodeId:this.parentId ?? `root:${this.branch.branchId}`,epoch:revision,configRevision:revision,requestId:newHistoryId('evaluation'),purpose:'step' as const};
    try {
      const action=await agent.nextActionAsync(cloneGameState(this.state),controller.signal,context);
      if(controller.signal.aborted || revision!==this.revision || !action) return false;
      const record=logger.getRecords().at(-1);
      const profile=this.configuration.profiles.find(value=>record?.actualProfile ? value.profileVersionId===derivedHistoryId('profileVersion',record.actualProfile.version) : value.type===record?.engineType);
      const evaluation=record ? captureEvaluation(record,this.state,profile?.profileVersionId) : null;
      await this.submit(action,'ai',evaluation ?? undefined); return true;
    } catch(error) {
      if(controller.signal.aborted || revision!==this.revision) return false;
      throw error;
    } finally { if(this.controller===controller) this.controller=null; this.evaluating=false; this.thinking.clear(); }
  }
  configurationChanged(configuration: HistoryConfiguration): void { this.cancel(); this.configuration=structuredClone(configuration); }
  cancel(): void { this.revision++; this.controller?.abort(new DOMException('复盘节点或配置已改变','AbortError')); this.thinking.clear(); }
  getDetail(): HandDetail { if(this.needsReload) throw new Error('实际配置详情尚未同步'); return validatedReplay(this.detail); }
  getState(): GameState { return cloneGameState(this.state); }
  getNodeId(): string | null { return this.parentId; }
  getBranchId(): string { return this.branch.branchId; }
  hasUnsyncedDetail(): boolean { return this.needsReload; }
  hasPendingSave(): boolean { return this.pending !== null; }
  exportPending(): string { return this.pending ? encodeWrite(this.pending.packet) : ''; }
}
