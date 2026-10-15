/**
 * 历史库环境策略（SRP / DIP）。
 * 不导入 Node 模块；浏览器安全地读取开关，数据库路径仅在真正的 Node 运行时解析。
 */
type HistoryEnvironment = Record<string, string | undefined>;

export const DEFAULT_HISTORY_DB_PATH = 'data/history.db';

/** 读取当前环境而不依赖全局 process 变量，供 Node 门面与默认参数共用。 */
export function readHistoryEnvironment(): HistoryEnvironment {
  const proc = (globalThis as { process?: { env?: HistoryEnvironment } }).process;
  return proc?.env ?? {};
}

/** 浏览器常有 process.env 垫片；仅检查 process 存在会错误启用服务端路径。 */
function isNodeRuntime(): boolean {
  const proc = (globalThis as { process?: { versions?: { node?: string }; release?: { name?: string } } }).process;
  return typeof proc?.versions?.node === 'string' && proc.release?.name === 'node';
}

/** 从环境解析数据库路径；浏览器即使收到显式配置也不会暴露或启用服务端路径。 */
export function resolveHistoryDbPath(env: HistoryEnvironment = readHistoryEnvironment()): string | null {
  if (!isNodeRuntime()) return null;
  return env.GAME_DB_PATH?.trim() || DEFAULT_HISTORY_DB_PATH;
}

/** GAME_HISTORY=off/0/false/no/disabled 时完全关闭历史写入。 */
export function isHistoryEnabled(env: HistoryEnvironment = readHistoryEnvironment()): boolean {
  const flag = (env.GAME_HISTORY ?? 'on').trim().toLowerCase();
  return !['0', 'off', 'false', 'no', 'disabled'].includes(flag);
}
