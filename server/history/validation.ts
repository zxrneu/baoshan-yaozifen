/** 历史写入领域校验（SRP）：身份、结算与脱敏独立于 SQL，实现可复用的持久化边界。 */
import type { GameState } from '../../src/engine';
import { observeDecision } from '../../src/ai/decisionObservation';
import type { EvaluationInput, HandSummaryPatch } from '../../src/history/protocol';
import { canonicalJson, HistoryProtocolError, isRecord } from '../../src/history/protocol';

export function assertInteger(value: number, label: string, min = 0): void {
  if (!Number.isSafeInteger(value) || value < min) throw new HistoryProtocolError(`${label}必须是大于等于 ${min} 的整数`);
}

export function assertTimestamp(value: number, label = '时间戳'): number {
  assertInteger(value, label);
  return value;
}

export function assertSeat(seat: number): void {
  assertInteger(seat, '座位');
  if (seat > 3) throw new HistoryProtocolError('座位必须在 0..3');
}

export function assertHandSummary(patch: HandSummaryPatch, state: GameState, startedAt: number): void {
  assertTimestamp(patch.endedAt, '结算时间');
  if (patch.endedAt < startedAt) throw new HistoryProtocolError('结算时间不能早于副开始时间');
  if (!state.result || !['handEnd', 'matchEnd'].includes(state.phase)) throw new HistoryProtocolError('只有结束局面才能写入副结算');
  const actual = { declarer: patch.declarer, bid: patch.bid, trump: patch.trump, result: patch.result, unplayedPoints: patch.unplayedPoints };
  const expected = { declarer: state.declarer, bid: state.highestBid, trump: state.trump, result: state.result, unplayedPoints: state.result.unplayedPoints ?? 0 };
  if (canonicalJson(actual) !== canonicalJson(expected)) throw new HistoryProtocolError('副摘要（含未打出分）与提交结算局面不一致');
}

/** 不接受改名夹带暗牌或伪造 ownHand；完整观察必须等于相应局面、座位的合法投影。 */
export function assertEvaluationObservation(input: EvaluationInput, state: GameState): void {
  assertSeat(input.seat);
  if (input.phase !== state.phase) throw new HistoryProtocolError('评估阶段与观察局面不一致');
  let expected;
  try { expected = observeDecision(state, input.seat); }
  catch { throw new HistoryProtocolError('结束局面不支持决策评估'); }
  if (canonicalJson(input.observation) !== canonicalJson(expected)) {
    throw new HistoryProtocolError('评估观察与节点的合法可见投影不一致，禁止落库');
  }
}

/** 按完整键名识别凭据，maxTokens 等普通预算参数不会被误拒。 */
export function assertSafeValue(value: unknown, context: string, forbidPrivate = false): void {
  // 同时拒绝不可序列化值和循环；脱敏检查只处理合法 JSON。
  canonicalJson(value);
  const walk = (item: unknown, path: string): void => {
    if (typeof item === 'string' && /(?:authorization\s*:|bearer\s+\S|\bsk-[a-z0-9_-]+|https?:\/\/)/i.test(item)) {
      throw new HistoryProtocolError(`${context} 的字段 ${path} 包含凭据或服务端点，禁止落库`);
    }
    if (Array.isArray(item)) { item.forEach((child, index) => walk(child, `${path}[${index}]`)); return; }
    if (!isRecord(item)) return;
    for (const [key, child] of Object.entries(item)) {
      const normalized = key.toLowerCase().replace(/[-_\s]/g, '');
      if (/^(?:(?:api|access|auth|refresh|session|client)?(?:key|token|secret)|authorization|password|credential|credentials|baseurl|endpoint|serviceurl)$/.test(normalized)
        || (forbidPrivate && ['seed', 'hands', 'history', 'snapshot', 'gamestate', 'kitty', 'opponenthand', 'opponenthands'].includes(normalized))) {
        throw new HistoryProtocolError(`${context} 的字段 ${path}${key} 包含凭据、端点或私有状态，禁止落库`);
      }
      walk(child, `${path}${key}.`);
    }
  };
  walk(value, '');
}
