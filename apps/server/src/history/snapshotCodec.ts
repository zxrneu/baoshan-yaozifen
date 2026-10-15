/** SQLite 快照列编解码（SRP）：统一写入、读回与摘要来源，保留完整恢复状态。 */
import type { GameState } from '@yaozifen/game-core';
import type { ActionNodeInput } from '@yaozifen/protocol/protocol';
import { HISTORY_PROTOCOL_VERSION, RULE_SET_ID, RULE_VERSION, HistoryProtocolError,
  actionNodeDigest, readHistorySnapshot, readVersioned, sanitizeHistorySnapshot, writeVersioned } from '@yaozifen/protocol/protocol';

/**
 * 局面列编码：外层 v/data 承载协议版本，内层直接是游戏局面本体。
 * 写入与读取必须成对出现，避免「版本信封套版本信封」导致读回缺字段。
 */
export function encodeNodeState(state: GameState): string {
  // 必须复用与 createHand 完全相同的信封形状，否则读回时会缺少 snapshot 字段。
  return writeVersioned({
    protocolVersion: HISTORY_PROTOCOL_VERSION,
    ruleSetId: RULE_SET_ID,
    ruleVersion: RULE_VERSION,
    snapshot: sanitizeHistorySnapshot(state),
  });
}

/**
 * 返回「信封化后再解码」的局面本体，作为指纹与落库内容的唯一来源。
 * 这样归一化（保留 seed/history、白名单复制）只发生一次，写入与读回必然一致。
 */
export function nodeSnapshotSource(input: Pick<ActionNodeInput, 'state'>): GameState {
  if (!input.state) throw new HistoryProtocolError('动作节点缺少局面快照');
  return decodeNodeState(encodeNodeState(input.state));
}

/** 局面指纹（state_digest 列的唯一算法）：写入与读回校验必须共用本函数。 */
export function nodeStateDigest(state: GameState): string {
  return actionNodeDigest({ state });
}

/** 局面列解码；缺字段、版本不符或规则不匹配都会抛出 HistoryProtocolError。 */
export function decodeNodeState(text: string): GameState {
  return readHistorySnapshot(readVersioned<Record<string, unknown>>(text, '节点局面'));
}
