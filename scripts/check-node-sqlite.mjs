#!/usr/bin/env node
/**
 * Node 历史库启动前置检查（SRP / DIP）。
 * 同时确认最低版本、DatabaseSync 和 backup 的实际可用性；可注入失败以显式回归降级边界。
 */
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const REQUIRED_NODE_VERSION = '22.16.0';

function supportedVersion(version) {
  const match = /^(\d+)\.(\d+)\.(\d+)$/.exec(version);
  if (!match) return false;
  const [, major, minor] = match.map(Number);
  return major > 22 || (major === 22 && minor >= 16);
}

/** 检查函数导入无副作用；默认路径始终使用真实 node:sqlite 和真实临时备份。 */
export async function checkNodeSqlite({
  nodeVersion = process.versions.node,
  loadSqliteModule = () => import('node:sqlite'),
} = {}) {
  const requirement = `[history] 历史存储需要 Node >= ${REQUIRED_NODE_VERSION}（当前 ${nodeVersion}），并提供可用的 DatabaseSync + backup。`;
  if (!supportedVersion(nodeVersion)) throw new Error(`${requirement}请升级 Node（推荐 24 LTS）。`);

  let source;
  let restored;
  let directory;
  try {
    const sqlite = await loadSqliteModule();
    if (typeof sqlite?.DatabaseSync !== 'function') throw new Error('node:sqlite 缺少 DatabaseSync');
    if (typeof sqlite?.backup !== 'function') throw new Error('node:sqlite 缺少 backup');
    source = new sqlite.DatabaseSync(':memory:');
    source.exec('CREATE TABLE history_preflight (value TEXT NOT NULL)');
    source.prepare('INSERT INTO history_preflight (value) VALUES (?)').run('备份能力检查');
    const row = source.prepare('SELECT sqlite_version() AS version').get();
    directory = mkdtempSync(join(tmpdir(), 'history-sqlite-preflight-'));
    const backupPath = join(directory, 'backup.db');
    await sqlite.backup(source, backupPath);
    restored = new sqlite.DatabaseSync(backupPath, { readOnly: true });
    const copied = restored.prepare('SELECT value FROM history_preflight').get();
    if (copied?.value !== '备份能力检查') throw new Error('backup 备份内容校验失败');
    return { nodeVersion, sqliteVersion: String(row.version) };
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    throw new Error(`${requirement}能力检查失败：${detail}。请升级 Node（推荐 24 LTS）。`);
  } finally {
    // 即使关闭失败也继续释放其它资源；删除只允许本次 mkdtemp 创建的目录。
    try {
      restored?.close();
    } finally {
      try {
        source?.close();
      } finally {
        if (directory) {
          const target = resolve(directory);
          const temporaryRoot = resolve(tmpdir());
          if (dirname(target) !== temporaryRoot || !target.startsWith(join(temporaryRoot, 'history-sqlite-preflight-'))) {
            throw new Error(`[history] 拒绝清理非预期临时目录：${target}`);
          }
          rmSync(target, { recursive: true, force: true });
        }
      }
    }
  }
}

// 只有直接执行脚本时才启动检查，测试导入不会隐式加载 SQLite。
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const result = await checkNodeSqlite();
    console.log(`[history] node:sqlite DatabaseSync + backup 可用，SQLite ${result.sqliteVersion}，Node ${result.nodeVersion}`);
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
