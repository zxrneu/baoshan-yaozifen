/** SQLite 驱动能力边界（DIP）：惰性加载 Node 内置模块，将不可用转换为历史库错误。 */
import { createRequire } from 'node:module';
import { HistoryUnavailableError } from '@yaozifen/protocol/protocol';

/** 在调用时真正加载并检查能力；模块加载失败与缺少导出均转换为可读错误。 */
export function loadSqliteModule(): typeof import('node:sqlite') {
  try {
    const sqlite = createRequire(import.meta.url)('node:sqlite') as typeof import('node:sqlite');
    if (typeof sqlite.DatabaseSync !== 'function') throw new Error('缺少 DatabaseSync');
    if (typeof sqlite.backup !== 'function') throw new Error('缺少 backup');
    return sqlite;
  } catch (error) {
    throw new HistoryUnavailableError(
      `历史存储需要 Node >= 22.16 的 node:sqlite DatabaseSync 与 backup：${error instanceof Error ? error.message : String(error)}`,
    );
  }
}
