/** 历史配置冻结与重启恢复（DIP）：SQLite 不可变版本独立于当前文件。 */
import { afterEach, describe, expect, it } from 'vitest';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { ServerEngineRegistry } from '../server/engines/serverEngineRegistry';
import { SqliteHistoryRepository } from '../server/history/sqliteRepository';
import { resolveHistoryConfiguration } from '../server/history/configuration';
import { HISTORY_PROTOCOL_VERSION } from '../src/history/contracts';
const dirs: string[] = [];
afterEach(() => dirs.splice(0).forEach(dir => rmSync(dir, { recursive: true, force: true })));
describe('历史实际配置版本', () => {
  it('配置落库保持请求版本，服务重启和文件改动后仍恢复旧模型参数与备用版本', () => {
    const dir = mkdtempSync(join(tmpdir(), 'profile-history-')); dirs.push(dir); const path = join(dir, 'profiles.json');
    const write = (model: string) => writeFileSync(path, JSON.stringify({ schemaVersion: 1, profiles: [
      { id: 'base', name: '快算', type: 'bridge', options: { mode: 'fast' } },
      { id: 'analysis', name: '分析', type: 'llm', options: { model, baseUrlEnv: 'MODEL_URL' }, fallbackProfileId: 'base' },
    ] }));
    write('old-model'); const env = { MODEL_URL: 'http://127.0.0.1:8777/v1' }; const registry = new ServerEngineRegistry({ profilesPath: path, env });
    const before = registry.getProfile('analysis'); const repo = new SqliteHistoryRepository({ path: ':memory:' });
    try {
      const packet = resolveHistoryConfiguration({ protocolVersion: HISTORY_PROTOCOL_VERSION, profiles: registry.profiles.list() }, registry);
      expect(packet.profiles?.find(profile => profile.profileId === 'analysis')).toEqual(before);
      packet.profiles?.forEach(profile => repo.recordProfileVersion(profile));
      write('new-model'); const restarted = new ServerEngineRegistry({ profilesPath: path, env });
      restarted.setProfileLoader(id => repo.getProfileVersion(id));
      const restored = restarted.getProfile('analysis', before.version);
      expect(restored.parameters.options.model).toBe('old-model');
      expect(restarted.getProfile('analysis').parameters.options.model).toBe('new-model');
      expect(restarted.getProfile('base', restored.parameters.fallback!.version).version).toBe(before.parameters.fallback!.version);
      expect(JSON.stringify(repo.listProfileVersions('analysis'))).not.toContain('127.0.0.1');
    } finally { repo.close(); }
  });
  it('环境端点已更换时不能把新服务冒充旧版本，必须明确拒绝恢复', () => {
    const registry = new ServerEngineRegistry({ llm: { baseUrl: 'http://127.0.0.1:8777/v1' } });
    const before = registry.getProfile('default-llm');
    const restarted = new ServerEngineRegistry({ llm: { baseUrl: 'http://127.0.0.1:8778/v1' } });
    restarted.setProfileLoader(() => before);
    expect(() => restarted.getProfile(before.profileId, before.version)).toThrow(/服务|端点/);
  });
});
