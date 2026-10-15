/** 服务端配置文件存储（SRP / DIP）：解析环境引用，保留旧版本，编辑原子落盘。 */
import { readFileSync, writeFileSync, renameSync } from 'node:fs';
import { parseProfilesFile, makeProfile, type EngineProfile, type ProfilesFile, normalizeOptions, PROFILE_IMPLEMENTATION_VERSION, type ProfileDefinition } from '@yaozifen/ai-core/engines/profiles';
import { contentDigest } from '@yaozifen/protocol/json';

export interface ResolvedProfile { profile: EngineProfile; baseUrl?: string; apiKey?: string }
export class ProfileStore {
  private current: ResolvedProfile[] = [];
  readonly versions = new Map<string, ResolvedProfile>();
  constructor(private readonly defaults: ProfilesFile, private readonly env: Record<string, string | undefined>, readonly path?: string) {
    this.reload();
  }
  private resolve(file: ProfilesFile): ResolvedProfile[] {
    const result = new Map<string, ResolvedProfile>();
    const build = (definition: ProfileDefinition): ResolvedProfile => {
      const existing = result.get(definition.id); if (existing) return existing;
      const fallback = definition.fallbackProfileId ? build(file.profiles.find(profile => profile.id === definition.fallbackProfileId)!).profile : undefined;
      const options = { ...definition.options }; let baseUrl: string | undefined; let apiKey: string | undefined;
      if (definition.type === 'llm' || definition.type === 'laya') {
        baseUrl = this.env[String(options.baseUrlEnv)];
        if (!baseUrl && ['LLM_BASE_URL', 'LAYA_BASE_URL'].includes(String(options.baseUrlEnv))) baseUrl = definition.type === 'llm' ? 'http://127.0.0.1:8000/v1' : 'http://127.0.0.1:11435';
        if (!baseUrl) throw new Error(`引擎配置 ${definition.id} 缺少服务环境变量`);
        const url = new URL(baseUrl); if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.search || url.hash) throw new Error('引擎服务地址无效或包含凭据');
        baseUrl = baseUrl.replace(/\/+$/, ''); apiKey = this.env[String(options.apiKeyEnv)];
        options.serviceId = contentDigest(baseUrl);
      }
      const profile = makeProfile(definition, options, fallback ? { profileId: fallback.profileId, version: fallback.version } : undefined);
      const resolved = { profile, baseUrl, apiKey }; result.set(definition.id, resolved); return resolved;
    };
    return file.profiles.map(build);
  }
  reload(): EngineProfile[] {
    const file = this.path ? parseProfilesFile(JSON.parse(readFileSync(this.path, 'utf8'))) : parseProfilesFile(this.defaults);
    const current = this.resolve(file);
    this.current = current;
    for (const resolved of current) this.versions.set(resolved.profile.version, resolved);
    return this.list();
  }
  list(): EngineProfile[] { return structuredClone(this.current.map(value => value.profile)); }
  get(id: string, version?: string): ResolvedProfile {
    const resolved = version ? this.versions.get(version) : this.current.find(value => value.profile.profileId === id);
    if (!resolved || resolved.profile.profileId !== id) throw new Error('引擎配置或版本不存在');
    return resolved;
  }
  restore(input: import('@yaozifen/protocol/contracts').ProfileVersionInput): EngineProfile {
    if (input.implementationVersion !== PROFILE_IMPLEMENTATION_VERSION || !['llm','laya','bridge','algorithm'].includes(input.type)) throw new Error('历史引擎实现版本不兼容');
    const profile = input as EngineProfile;
    const { serviceId, ...options } = profile.parameters.options;
    const definition: ProfileDefinition = { id: profile.profileId, name: profile.name, type: profile.type, options: normalizeOptions(profile.type, options) };
    const checked = parseProfilesFile({ schemaVersion: 1, profiles: [definition] }).profiles[0];
    const resolved = this.resolve({ schemaVersion: 1, profiles: [checked] })[0];
    if (serviceId !== resolved.profile.parameters.options.serviceId) throw new Error('历史服务端点已变化，无法恢复旧配置');
    const expected = makeProfile(checked, resolved.profile.parameters.options, profile.parameters.fallback, profile.parameters.execution);
    if (expected.configHash !== profile.configHash || expected.version !== profile.version || expected.profileVersionId !== profile.profileVersionId) throw new Error('历史配置指纹校验失败');
    const restored = { ...resolved, profile: expected }; this.versions.set(expected.version, restored); return structuredClone(expected);
  }
  edit(id: string, name: string, options: unknown, expectedVersion?: string): EngineProfile[] {
    if (!this.path) throw new Error('参数编辑需要在 .env 设置 ENGINE_PROFILES_PATH');
    const latest = parseProfilesFile(JSON.parse(readFileSync(this.path, 'utf8')));
    const resolved = this.resolve(latest);
    if (expectedVersion && resolved.find(value => value.profile.profileId === id)?.profile.version !== expectedVersion) throw new Error('配置目录已变化，请重新加载后编辑');
    if (!latest.profiles.some(profile => profile.id === id)) throw new Error('引擎配置不存在');
    const file = parseProfilesFile({ schemaVersion: 1, profiles: latest.profiles.map(profile => profile.id === id ? { ...profile, name, options } : profile) });
    const current = this.resolve(file);
    const temporary = `${this.path}.tmp`; writeFileSync(temporary, JSON.stringify(file, null, 2) + '\n', { mode: 0o600 }); renameSync(temporary, this.path);
    this.current = current;
    for (const resolved of current) this.versions.set(resolved.profile.version, resolved);
    return this.list();
  }
}
