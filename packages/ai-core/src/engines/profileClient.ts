/** 配置 HTTP 客户端与本地座位偏好（SRP / DIP）：只缓存脱敏版本，不解析服务凭据。 */
import type { DecisionEngineManager } from './index';
import { ENGINE_LABELS } from './engineLabels';
import { makeProfile, parseProfilesFile, type EngineProfile, type SeatRoute } from './profiles';
const STORAGE_KEY = 'baoshan_seat_profiles_v1';
export async function requestProfiles(body?: unknown): Promise<EngineProfile[]> {
  const controller = new AbortController(); const timer = setTimeout(() => controller.abort(new Error('配置请求超时')), 5000);
  try {
    const response = await globalThis.fetch('/api/engine-profiles', { signal: controller.signal, ...(body ? { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) } : {}) });
    const data = await response.json();
    if (!response.ok || !Array.isArray(data.profiles)) throw new Error(data.error ?? '配置服务请求失败');
    return data.profiles;
  } finally { clearTimeout(timer); }
}
export function offlineProfiles(): EngineProfile[] {
  return parseProfilesFile({ schemaVersion: 1, profiles: [
    { id: 'offline-default-bridge', name: `本地${ENGINE_LABELS.bridge}`, type: 'bridge', options: {} },
    { id: 'offline-default-algorithm', name: `本地${ENGINE_LABELS.algorithm}`, type: 'algorithm', options: {} },
  ] }).profiles.map(definition => makeProfile(definition, definition.options, undefined, 'local'));
}
export function saveSeatProfiles(manager: DecisionEngineManager): void {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify({ profiles: manager.getHistoryProfiles(), routes: manager.getSeatRoutes() })); } catch {}
}
export function loadSeatProfiles(manager: DecisionEngineManager): void {
  try {
    const raw = localStorage.getItem(STORAGE_KEY); if (!raw) return;
    const parsed = JSON.parse(raw) as { profiles: EngineProfile[]; routes: SeatRoute[] };
    if (!Array.isArray(parsed.profiles) || !Array.isArray(parsed.routes)) return;
    // 保存的是实际旧版本，目录刷新不能把选择偷偷重映射到当前同名配置。
    manager.restoreProfiles(parsed.profiles, parsed.routes);
  } catch {}
}
