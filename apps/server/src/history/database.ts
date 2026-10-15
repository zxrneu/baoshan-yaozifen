/** SQLite 连接与迁移生命周期（SRP）：先探测兼容性，再原子升级，失败保留原库。 */
import type { DatabaseSync } from 'node:sqlite';
import { existsSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { HistoryProtocolError, HistoryUnavailableError } from '@yaozifen/protocol/protocol';
import { LATEST_SCHEMA_VERSION, MIGRATIONS } from './migrations';
import { loadSqliteModule } from './sqliteDriver';

type Row = Record<string, unknown>;
export interface SqliteHistoryOptions {
  path: string;
  /** 只读已有最新 schema，不建目录、不创建库、不迁移。 */
  readonly?: boolean;
}

export function openDatabase(options: SqliteHistoryOptions): DatabaseSync {
  const { DatabaseSync: Database } = loadSqliteModule();
  let db: DatabaseSync | undefined;
  try {
    const path = options.path;
    if (path !== ':memory:' && existsSync(path)) {
      const probe = new Database(path, { readOnly: true });
      try { assertSchemaSupported(probe, !!options.readonly); } finally { probe.close(); }
    }
    if (options.readonly && (path === ':memory:' || !existsSync(path))) {
      throw new HistoryProtocolError('只读历史库必须是已存在的最新版本文件');
    }
    if (!options.readonly && path !== ':memory:') mkdirSync(dirname(path), { recursive: true });
    db = new Database(path, { readOnly: !!options.readonly });
    db.exec('PRAGMA busy_timeout = 5000');
    const current = assertSchemaSupported(db, !!options.readonly);
    if (!options.readonly && current < LATEST_SCHEMA_VERSION) migrate(db);
    db.exec('PRAGMA foreign_keys = ON');
    if (!options.readonly) {
      db.exec('PRAGMA journal_mode = WAL');
      db.exec('PRAGMA synchronous = NORMAL');
    }
    return db;
  } catch (error) {
    db?.close();
    if (error instanceof HistoryProtocolError || error instanceof HistoryUnavailableError) throw error;
    throw new HistoryUnavailableError(`历史数据库打开失败：${error instanceof Error ? error.message : String(error)}`);
  }
}

function assertSchemaSupported(db: DatabaseSync, requireLatest: boolean): number {
  const hasTable = db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='schema_migrations'").get();
  const versions = hasTable ? (db.prepare('SELECT version FROM schema_migrations ORDER BY version').all() as Row[]).map(row => Number(row.version)) : [];
  const current = versions.length ? versions[versions.length - 1] : 0;
  if (current > LATEST_SCHEMA_VERSION) throw new HistoryProtocolError(`数据库 schema 版本 ${current} 高于当前实现支持的 ${LATEST_SCHEMA_VERSION}，已拒绝打开以避免损坏历史`);
  if (versions.some((version, index) => version !== MIGRATIONS[index]?.version)) throw new HistoryProtocolError('历史数据库迁移版本不连续，已拒绝打开');
  if (requireLatest && current !== LATEST_SCHEMA_VERSION) throw new HistoryProtocolError('只读历史库需要最新 schema，不能自动迁移');
  return current;
}

/** 所有待应用迁移共用一个事务；图表重建时暂关 FK，提交前完整校验。 */
function migrate(db: DatabaseSync): void {
  db.exec('PRAGMA foreign_keys = OFF');
  db.exec('BEGIN IMMEDIATE');
  try {
    assertSchemaSupported(db, false);
    db.exec('CREATE TABLE IF NOT EXISTS schema_migrations (version INTEGER PRIMARY KEY, name TEXT NOT NULL, applied_at INTEGER NOT NULL)');
    const applied = new Set((db.prepare('SELECT version FROM schema_migrations').all() as Row[]).map(row => Number(row.version)));
    for (const migration of MIGRATIONS) {
      if (applied.has(migration.version)) continue;
      for (const statement of migration.statements) db.exec(statement);
      db.prepare('INSERT INTO schema_migrations (version,name,applied_at) VALUES (?,?,?)').run(migration.version, migration.name, Date.now());
    }
    if (db.prepare('PRAGMA foreign_key_check').all().length) throw new Error('旧库存在外键断链');
    const invalidScope = db.prepare(`SELECT 1 FROM branches b
      LEFT JOIN action_nodes s ON s.node_id=b.source_node_id LEFT JOIN branches sb ON sb.branch_id=s.branch_id
      LEFT JOIN action_nodes t ON t.node_id=b.tip_node_id
      WHERE (b.source_node_id IS NOT NULL AND sb.hand_id<>b.hand_id) OR (b.tip_node_id IS NOT NULL AND t.branch_id<>b.branch_id)
      UNION ALL SELECT 1 FROM seat_assignments a JOIN branches b ON b.branch_id=a.branch_id
      LEFT JOIN action_nodes n ON n.node_id=a.node_id
      WHERE b.hand_id<>a.hand_id OR (a.node_id IS NOT NULL AND n.branch_id<>a.branch_id)`).get();
    if (invalidScope) throw new Error('旧库存在跨副或跨分支引用');
    db.exec('COMMIT');
  } catch (error) {
    db.exec('ROLLBACK');
    throw new HistoryProtocolError(`历史数据库迁移失败，原库已保留：${error instanceof Error ? error.message : String(error)}`);
  } finally { db.exec('PRAGMA foreign_keys = ON'); }
}
