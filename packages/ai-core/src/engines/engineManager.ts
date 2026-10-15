/**
 * 决策引擎组合根（DIP）：装配实例与座位路由，公开门面独立导出。
 */
import { AlgorithmEngine } from './algorithmEngine';
import { BridgeEngine } from '../bridge/bridgeEngine';
import { DecisionEngine, EngineType } from './engineTypes';
import { LayaEngine, LayaEngineOptions } from './layaEngine';
import { LlmEngine, LlmEngineOptions } from './llmEngine';
import { RemoteDecisionEngine } from './remoteEngine';
import { EnginePlayerAgent } from './engineAdapter';
import { decisionLogger } from './decisionLogger';
import { localProfileEngine } from './localProfile';
import { makeProfile, normalizeOptions, type EngineProfile, type SeatRoute } from './profiles';
import type { ProfileVersionInput } from '@yaozifen/protocol/contracts';
import { loadEngineSettings, applySettingsToManager } from './engineSettings';

export interface EngineManagerConfig {
  defaultType?: EngineType;
  useServerDecision?: boolean;
  layaOptions?: LayaEngineOptions;
  llmOptions?: LlmEngineOptions;
}

export class DecisionEngineManager {
  private profiles: EngineProfile[] = [];
  private readonly versions = new Map<string, EngineProfile>();
  private routes: SeatRoute[] | undefined;
  private readonly evaluatedVersions = new Set<string>();
  private readonly seatAgents = new Map<string, EnginePlayerAgent>();
  private listeners = new Set<() => void>();
  private activeType: EngineType;
  private useServerDecision: boolean;
  private readonly bridgeEngine: BridgeEngine;
  private readonly algorithmEngine: AlgorithmEngine;
  private layaEngine: LayaEngine;
  private llmEngine: LlmEngine;
  private remoteEngine: RemoteDecisionEngine;
  private readonly agent: EnginePlayerAgent;

  constructor(config: EngineManagerConfig = {}) {
    this.activeType = config.defaultType ?? 'bridge';
    this.useServerDecision = config.useServerDecision ?? true;
    this.bridgeEngine = new BridgeEngine();
    this.algorithmEngine = new AlgorithmEngine();
    this.layaEngine = new LayaEngine(config.layaOptions);
    this.llmEngine = new LlmEngine(config.llmOptions);
    this.remoteEngine = new RemoteDecisionEngine({
      targetEngineType: this.activeType,
      fallbackEngine: this.bridgeEngine,
    });

    const active = this.useServerDecision
      ? this.remoteEngine
      : this.getEngine(this.activeType);

    this.agent = new EnginePlayerAgent({
      engine: active,
      fallbackEngine: this.bridgeEngine,
      logger: decisionLogger,
    });
    this.refresh();
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => { this.listeners.delete(listener); };
  }

  private refresh(): void {
    this.seatAgents.clear();
    this.evaluatedVersions.clear();
    const { model, timeoutMs, protocol, responseFormat, reasoningEffort } = this.llmEngine.getOptions();
    this.remoteEngine = new RemoteDecisionEngine({ targetEngineType: this.activeType,
      fallbackEngine: this.bridgeEngine, timeoutMs: (timeoutMs ?? 60000) + 5000,
      decisionOptions: this.activeType === 'llm' ? { model, timeoutMs, protocol, responseFormat, reasoningEffort } : undefined });
    this.agent.setEngine(this.useServerDecision ? this.remoteEngine : this.getEngine(this.activeType));
    this.listeners.forEach(listener => listener());
  }

  isUseServerDecision(): boolean {
    return this.useServerDecision;
  }

  setUseServerDecision(enabled: boolean): void {
    this.useServerDecision = enabled;
    if (!enabled && this.routes) {
      this.profiles = this.profiles.filter(profile => ['bridge','algorithm'].includes(profile.type)).map(profile => this.forLocalMode(profile));
      const defaultProfile = this.profiles[0];
      this.routes = this.routes.map(route => {
        if (route === 'human') return route;
        const selected = this.versions.get(route.version);
        const local = selected && ['bridge','algorithm'].includes(selected.type) ? this.forLocalMode(selected) : defaultProfile;
        return local ? { profileId: local.profileId, version: local.version } : route;
      });
    }
    this.refresh();
  }

  getActiveType(): EngineType {
    return this.activeType;
  }

  setActiveType(type: EngineType): void {
    this.activeType = type;
    if (this.routes) {
      const profile = this.profiles.find(value => value.type === type);
      if (profile) this.routes = this.routes.map(route => route === 'human' ? route : { profileId: profile.profileId, version: profile.version });
    }
    this.refresh();
  }

  updateLlmOptions(options: Partial<LlmEngineOptions>): void {
    const { client: _client, ...base } = this.llmEngine.getOptions();
    this.llmEngine = new LlmEngine({ ...base, ...options });
    this.refresh();
  }

  updateLayaOptions(options: Partial<LayaEngineOptions>): void {
    this.layaEngine = new LayaEngine({ ...this.layaEngine.getOptions(), ...options });
    this.refresh();
  }

  getLlmOptions(): LlmEngineOptions {
    return this.llmEngine.getOptions();
  }

  getLayaOptions(): LayaEngineOptions {
    return this.layaEngine.getOptions();
  }

  getEngine(type: EngineType): DecisionEngine {
    switch (type) {
      case 'bridge':
        return this.bridgeEngine;
      case 'algorithm':
        return this.algorithmEngine;
      case 'laya':
        return this.layaEngine;
      case 'llm':
        return this.llmEngine;
    }
  }

  getRemoteEngine(): RemoteDecisionEngine {
    return this.remoteEngine;
  }

  private forLocalMode(profile: EngineProfile): EngineProfile {
    if (profile.parameters.execution === 'local') return profile;
    const local = makeProfile({ id: profile.profileId, name: profile.name, type: profile.type, options: profile.parameters.options }, profile.parameters.options, undefined, 'local');
    this.versions.set(local.version, local); return local;
  }
  setProfiles(profiles: EngineProfile[]): void {
    profiles = this.useServerDecision ? profiles : profiles.filter(profile => ['bridge','algorithm'].includes(profile.type)).map(profile => this.forLocalMode(profile));
    this.profiles = structuredClone(profiles);
    for (const profile of profiles) this.versions.set(profile.version, structuredClone(profile));
    if (!this.routes && profiles.length) {
      const selected = profiles.find(profile => profile.profileId === `default-${this.activeType}`) ?? profiles.find(profile => profile.type === this.activeType) ?? profiles[0];
      this.routes = [0,1,2,3].map(seat => seat === 1 ? 'human' : { profileId: selected.profileId, version: selected.version });
    }
    this.refresh();
  }
  getProfiles(): EngineProfile[] { return structuredClone(this.profiles); }
  getSeatRoutes(): SeatRoute[] | undefined { return this.routes ? structuredClone(this.routes) : undefined; }
  isHumanSeat(seat: number): boolean { return this.routes ? this.routes[seat] === 'human' : seat === 1; }
  assignSeat(seat: number, id: string): void {
    if (!this.routes || !Number.isInteger(seat) || seat < 0 || seat > 3) throw new Error('座位配置尚未加载或座位无效');
    const profile = this.profiles.find(value => value.profileId === id);
    if (id !== 'human' && !profile) throw new Error('引擎配置不存在');
    this.routes[seat] = profile ? { profileId: profile.profileId, version: profile.version } : 'human';
    this.refresh();
  }
  assignTeams(southNorth: string, eastWest: string): void {
    const a = this.profiles.find(value => value.profileId === southNorth); const b = this.profiles.find(value => value.profileId === eastWest);
    if (!a || !b) throw new Error('阵营配置不存在');
    this.routes = [b,a,b,a].map(profile => ({ profileId: profile.profileId, version: profile.version })); this.refresh();
  }
  beginHand(): void {
    if (!this.routes) return;
    this.routes = this.routes.map(route => {
      if (route === 'human') return route;
      const latest = this.profiles.find(profile => profile.profileId === route.profileId);
      return latest ? { profileId: latest.profileId, version: latest.version } : route;
    });
    this.refresh();
  }
  restoreProfiles(profiles: EngineProfile[], routes: SeatRoute[]): void {
    if (routes.length !== 4) throw new Error('四座配置不完整');
    for (const profile of profiles) this.versions.set(profile.version, structuredClone(profile));
    for (const route of routes) if (route !== 'human' && this.versions.get(route.version)?.profileId !== route.profileId) throw new Error('历史座位配置缺失');
    this.routes = structuredClone(routes); this.refresh();
  }
  getProfileVersion(version: string): EngineProfile | undefined { const profile = this.versions.get(version); return profile ? structuredClone(profile) : undefined; }
  getHistoryProfiles(): ProfileVersionInput[] {
    const result = new Map<string, EngineProfile>();
    const include = (version: string) => { const profile = this.versions.get(version); if (!profile || result.has(version)) return; result.set(version, profile); if (profile.parameters.fallback) include(profile.parameters.fallback.version); };
    this.routes?.forEach(route => { if (route !== 'human') include(route.version); });
    this.evaluatedVersions.forEach(include);
    for (const profile of this.versions.values()) if (profile.profileId === 'offline-bridge') result.set(profile.version, profile);
    return structuredClone([...result.values()]);
  }
  getAgentForSeat(seat: number): EnginePlayerAgent {
    let route = this.routes?.[seat];
    if (!route) return this.agent;
    if (route === 'human') {
      const selected = this.profiles.find(profile => profile.type === this.activeType) ?? this.profiles[0];
      if (!selected) return this.agent;
      route = { profileId: selected.profileId, version: selected.version };
    }
    this.evaluatedVersions.add(route.version);
    const key = `${seat}:${route.version}:${this.useServerDecision}`;
    const cached = this.seatAgents.get(key); if (cached) return cached;
    const profile = this.versions.get(route.version); if (!profile) throw new Error('座位配置版本缺失');
    const definition = { id: 'offline-bridge', name: '本地备用推演', type: 'bridge' as const, options: normalizeOptions('bridge', {}) };
    const backupProfile = makeProfile(definition, definition.options, undefined, 'local');
    this.versions.set(backupProfile.version, backupProfile);
    const backup = localProfileEngine(backupProfile);
    const engine = this.useServerDecision && profile.parameters.execution === 'server' ? new RemoteDecisionEngine({ targetEngineType: profile.type, profile: route, totalBudgetMs: Math.min(3600000, Number(profile.parameters.options.timeoutMs ?? profile.parameters.options.timeLimitMs ?? 60000) + 1500), fallbackEngine: backup }) : localProfileEngine(profile);
    const agent = new EnginePlayerAgent({ engine, fallbackEngine: backup, logger: decisionLogger });
    this.seatAgents.set(key, agent); return agent;
  }

  getAgent(): EnginePlayerAgent {
    return this.agent;
  }
}

export const defaultEngineManager = new DecisionEngineManager();
applySettingsToManager(loadEngineSettings(), defaultEngineManager);
