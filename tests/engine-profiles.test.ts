/** 多配置文件与列表验收（DIP）：临时文件和环境注入，不访问真实模型。 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { mkdtempSync, writeFileSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createApiHandler } from '@yaozifen/server/apiHandler';

const dirs: string[] = [];
afterEach(() => { dirs.splice(0).forEach(dir => rmSync(dir, { recursive: true, force: true })); vi.unstubAllEnvs(); vi.unstubAllGlobals(); });
function configure(profiles: unknown[]) {
  const dir = mkdtempSync(join(tmpdir(), 'engine-profiles-')); dirs.push(dir);
  const path = join(dir, 'profiles.json');
  writeFileSync(path, JSON.stringify({ schemaVersion: 1, profiles }));
  vi.stubEnv('ENGINE_PROFILES_PATH', path);
  vi.stubEnv('TEST_MODEL_URL', 'http://127.0.0.1:8765/v1');
  vi.stubEnv('TEST_MODEL_KEY', 'private-test-key');
  return { path, api: () => createApiHandler() };
}
const definitions = [
  { id: 'fast', name: '快算', type: 'bridge', options: { mode: 'fast' } },
  { id: 'llm-a', name: '分析甲', type: 'llm', options: { baseUrlEnv: 'TEST_MODEL_URL', apiKeyEnv: 'TEST_MODEL_KEY', model: 'model-a' }, fallbackProfileId: 'fast' },
  { id: 'llm-b', name: '分析乙', type: 'llm', options: { baseUrlEnv: 'TEST_MODEL_URL', model: 'model-b' }, fallbackProfileId: 'fast' },
];
async function list(api: ReturnType<typeof createApiHandler>) {
  let body = ''; const status = vi.fn();
  const handled = await api.handleApiRequest({ method: 'GET' }, { writeHead: status, end: value => { body = String(value); } }, '/api/engine-profiles');
  expect(handled).toBe(true); expect(status).toHaveBeenCalledWith(200, expect.anything());
  return JSON.parse(body) as { profiles: { profileId: string; version: string; parameters: { options: Record<string, unknown> } }[] };
}
describe('版本化多配置文件', () => {
  it('多个同类配置分别列出实际参数和稳定版本，列表不泄露服务地址和密钥', async () => {
    const setup = configure(definitions); const first = await list(setup.api()); const second = await list(setup.api());
    expect(first.profiles.map(profile => profile.profileId)).toEqual(['fast', 'llm-a', 'llm-b']);
    expect(first.profiles).toEqual(second.profiles);
    expect(first.profiles[1].parameters.options.model).toBe('model-a');
    expect(first.profiles[2].parameters.options.model).toBe('model-b');
    expect(JSON.stringify(first)).not.toContain('private-test-key'); expect(JSON.stringify(first)).not.toContain('127.0.0.1');
  });
  it.each([
    [{ ...definitions[0], options: { mode: 'fast', typo: 1 } }],
    [definitions[0], definitions[0]],
    [{ ...definitions[0], fallbackProfileId: 'missing' }],
    [{ ...definitions[0], fallbackProfileId: 'fast' }],
    [{ ...definitions[1], options: { baseUrl: 'https://example.com', apiKey: 'secret' } }],
    [{ ...definitions[0], options: { minWorlds: 32, maxWorlds: 2 } }],
  ].map(invalid => [invalid]))('拒绝未知参数、重复身份、无效备用链、明文凭据与错误预算 %#', invalid => {
    const setup = configure(Array.isArray(invalid) ? invalid : [invalid]); expect(setup.api).toThrow();
  });
  it('参数编辑原子保存新版本，旧版本继续可用；拒绝基于旧目录覆盖外部改动', async () => {
    const setup = configure(definitions); const api = setup.api(); const before = api.engineRegistry.getProfile('llm-a');
    async function edit(options: Record<string, unknown>, expectedVersion: string) {
      let body = ''; let code = 0;
      const payload = JSON.stringify({ profileId: 'llm-a', name: '分析甲', options, expectedVersion });
      await api.handleApiRequest({ method: 'POST', on: (event, listener) => { if (event === 'data') queueMicrotask(() => listener(payload)); if (event === 'end') queueMicrotask(() => listener()); } }, { writeHead: status => { code = status; }, end: value => { body = String(value); } }, '/api/engine-profiles');
      return { code, body };
    }
    const { serviceId: _serviceId, ...options } = before.parameters.options;
    const edited = await edit({ ...options, model: 'edited-model' }, before.version); expect(edited.code).toBe(200);
    expect(api.engineRegistry.getProfile('llm-a', before.version).parameters.options.model).toBe('model-a');
    expect(JSON.parse(readFileSync(setup.path, 'utf8')).profiles.find((profile: { id: string }) => profile.id === 'llm-a').options.model).toBe('edited-model');
    const stale = await edit({ ...options, model: 'stale-overwrite' }, before.version); expect(stale.code).toBe(400);
    expect(api.engineRegistry.getProfile('llm-a').parameters.options.model).toBe('edited-model');
  });
  it('健康列表按每个 profile 探测，返回名称与可用状态而不暴露服务地址', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('{}', { status: 200 })));
    const setup = configure(definitions); const api = setup.api(); let body = '';
    await api.handleApiRequest({ method: 'GET' }, { writeHead: vi.fn(), end: value => { body = String(value); } }, '/api/engines');
    const result = JSON.parse(body);
    expect(result.profiles).toHaveLength(3); expect(result.profiles.every((profile: { available: boolean }) => profile.available)).toBe(true);
    expect(body).not.toContain('127.0.0.1'); expect(body).not.toContain('private-test-key');
  });
  it('旧单配置的显式超时迁移为默认版本，生产构建不依赖模型服务', () => {
    vi.stubEnv('LLM_TIMEOUT_MS', '800000');
    const api = createApiHandler();
    expect(api.engineRegistry.getProfile('default-llm').parameters.options.timeoutMs).toBe(800000);
  });
  it('改动文件参数会产生新版本而不修改已取得的旧版本', async () => {
    const setup = configure(definitions); const before = await list(setup.api());
    writeFileSync(setup.path, JSON.stringify({ schemaVersion: 1, profiles: definitions.map(profile => profile.id === 'llm-a' ? { ...profile, options: { ...profile.options, model: 'new-model' } } : profile) }));
    const after = await list(setup.api());
    expect(after.profiles[1].version).not.toBe(before.profiles[1].version);
    expect(before.profiles[1].parameters.options.model).toBe('model-a');
    expect(after.profiles[2].version).toBe(before.profiles[2].version);
  });
});
