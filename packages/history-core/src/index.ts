/**
 * 历史库浏览器安全入口（SRP / ISP）。
 * 只导出纯协议、ID 和环境策略，不让共享代码的静态依赖图拉入 Node 或 SQLite。
 * 需要打开/缓存数据库的 Node 调用方应使用独立的 apps/server/src/history/index.ts 入口。
 */
export * from '@yaozifen/protocol/protocol';
export { newHistoryId, derivedHistoryId } from '@yaozifen/protocol/ids';
export { DEFAULT_HISTORY_DB_PATH, resolveHistoryDbPath, isHistoryEnabled } from '@yaozifen/protocol/environment';
