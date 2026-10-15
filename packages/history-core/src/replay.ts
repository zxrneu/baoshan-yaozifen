/** 只读复盘投影（SRP）：按父链还原保存动作，诊断按观察位置关联，不运行模型。 */
import { currentSeat, revealedPartnerSeat, type GameState, type Phase } from '@yaozifen/game-core';
import { observeDecision } from '@yaozifen/game-view/decisionObservation';
import { cloneGameState } from '@yaozifen/match-runtime/snapshot';
import type { ActionNodeRecord, EvaluationRecord } from '@yaozifen/protocol/contracts';
import { exportHand, readHandDetail, type HandDetail } from './transport';

export interface ReplayFrame { node: ActionNodeRecord | null; state: GameState }
export const PHASE_NAMES: Record<Phase, string> = { bidding:'叫分', trump:'定主', bury:'扣底', playing:'出牌', handEnd:'副结算', matchEnd:'整场结算' };
export function replayPath(detail: HandDetail, branchId: string): ReplayFrame[] {
  const branch = detail.branches.find(value => value.branchId === branchId);
  if (!branch) throw new Error('复盘路径不存在');
  const byId = new Map(detail.nodes.map(node => [node.nodeId, node]));
  const nodes: ActionNodeRecord[] = []; const seen = new Set<string>();
  let id = branch.tipNodeId ?? branch.sourceNodeId;
  while (id) {
    const node = byId.get(id);
    if (!node || seen.has(id)) throw new Error('复盘路径断链或循环');
    seen.add(id); nodes.unshift(node); id = node.parentId;
  }
  return [{ node:null, state:cloneGameState(detail.hand.startSnapshot) }, ...nodes.map(node => ({ node, state:cloneGameState(node.state) }))];
}
export function validatedReplay(detail: HandDetail): HandDetail { return readHandDetail(exportHand(detail)); }
/** 只把阶段合法观察用于座位视角；结算展示公开结果与本座手牌，不构造模型请求。 */
export function replayObservation(state: GameState, seat: number) {
  if (!Number.isInteger(seat) || seat < 0 || seat > 3) throw new Error('复盘座位非法');
  if (currentSeat(state) >= 0) return observeDecision(state, seat);
  const revealed = revealedPartnerSeat(state);
  return { phase:state.phase, seat, ownHand:state.hands[seat], handCounts:state.hands.map(hand => hand.length),
    completedRounds:state.completedTricks, result:state.result,
    ...(revealed === null ? {} : { revealedHand:{ seat:revealed, cards:state.hands[revealed] } }) };
}
export function evaluationsAt(detail: HandDetail, frame: ReplayFrame, seat: number, branchId: string): EvaluationRecord[] {
  const nodeId = frame.node?.nodeId ?? null;
  return detail.evaluations.filter(evaluation => {
    if (evaluation.seat !== seat) return false;
    if (evaluation.nodeId.startsWith('root:')) {
      const branch = detail.branches.find(value => `root:${value.branchId}` === evaluation.nodeId);
      return branch?.branchId === branchId && (branch.sourceNodeId ?? null) === nodeId;
    }
    const node = detail.nodes.find(value => value.nodeId === evaluation.nodeId);
    if (!node) return false;
    return (evaluation.observationPoint === 'before' ? node.parentId : node.nodeId) === nodeId;
  });
}
