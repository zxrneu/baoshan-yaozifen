/** 配置搜索预算、排队取消与信息隔离（DIP）：显式故障和可控计时，不依赖在线服务。 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { LlmEngine } from '../src/ai/engines/llmEngine';
import { observeBidding } from '../src/ai/decisionObservation';
import { createGame, currentSeat } from '../src/engine';
import { createOptimizedSelector } from '../src/ai/optimized';
import { WorkerCardSelector } from '../src/ai/optimized/workerClient';
import { DecisionEngineManager } from '../src/ai/engines';
import { makeProfile, parseProfilesFile } from '../src/ai/engines/profiles';
import { captureConfiguration } from '../src/history/capture';
import type { PlayerObservation } from '../src/ai/optimized/contracts';
import { makeCard } from '../src/cards';
import { RemoteDecisionEngine } from '../src/ai/engines/remoteEngine';
import { BridgeEngine } from '../src/ai/bridge/bridgeEngine';

afterEach(() => { vi.restoreAllMocks(); vi.useRealTimers(); });
describe('配置与取消边界', () => {
  it('等待并发槽也受总超时控制，挂起客户端取消后释放槽位', async () => {
    vi.useFakeTimers(); const game = createGame(42); const observation = observeBidding(game, currentSeat(game));
    const complete = vi.fn().mockImplementationOnce(() => new Promise(() => {})).mockResolvedValue({ rawText: '{"bid":null,"thinking":"好","conclusion":"不叫"}', latencyMs: 1, requestBody: {} });
    const engine = new LlmEngine({ client: { complete }, maxConcurrency: 1, timeoutMs: 1000, enableFallbackOnFailure: false });
    const controller = new AbortController();
    const first = engine.chooseBid(observation, controller.signal); const firstRejected = expect(first).rejects.toThrow('取消挂起'); await Promise.resolve();
    engine.updateOptions({ timeoutMs: 20, client: { complete } });
    const second = engine.chooseBid(observation); const secondRejected = expect(second).rejects.toThrow(/超时/);
    await vi.advanceTimersByTimeAsync(21); await secondRejected; controller.abort(new Error('取消挂起')); await firstRejected;
    expect(complete).toHaveBeenCalledTimes(1); await expect(engine.chooseBid(observation)).resolves.toMatchObject({ action: { kind: 'bid', bid: null } });
    expect(complete).toHaveBeenCalledTimes(2);
  });
  it('Algorithm 本地 Worker 与服务端搜索使用同一完整预算，本地历史记录实际执行位置', async () => {
    const definition = parseProfilesFile({ schemaVersion: 1, profiles: [{ id: 'small', name: '少量搜索', type: 'algorithm', options: { minWorlds: 1, maxWorlds: 2, timeLimitMs: 1000 } }] }).profiles[0];
    const manager = new DecisionEngineManager({ useServerDecision: false }); manager.setProfiles([makeProfile(definition, definition.options)]); manager.assignSeat(0, 'small');
    const captured = captureConfiguration(manager, false); expect(captured.profiles[0].parameters.execution).toBe('local');
    const observation: PlayerObservation = { seat: 0, ownHand: [makeCard('S','2'), makeCard('S','3')], handCounts: [2,2,2,2], declarer: 0, bid: 70, trump: 'S', leader: 0, roundNumber: 1, currentRound: [], completedRounds: [], voidSuits: [[],[],[],[]], declarerPoints: 0, defenderPoints: 0, kittySize: 4, ruleId: 'basic-v1' };
    const worker = vi.spyOn(WorkerCardSelector.prototype, 'choose').mockResolvedValue({ card: observation.ownHand[0], status: 'budget', worlds: 2, elapsedMs: 0, moves: [], comparisons: [] });
    await manager.getAgentForSeat(0).getEngine().chooseCard(observation, observation.ownHand);
    expect(worker).toHaveBeenCalledOnce();
    const search = createOptimizedSelector({ budget: definition.options, dependencies: { now: () => 0 } });
    expect(search.choose(observation).worlds).toBeLessThanOrEqual(2);
  });
  it('远程请求忽略 signal 并迟到时，外部取消仍立即结束，不能返回迟到动作', async () => {
    let release!: () => void; const fetched = vi.fn(() => new Promise<Response>(resolve => { release = () => resolve(new Response(JSON.stringify({ success: true, action: { kind: 'bid', seat: 1, bid: null }, engineType: 'bridge', latencyMs: 0 }))); }));
    const fallback = new BridgeEngine(); const backup = vi.spyOn(fallback, 'chooseAction');
    const engine = new RemoteDecisionEngine({ targetEngineType: 'bridge', fetchFn: fetched, fallbackEngine: fallback });
    const game = createGame(42); const controller = new AbortController();
    const promise = engine.chooseAction(observeBidding(game, 1), controller.signal); const rejected = expect(promise).rejects.toThrow('取消迟到');
    controller.abort(new Error('取消迟到')); release(); await rejected; expect(backup).not.toHaveBeenCalled();
  });
});
