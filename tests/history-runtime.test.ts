/**
 * 历史库运行时边界回归（SRP / DIP）。
 * 浏览器只加载纯协议；Node 模块缺失和能力不足用显式失败构造，不依赖机器默认状态。
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { build } from 'vite';
import { spawnSync } from 'node:child_process';
import { builtinModules } from 'node:module';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const entry = fileURLToPath(new URL('../packages/history-core/src/index.ts', import.meta.url));
const preflight = fileURLToPath(new URL('../scripts/check-node-sqlite.mjs', import.meta.url));

afterEach(() => {
  vi.doUnmock('node:module');
  vi.unstubAllGlobals();
  vi.resetModules();
});

describe('历史库：浏览器入口隔离', () => {
  it('生产构建的完整依赖图没有 Node 内置模块或服务端仓储', async () => {
    const modules: string[] = [];
    await build({
      configFile: false,
      logLevel: 'silent',
      plugins: [{
        name: 'history-browser-boundary-regression',
        enforce: 'pre',
        resolveId(id) {
          if (id.startsWith('node:') || builtinModules.includes(id)) {
            throw new Error(`浏览器历史入口拉入 Node 依赖：${id}`);
          }
          return null;
        },
        generateBundle() {
          modules.push(...this.getModuleIds());
        },
      }],
      build: {
        write: false,
        minify: false,
        lib: { entry, formats: ['es'], fileName: 'history-browser' },
      },
    });
    expect(modules.length).toBeGreaterThan(1);
    expect(modules.filter(id => /node:|\/server\/history\//.test(id))).toEqual([]);
  });

  it('公共入口仅暴露协议、ID 与环境逻辑，不暴露 Node 打开和迁移接口', async () => {
    const history = await import('@yaozifen/history-core');
    expect(history.HISTORY_PROTOCOL_VERSION).toBeGreaterThan(0);
    expect(history.derivedHistoryId('node', 'abcdef')).toMatch(/^n_[0-9a-z]+$/);
    expect(history.derivedHistoryId('node', 'abcdef')).toBe(history.derivedHistoryId('node', 'abcdef'));
    for (const name of ['SqliteHistoryRepository', 'openHistoryRepository', 'currentHistoryRepository', 'closeHistoryRepository', 'MIGRATIONS']) {
      expect(name in history).toBe(false);
    }
  });

  it('真实浏览器和仅有 process 垫片的浏览器均不会解析出服务端数据库路径', async () => {
    const history = await import('@yaozifen/history-core');
    for (const proc of [undefined, { env: { GAME_DB_PATH: '/private/server.db' } }]) {
      vi.stubGlobal('process', proc);
      try {
        expect(history.resolveHistoryDbPath({})).toBeNull();
        expect(history.resolveHistoryDbPath({ GAME_DB_PATH: '/private/server.db' })).toBeNull();
      } finally {
        vi.unstubAllGlobals();
      }
    }
    expect(history.resolveHistoryDbPath({})).toBe(history.DEFAULT_HISTORY_DB_PATH);
    expect(history.resolveHistoryDbPath({ GAME_DB_PATH: ' :memory: ' })).toBe(':memory:');
    expect(history.isHistoryEnabled({ GAME_HISTORY: ' OFF ' })).toBe(false);
  });
});

describe('历史库：显式构造 SQLite 加载失败', () => {
  it('仓储导入不会加载 SQLite，调用 loader 才把加载异常转换为可读错误', async () => {
    const requireSqlite = vi.fn(() => { throw new Error('模拟 node:sqlite 不存在'); });
    vi.doMock('node:module', () => ({ createRequire: () => requireSqlite }));
    const repository = await import('@yaozifen/server/history/sqliteDriver');
    const { HistoryUnavailableError } = await import('@yaozifen/protocol/protocol');
    const server = await import('@yaozifen/server/history/index');
    expect(requireSqlite).not.toHaveBeenCalled();
    expect(server.openHistoryRepository({ path: ':memory:', env: { GAME_HISTORY: 'off' } })).toBeNull();
    expect(requireSqlite).not.toHaveBeenCalled();
    expect(() => server.openHistoryRepository({ path: ':memory:', env: {} })).toThrow(HistoryUnavailableError);
    expect(server.currentHistoryRepository()).toBeNull();
    expect(() => repository.loadSqliteModule()).toThrow(HistoryUnavailableError);
    expect(() => repository.loadSqliteModule()).toThrow(/Node.*22\.16.*模拟 node:sqlite 不存在/);
    expect(requireSqlite).toHaveBeenCalledWith('node:sqlite');
  });

  it.each([
    ['DatabaseSync', { backup: () => Promise.resolve() }],
    ['backup', { DatabaseSync: class {} }],
  ])('模块缺少 %s 时拒绝伪成功并报告最低 Node 版本', async (missing, sqlite) => {
    vi.doMock('node:module', () => ({ createRequire: () => () => sqlite }));
    const { loadSqliteModule } = await import('@yaozifen/server/history/sqliteDriver');
    const { HistoryUnavailableError } = await import('@yaozifen/protocol/protocol');
    expect(() => loadSqliteModule()).toThrow(HistoryUnavailableError);
    expect(() => loadSqliteModule()).toThrow(/Node.*22\.16/);
    expect(() => loadSqliteModule()).toThrow(missing);
  });
});

/** 用子进程调用可注入的 preflight，不篡改当前测试进程或依赖当前模块缺失。 */
function runPreflightProbe(options: string) {
  return spawnSync(process.execPath, ['--input-type=module', '--eval', `
    const { checkNodeSqlite } = await import(${JSON.stringify(new URL('../scripts/check-node-sqlite.mjs', import.meta.url).href)});
    try { await checkNodeSqlite(${options}); }
    catch (error) { console.error(error.message); process.exitCode = 1; }
  `], { encoding: 'utf8' });
}

describe('历史库：Node 启动前置能力检查', () => {
  it('当前可用 Node 实际打开数据库并执行 backup 检查', () => {
    const result = spawnSync(process.execPath, [preflight], { encoding: 'utf8' });
    expect(result.status, result.stderr).toBe(0);
    expect(result.stdout).toMatch(/DatabaseSync.*backup.*SQLite/);
  });

  it('显式注入低于 22.16 的 Node 版本时拒绝启动', () => {
    const result = runPreflightProbe(`{ nodeVersion: '22.15.0', loadSqliteModule: async () => { throw new Error('不应加载'); } }`);
    expect(result.status).toBe(1);
    expect(result.stderr).toMatch(/Node.*22\.16.*22\.15\.0/);
    expect(result.stderr).not.toContain('不应加载');
  });

  it.each([
    ['加载失败', `async () => { throw new Error('模拟 node:sqlite 加载失败'); }`, /模拟 node:sqlite 加载失败/],
    ['缺少备份', `async () => ({ DatabaseSync: class {} })`, /backup/],
    ['缺少数据库', `async () => ({ backup: () => Promise.resolve() })`, /DatabaseSync/],
    ['备份执行失败', `async () => ({ ...(await import('node:sqlite')), backup: async () => { throw new Error('模拟 backup 执行失败'); } })`, /模拟 backup 执行失败/],
  ])('显式注入%s时给出升级提示且不建议过时实验 flag', (_name, loader, detail) => {
    const result = runPreflightProbe(`{ nodeVersion: '22.16.0', loadSqliteModule: ${loader} }`);
    expect(result.status).toBe(1);
    expect(result.stderr).toMatch(/Node.*22\.16/);
    expect(result.stderr).toMatch(detail);
    expect(result.stderr).not.toContain('--experimental-sqlite');
  });
});

describe('历史库：Node 门面连接生命周期', () => {
  it('关闭开关会释放既有缓存，再次关闭和重开均安全', async () => {
    const server = await import('@yaozifen/server/history/index');
    try {
      const first = server.openHistoryRepository({ path: ':memory:', env: {} });
      expect(first).not.toBeNull();
      expect(server.openHistoryRepository({ path: ':memory:', env: {} })).toBe(first);
      expect(server.openHistoryRepository({ env: { GAME_HISTORY: 'off' } })).toBeNull();
      expect(server.currentHistoryRepository()).toBeNull();
      expect(() => server.closeHistoryRepository()).not.toThrow();
      const reopened = server.openHistoryRepository({ path: ':memory:', env: {} });
      // 避免断言库深度遍历已关闭的原生数据库句柄。
      expect(reopened === first).toBe(false);
    } finally {
      server.closeHistoryRepository();
    }
  });

  it('外部关闭后同一路径重新打开，不复用已经失效的缓存', async () => {
    const server = await import('@yaozifen/server/history/index');
    try {
      const first = server.openHistoryRepository({ path: ':memory:', env: {} });
      expect(first).not.toBeNull();
      first?.close();
      const reopened = server.openHistoryRepository({ path: ':memory:', env: {} });
      expect(reopened === first).toBe(false);
      expect(reopened).not.toBeNull();
      expect(reopened?.schemaVersion()).toBeGreaterThan(0);
      expect(server.currentHistoryRepository()).toBe(reopened);
    } finally {
      server.closeHistoryRepository();
    }
  });

  it('外部关闭后切换路径与重复关闭门面不会抛出二次 close 错误', async () => {
    const server = await import('@yaozifen/server/history/index');
    const directory = mkdtempSync(join(tmpdir(), 'history-runtime-'));
    try {
      const first = server.openHistoryRepository({ path: join(directory, 'first.db'), env: {} });
      first?.close();
      expect(() => server.openHistoryRepository({ path: join(directory, 'second.db'), env: {} })).not.toThrow();
      server.currentHistoryRepository()?.close();
      expect(() => server.closeHistoryRepository()).not.toThrow();
      expect(() => server.closeHistoryRepository()).not.toThrow();
      expect(server.currentHistoryRepository()).toBeNull();
    } finally {
      server.closeHistoryRepository();
      const target = resolve(directory);
      const temporaryRoot = resolve(tmpdir());
      if (dirname(target) !== temporaryRoot || !target.startsWith(join(temporaryRoot, 'history-runtime-'))) {
        throw new Error(`拒绝清理非预期测试临时目录：${target}`);
      }
      rmSync(target, { recursive: true, force: true });
    }
  });
});
