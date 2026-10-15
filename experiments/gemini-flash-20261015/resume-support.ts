/** 实验限流策略与不可覆盖检查点；隔离网络策略和持久化职责，不改产品引擎。 */
import fs from 'node:fs';
import path from 'node:path';
export interface RetryPolicy { daily: boolean; retryDelayMs: number }
function object(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === 'object' ? value as Record<string, unknown> : {};
}
export function googleRetryPolicy(body: unknown, headers: Headers): RetryPolicy {
  let daily = false;
  const seconds = headers.get('retry-after');
  let retryDelayMs = Math.max(0, Number(headers.get('retry-after-ms')) || 0,
    seconds ? (Number.isFinite(Number(seconds)) ? Number(seconds) * 1000 : Date.parse(seconds) - Date.now()) || 0 : 0);
  for (const entry of Array.isArray(body) ? body : [body]) {
    const error = object(object(entry).error);
    const details = Array.isArray(error.details) ? error.details : [];
    for (const value of details) {
      const detail = object(value);
      if (String(detail['@type']).endsWith('RetryInfo')) {
        const match = String(detail.retryDelay).match(/^(\d+(?:\.\d+)?)s$/);
        if (match) retryDelayMs = Math.max(retryDelayMs, Number(match[1]) * 1000);
      }
      if (Array.isArray(detail.violations)) {
        daily ||= detail.violations.some(v => /PerDay|per_day/i.test(String(object(v).quotaId)));
      }
    }
  }
  return { daily, retryDelayMs };
}
export function saveCheckpoint(directory: string, id: string, value: unknown): boolean {
  if (!/^[a-zA-Z0-9_-]+$/.test(id)) throw new Error('检查点 ID 非法');
  fs.mkdirSync(directory, { recursive: true });
  try { fs.writeFileSync(path.join(directory, `${id}.json`), JSON.stringify(value, null, 2), { flag: 'wx' }); return true; }
  catch (error) {
    if (error instanceof Error && 'code' in error && error.code === 'EEXIST') return false;
    throw error;
  }
}
