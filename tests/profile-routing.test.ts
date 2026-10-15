/** HTTP 配置路由与执行归因（DIP）：用真实引擎和显式注入客户端验证隔离与失败。 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ServerEngineRegistry } from '@yaozifen/server/engines/serverEngineRegistry';
import { DecisionService } from '@yaozifen/server/services/decisionService';
import { createGame, currentSeat, bid, declareTrump, bury, legalMoves } from '@yaozifen/game-core';
import { observeBidding, observeDecision } from '@yaozifen/game-view/decisionObservation';
import type { DecisionRequest } from '@yaozifen/ai-core/engines/decisionProtocol';
import { smartBury } from '@yaozifen/ai-core/smart';
import { BridgeEngine } from '@yaozifen/ai-core/bridge/bridgeEngine';
import { LlmEngine } from '@yaozifen/ai-core/engines/llmEngine';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
const dirs: string[] = [];
afterEach(() => { dirs.splice(0).forEach(dir => rmSync(dir, { recursive: true, force: true })); vi.unstubAllGlobals(); vi.restoreAllMocks(); vi.useRealTimers(); });
function setup() {
  const dir = mkdtempSync(join(tmpdir(), 'routing-')); dirs.push(dir); const path = join(dir, 'profiles.json');
  writeFileSync(path, JSON.stringify({ schemaVersion: 1, profiles: [
    { id: 'small-search', name: '小预算', type: 'algorithm', options: { minWorlds: 2, maxWorlds: 2, timeLimitMs: 1000 } },
    { id: 'fast', name: '极速', type: 'bridge', options: { mode: 'fast' } },
    ...['a','b'].flatMap(id => [
      { id: `llm-${id}`, name: `分析${id}`, type: 'llm', options: { model: `model-${id}`, baseUrlEnv: `URL_${id.toUpperCase()}`, maxRetries: 0, maxConcurrency: 1 }, fallbackProfileId: 'fast' },
      { id: `one-${id}`, name: `策略${id}`, type: 'laya', options: { model: `one-${id}`, baseUrlEnv: `URL_${id.toUpperCase()}` }, fallbackProfileId: 'fast' },
    ]),
  ] }));
  const registry = new ServerEngineRegistry({ profilesPath: path, env: { URL_A: 'http://127.0.0.1:8761/v1', URL_B: 'http://127.0.0.1:8762/v1', LAYA_API_KEY: 'system-one-test-key' } });
  vi.spyOn((registry.get('llm') as LlmEngine).getClient(), 'complete').mockRejectedValue(new Error('显式阻止旧默认模型请求'));
  const service = new DecisionService(registry); const game = createGame(42); const seat = currentSeat(game);
  const request = (id: string): DecisionRequest => ({ engineType: registry.getProfile(id).type, profileId: id, profileVersion: registry.getProfile(id).version, requestId: `req-${id}`, totalBudgetMs: 1000, phase: 'bidding', seat, observation: observeBidding(game, seat) });
  return { registry, service, request, path };
}
describe('配置实例 HTTP 决策', () => {
  it('两个 LLM 的模型、端点与版本独立生效，旧 options 不能覆盖冻结配置', async () => {
    const { registry, service, request } = setup();
    for (const id of ['a','b']) {
      const profile = registry.getProfile(`llm-${id}`); const engine = registry.forProfile(profile.profileId, profile.version) as LlmEngine;
      expect(engine.getOptions().baseUrl).toContain(id === 'a' ? '8761' : '8762');
      const complete = vi.spyOn(engine.getClient(), 'complete').mockResolvedValue({ rawText: '{"bid":null,"thinking":"评估","conclusion":"不叫"}', requestBody: {}, latencyMs: 1 });
      const result = await service.processDecision({ ...request(profile.profileId), options: { model: 'intruder' } });
      expect(complete).toHaveBeenCalledWith(expect.objectContaining({ model: `model-${id}` }));
      expect(result).toMatchObject({ requestedProfile: { profileId: profile.profileId, version: profile.version }, actualProfile: { profileId: profile.profileId, version: profile.version }, requestId: `req-${profile.profileId}` });
    }
  });
  it('两个 System One 的 HTTP 请求不串模型或端点，扣底能力明确为启发式', async () => {
    const fetched = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) => new Response(JSON.stringify({ answers: { bid: { choice: 'pass' } } }), { status: 200 })); vi.stubGlobal('fetch', fetched);
    const { registry, service, request } = setup();
    await Promise.all(['a','b'].map(id => service.processDecision(request(`one-${id}`))));
    expect(fetched.mock.calls.map(call => String(call[0]))).toEqual(expect.arrayContaining(['http://127.0.0.1:8761/v1/v1/systemone', 'http://127.0.0.1:8762/v1/v1/systemone']));
    expect(fetched.mock.calls.map(call => JSON.parse(String(call[1]?.body)).model).sort()).toEqual(['one-a','one-b']);
    expect(fetched.mock.calls.every(call => new Headers(call[1]?.headers).get('Authorization') === 'Bearer system-one-test-key')).toBe(true);
    expect(JSON.stringify(registry.profiles.list())).not.toContain('system-one-test-key');
    expect(registry.getProfile('one-a').parameters.capabilities.bury).toBe('heuristic');
  });
  it('模型非法动作由显式备用配置执行，并记录真实回退链', async () => {
    const { registry, service, request } = setup(); const profile = registry.getProfile('llm-a');
    const engine = registry.forProfile(profile.profileId, profile.version) as LlmEngine;
    vi.spyOn(engine.getClient(), 'complete').mockResolvedValue({ rawText: '{"bid":999,"thinking":"错","conclusion":"错"}', requestBody: {}, latencyMs: 1 });
    const result = await service.processDecision(request('llm-a'));
    expect(result.actualProfile?.profileId).toBe('fast'); expect(result.fallbackChain).toHaveLength(1);
    expect(result.fallbackReason).toBeTruthy(); expect(result.engineType).toBe('bridge');
  });
  it('Algorithm 的实际服务端搜索受配置世界数限制，普通出牌观察仍隔离暗牌', async () => {
    const { registry, service } = setup(); const profile = registry.getProfile('small-search');
    let game = createGame(42); const declarer = currentSeat(game);
    for (let i = 0; i < 4; i++) game = bid(game, currentSeat(game), i === 0 ? 70 : null);
    game = declareTrump(game, declarer, 'S'); game = bury(game, declarer, smartBury(game, declarer));
    const seat = currentSeat(game); const observation = observeDecision(game, seat);
    if (observation.phase !== 'playing') throw new Error('测试必须进入出牌阶段');
    const result = await service.processDecision({ phase: 'playing', seat, engineType: 'algorithm', profileId: profile.profileId, profileVersion: profile.version, observation, candidates: legalMoves(game, seat), totalBudgetMs: 2000 });
    expect(result.decision?.worldsEvaluated).toBe(2); expect(result.actualProfile?.profileId).toBe('small-search');
    expect(observation).not.toHaveProperty('seed'); expect(observation).not.toHaveProperty('hands');
  });
  it('未知版本拒绝执行，不能静默使用当前配置', async () => {
    const { service, request } = setup(); await expect(service.processDecision({ ...request('llm-a'), profileVersion: 'missing' })).rejects.toThrow(/版本/);
  });
  it('同步计算阻塞定时器时也检查真实总耗时，超预算动作不能返回或回退', async () => {
    const { registry, service, request } = setup(); const profile = registry.getProfile('fast');
    let now = 0; vi.spyOn(performance, 'now').mockImplementation(() => now);
    const engine = registry.forProfile(profile.profileId, profile.version);
    if (!(engine instanceof BridgeEngine)) throw new Error('测试必须使用 Bridge 实例');
    vi.spyOn(engine, 'chooseBid').mockImplementation(async observation => {
      now = 20; return { action: { kind: 'bid', seat: observation.seat, bid: null }, engineType: 'bridge', latencyMs: 20 };
    });
    await expect(service.processDecision({ ...request('fast'), totalBudgetMs: 10 })).rejects.toThrow(/预算/);
  });
  it('总预算到期终止挂起请求，不应用迟到动作；主动取消不回退', async () => {
    vi.useFakeTimers(); const { registry, service, request } = setup(); const profile = registry.getProfile('llm-a');
    const engine = registry.forProfile(profile.profileId, profile.version) as LlmEngine;
    let received: AbortSignal | undefined;
    vi.spyOn(engine.getClient(), 'complete').mockImplementation(async input => { received = input.signal; return new Promise(() => {}); });
    const pending = service.processDecision({ ...request('llm-a'), totalBudgetMs: 20 });
    const assertion = expect(pending).rejects.toThrow(/预算/); await vi.advanceTimersByTimeAsync(21); await assertion; expect(received?.aborted).toBe(true);
    const controller = new AbortController(); const cancelled = service.processDecision(request('llm-a'), controller.signal);
    const cancelledAssertion = expect(cancelled).rejects.toThrow('人工取消'); controller.abort(new Error('人工取消')); await cancelledAssertion;
  });
});
