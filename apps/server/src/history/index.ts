/**
 * 历史库 Node 门面（SRP / DIP）。
 * 连接打开、进程缓存与关闭只存在于这个服务端入口；仓储负责真正惰性加载 node:sqlite。
 * 浏览器和共享协议消费者应导入 index.ts，不得导入本模块。
 */
import { SqliteHistoryRepository } from './sqliteRepository';
import type { HistoryRepository } from "@yaozifen/history-core/contracts";
import { isHistoryEnabled, readHistoryEnvironment, resolveHistoryDbPath } from '@yaozifen/protocol/environment';

export * from '@yaozifen/history-core';
export { SqliteHistoryRepository } from './sqliteRepository';
export { MIGRATIONS, LATEST_SCHEMA_VERSION } from './migrations';

let cached: { repository: SqliteHistoryRepository; path: string } | null = null;

/**
 * 同步打开或复用历史库；force 仅用于绕过开关的底层自检。
 * 禁用时释放已有连接，切换路径时先清理旧缓存，失败不会留下失效单例。
 */
export function openHistoryRepository(
  options: { path?: string; force?: boolean; env?: Record<string, string | undefined> } = {},
): HistoryRepository | null {
  const env = options.env ?? readHistoryEnvironment();
  if (!options.force && !isHistoryEnabled(env)) {
    closeHistoryRepository();
    return null;
  }
  const path = options.path ?? resolveHistoryDbPath(env);
  if (!path) {
    closeHistoryRepository();
    return null;
  }
  if (cached?.path === path && !cached.repository.isClosed()) return cached.repository;
  closeHistoryRepository();
  const repository = new SqliteHistoryRepository({ path });
  cached = { repository, path };
  return repository;
}

/** 只读当前进程缓存，不触发数据库打开。 */
export function currentHistoryRepository(): HistoryRepository | null {
  if (cached?.repository.isClosed()) cached = null;
  return cached?.repository ?? null;
}

/** 先移除缓存再关闭，保证重复调用安全，关闭失败也不会复用失效连接。 */
export function closeHistoryRepository(): void {
  const repository = cached?.repository;
  cached = null;
  repository?.close();
}
