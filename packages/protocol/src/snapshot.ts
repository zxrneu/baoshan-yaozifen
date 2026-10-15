/** 私有历史快照读写（SRP）：保留恢复所需完整状态，明确拒绝不兼容规则与协议。 */
import type { GameState } from '@yaozifen/game-core';
import { basicScoring } from '@yaozifen/game-core/rules';
import { readBasicHistoryState } from './snapshotValidation';
import { HISTORY_PROTOCOL_VERSION, RULE_SET_ID, RULE_VERSION } from './contracts';
import { contentDigest } from './json';
import { fail, isRecord, parseJson } from './errors';

export interface SnapshotOptions {
  /** 默认 true；false 仅用于不依赖随机源的牌面比较，产物不能作为可恢复历史存储。 */
  includeSeed?: boolean;
}

/** 先校验再白名单序列化完整可执行局面。seed/history 仅供私有存储和裁判，AI 必须使用阶段观察投影。 */
export function sanitizeHistorySnapshot(state: GameState, options: SnapshotOptions = {}): Record<string, unknown> {
  // 不能在 JSON 丢掉函数后才校验，否则自定义规则会被误读为 basic-v1。
  if (!isRecord(state) || !isRecord(state.rules) || state.rules.scoring !== basicScoring) {
    return fail('历史快照只支持 basic-v1 结算规则（scoring），已拒绝写入');
  }
  const validated = validatedHistoryState(state);
  const { scoring: _scoring, ...rules } = validated.rules;
  const copy = { ...validated, rules } as Record<string, unknown>;
  if (options.includeSeed === false) delete copy.seed;
  return copy;
}

function validatedHistoryState(value: unknown): GameState {
  try {
    return readBasicHistoryState(value);
  } catch (error) {
    return fail(error instanceof Error ? error.message : String(error));
  }
}

export function historySnapshotDigest(state: GameState, options: SnapshotOptions = {}): string {
  return contentDigest(sanitizeHistorySnapshot(state, options));
}

/** 规则匹配：不是当前规则集/版本的牌局显式拒绝，不静默重算。 */
export function assertSnapshotCompatible(ruleSetId: string, ruleVersion: number): void {
  if (ruleSetId !== RULE_SET_ID) fail(`历史使用了不支持的规则集 ${ruleSetId}，已拒绝加载`);
  if (ruleVersion !== RULE_VERSION) fail(`历史使用了规则版本 ${ruleVersion}，当前实现为 ${RULE_VERSION}，已拒绝加载`);
}

export function readHistorySnapshot(
  value: unknown,
  expected: { ruleSetId: string; ruleVersion: number } = { ruleSetId: RULE_SET_ID, ruleVersion: RULE_VERSION },
): GameState {
  const parsed: unknown = typeof value === 'string' ? parseJson(value, '快照') : value;
  if (!isRecord(parsed)) return fail('历史快照应为对象');
  const version = parsed.protocolVersion;
  if (version !== HISTORY_PROTOCOL_VERSION) {
    const legacy = version === 1 ? '；旧版可能丢失 seed/history，不能保证继续执行、重发牌与 nextHand 一致，请从完整原始状态重新导入' : '';
    fail(`历史快照协议版本 ${String(version)} 不受支持（当前 ${HISTORY_PROTOCOL_VERSION}）${legacy}`);
  }
  if (typeof parsed.ruleSetId !== 'string') return fail('历史快照缺少合法规则集 ruleSetId');
  if (typeof parsed.ruleVersion !== 'number' || !Number.isSafeInteger(parsed.ruleVersion)) return fail('历史快照缺少合法规则版本 ruleVersion');
  assertSnapshotCompatible(parsed.ruleSetId, parsed.ruleVersion);
  assertSnapshotCompatible(expected.ruleSetId, expected.ruleVersion);
  if (parsed.ruleSetId !== expected.ruleSetId || parsed.ruleVersion !== expected.ruleVersion) fail('历史快照与预期规则不一致');
  if (!isRecord(parsed.snapshot)) return fail('历史快照缺少 snapshot 字段');
  return validatedHistoryState(parsed.snapshot);
}
