/** 配置领域模型与严格校验（SRP）：只接收已实现参数，跨运行时共用不可变指纹。 */
import type { EngineType } from './engineTypes';
import { DEFAULT_DEEP_THINKING_CONFIG, DEFAULT_FAST_THINKING_CONFIG } from '../bridge/types';
import { DEFAULT_OPTIMIZED_BUDGET } from '../optimized/contracts';
import { contentDigest } from '../../history/json';
import { derivedHistoryId } from '../../history/ids';
import type { ProfileVersionInput } from '../../history/contracts';
import { LLM_PROMPT_VERSION } from './llm/llmPrompts';

export const MAX_DECISION_BUDGET_MS = 3600000;
export const PROFILE_IMPLEMENTATION_VERSION = `profiles-v1:${LLM_PROMPT_VERSION}`;
export interface ProfileDefinition {
  id: string; name: string; type: EngineType; options: Record<string, unknown>; fallbackProfileId?: string;
}
export interface ProfilesFile { schemaVersion: 1; profiles: ProfileDefinition[] }
export interface EngineProfile extends ProfileVersionInput {
  profileVersionId: string; type: EngineType;
  parameters: { execution: 'server' | 'local'; options: Record<string, unknown>; fallback?: ProfileReference; capabilities: Record<string, 'model' | 'heuristic' | 'search'> };
}
export interface ProfileReference { profileId: string; version: string }
export type SeatRoute = ProfileReference | 'human';
const object = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value);
const fail = (message: string): never => { throw new Error(`引擎配置：${message}`); };
function keys(value: Record<string, unknown>, allowed: string[]) {
  for (const key of Object.keys(value)) if (!allowed.includes(key)) fail(`不支持字段 ${key}`);
}
const numeric: Record<string, [number, number]> = {
  minWorlds: [1, 100000], maxWorlds: [1, 100000], timeLimitMs: [1, 120000], endgameCardLimit: [1, 48],
  endgameWorldLimit: [1, 100000], endgameNodeLimit: [1, 10000000], timeoutMs: [1, MAX_DECISION_BUDGET_MS],
  maxConcurrency: [1, 32], maxRetries: [0, 5], errorProbability: [0.000001, 0.999999],
};
export function normalizeOptions(type: EngineType, input: unknown): Record<string, unknown> {
  if (!object(input)) return fail('options 必须为对象');
  const defaults: Record<string, unknown> = type === 'bridge'
    ? { ...(input.mode === 'fast' ? DEFAULT_FAST_THINKING_CONFIG : DEFAULT_DEEP_THINKING_CONFIG) }
    : type === 'algorithm' ? { ...DEFAULT_OPTIMIZED_BUDGET }
    : type === 'llm' ? { model: 'qwen38_27b', protocol: 'chat', responseFormat: 'json_object', reasoningEffort: 'low', timeoutMs: 60000, maxRetries: 2, maxConcurrency: 2, disableBidAdvice: false, baseUrlEnv: 'LLM_BASE_URL', apiKeyEnv: 'LLM_API_KEY' }
    : { model: 'laya:multilingual', timeoutMs: 2500, baseUrlEnv: 'LAYA_BASE_URL', apiKeyEnv: 'LAYA_API_KEY' };
  keys(input, Object.keys(defaults));
  const options = { ...defaults, ...input };
  const enums: Record<string, string[]> = { mode: ['fast', 'deep'], protocol: ['chat', 'completion'], responseFormat: ['json_object', 'json_schema', 'text'], reasoningEffort: ['default', 'none', 'low', 'medium', 'high'] };
  for (const [key, value] of Object.entries(options)) {
    if (numeric[key]) {
      const [min, max] = numeric[key];
      if (typeof value !== 'number' || !Number.isFinite(value) || value < min || value > max || key !== 'errorProbability' && !Number.isInteger(value)) fail(`${key} 超出有效范围`);
    } else if (enums[key]) {
      if (typeof value !== 'string' || !enums[key].includes(value)) fail(`${key} 无效`);
    } else if (['conservative', 'disableBidAdvice'].includes(key)) {
      if (typeof value !== 'boolean') fail(`${key} 必须为布尔值`);
    } else if (typeof value !== 'string' || !value.trim() || value.length > 200) fail(`${key} 必须为非空字符串`);
    if (key.endsWith('Env') && (typeof value !== 'string' || !/^[A-Z][A-Z0-9_]*$/.test(value))) fail(`${key} 必须为环境变量名`);
  }
  if (typeof options.minWorlds === 'number' && typeof options.maxWorlds === 'number' && options.minWorlds > options.maxWorlds) fail('minWorlds 不能超过 maxWorlds');
  return options;
}
export function parseProfilesFile(value: unknown): ProfilesFile {
  if (!object(value)) return fail('文件必须为对象');
  keys(value, ['schemaVersion', 'profiles']);
  if (value.schemaVersion !== 1 || !Array.isArray(value.profiles) || !value.profiles.length) return fail('不支持的 schema 或空列表');
  const profiles = value.profiles.map((item: unknown): ProfileDefinition => {
    if (!object(item)) return fail('profile 必须为对象');
    keys(item, ['id', 'name', 'type', 'options', 'fallbackProfileId']);
    if (typeof item.id !== 'string' || !/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,63}$/.test(item.id)) return fail('id 无效');
    if (typeof item.name !== 'string' || !item.name.trim() || item.name.length > 100) return fail('name 无效');
    if (typeof item.type !== 'string' || !['bridge', 'algorithm', 'llm', 'laya'].includes(item.type)) return fail('type 无效');
    if (item.fallbackProfileId !== undefined && typeof item.fallbackProfileId !== 'string') return fail('备用配置无效');
    const type = item.type as EngineType;
    return { id: item.id, name: item.name, type, options: normalizeOptions(type, item.options ?? {}), ...(item.fallbackProfileId ? { fallbackProfileId: item.fallbackProfileId as string } : {}) };
  });
  const byId = new Map(profiles.map(profile => [profile.id, profile]));
  if (byId.size !== profiles.length) fail('id 重复');
  for (const profile of profiles) {
    const seen = new Set<string>(); let cursor: ProfileDefinition | undefined = profile;
    while (cursor) {
      if (seen.has(cursor.id)) fail('备用配置不能成环');
      seen.add(cursor.id);
      if (!cursor.fallbackProfileId) break;
      cursor = byId.get(cursor.fallbackProfileId);
      if (!cursor) fail('备用配置不存在');
    }
  }
  return { schemaVersion: 1, profiles };
}
export function makeProfile(definition: ProfileDefinition, options: Record<string, unknown>, fallback?: ProfileReference, execution: 'local' | 'server' = 'server'): EngineProfile {
  const capabilities: EngineProfile['parameters']['capabilities'] = definition.type === 'llm' ? { bidding: 'model', trump: 'model', bury: 'model', playing: 'model' }
    : definition.type === 'laya' ? { bidding: 'model', trump: 'model', bury: 'heuristic', playing: 'model' }
    : { bidding: 'heuristic', trump: 'heuristic', bury: 'heuristic', playing: definition.type === 'bridge' && options.mode === 'fast' ? 'heuristic' : 'search' };
  const parameters: EngineProfile['parameters'] = { execution, options, capabilities, ...(fallback ? { fallback } : {}) };
  const configHash = contentDigest({ profileId: definition.id, name: definition.name, type: definition.type, parameters, implementationVersion: PROFILE_IMPLEMENTATION_VERSION });
  return { profileId: definition.id, profileVersionId: derivedHistoryId('profileVersion', configHash), name: definition.name, type: definition.type, parameters, configHash, version: configHash, implementationVersion: PROFILE_IMPLEMENTATION_VERSION, createdAt: 0 };
}
