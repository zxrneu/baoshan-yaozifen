/** 决策选择按单一职责筛选当前分支，在暂停使待执行记录失效前保存查看对象。 */
import type { DecisionRecord } from '../ai/engines/engineTypes';
import type { SessionCommit, SessionCursor } from '../workbench/session';
export function seatDecision(seat: number, cursor: SessionCursor, records: readonly DecisionRecord[], commits: readonly SessionCommit[]): DecisionRecord | undefined {
  const path = new Set([cursor.nodeId]);
  let node = cursor.nodeId;
  for (const commit of [...commits].reverse()) {
    if (commit.to.sessionId === cursor.sessionId && commit.to.nodeId === node) { node = commit.from.nodeId; path.add(node); }
  }
  return [...records].reverse().find(value => value.seat === seat && value.context?.sessionId === cursor.sessionId && (
    value.status === 'applied' && value.appliedNodeId && path.has(value.appliedNodeId) ||
    value.status === 'evaluated' && value.context.nodeId === cursor.nodeId && value.context.epoch === cursor.epoch && value.context.configRevision === cursor.configRevision
  ));
}
