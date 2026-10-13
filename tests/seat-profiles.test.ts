/** 四座版本路由与历史追踪（SRP）：切换配置必须使旧决策失效。 */
import { describe, expect, it, vi } from 'vitest';
import { DecisionEngineManager } from '../src/ai/engines';
import { captureConfiguration } from '../src/history/capture';
import { makeProfile, parseProfilesFile } from '../src/ai/engines/profiles';
import { createGame, currentSeat, bid, declareTrump, bury, playCard, legalMoves } from '../src/engine';
import { EnginePlayerAgent } from '../src/ai/engines/engineAdapter';
import { DecisionLogger } from '../src/ai/engines/decisionLogger';
import { localProfileEngine } from '../src/ai/engines/localProfile';
import { smartBury } from '../src/ai/smart';
import { GameSession } from '../src/workbench/session';
import { RemoteDecisionEngine } from '../src/ai/engines/remoteEngine';

const profiles = parseProfilesFile({ schemaVersion: 1, profiles: [
  { id: 'fast-a', name: '快算甲', type: 'bridge', options: { mode: 'fast' } },
  { id: 'fast-b', name: '快算乙', type: 'bridge', options: { mode: 'fast', maxWorlds: 12 } },
] }).profiles.map(definition => makeProfile(definition, definition.options));

describe('四座配置与历史一致', () => {
  it('四座分别选择 Human 和同类不同配置，实例独立；南北 A 对东西 B 正确记录', () => {
    const manager = new DecisionEngineManager({ useServerDecision: true });
    manager.setProfiles(profiles);
    manager.assignTeams(profiles[0].profileId, profiles[1].profileId);
    const captured = captureConfiguration(manager, false);
    expect(captured.seats.map(seat => seat.profileVersionId)).toEqual([profiles[1].profileVersionId, profiles[0].profileVersionId, profiles[1].profileVersionId, profiles[0].profileVersionId]);
    expect(manager.getAgentForSeat(0)).not.toBe(manager.getAgentForSeat(1));
    expect(manager.getAgentForSeat(0).getEngine()).not.toBe(manager.getAgentForSeat(1).getEngine());
    manager.assignSeat(0, 'human');
    expect(captureConfiguration(manager, false).seats[0].kind).toBe('human');
  });
  it('Human 的提示使用可追溯的配置，保持人工身份且采集该提示版本', () => {
    const manager = new DecisionEngineManager(); manager.setProfiles(profiles);
    for (let seat = 0; seat < 4; seat++) manager.assignSeat(seat, 'human');
    const agent = manager.getAgentForSeat(1);
    expect(agent.getEngine().profileReference).toEqual({ profileId: profiles[0].profileId, version: profiles[0].version });
    const captured = captureConfiguration(manager, false);
    expect(captured.seats.every(seat => seat.kind === 'human')).toBe(true);
    expect(captured.profiles.some(profile => profile.profileVersionId === profiles[0].profileVersionId)).toBe(true);
  });
  it('更换当前文件只更新目录，正在使用的版本仍冻结', () => {
    const manager = new DecisionEngineManager(); manager.setProfiles(profiles); manager.assignSeat(0, 'fast-a');
    const next = makeProfile({ id: 'fast-a', name: '新快算', type: 'bridge', options: {} }, { ...profiles[0].parameters.options, timeLimitMs: 50 });
    manager.setProfiles([next, profiles[1]]);
    expect(captureConfiguration(manager, false).seats[0].profileVersionId).toBe(profiles[0].profileVersionId);
    manager.assignSeat(0, 'fast-a'); expect(captureConfiguration(manager, false).seats[0].profileVersionId).toBe(next.profileVersionId);
  });
  it('新副开始采用当前目录版本，旧副参数不被回写', () => {
    const manager = new DecisionEngineManager(); manager.setProfiles(profiles); manager.assignSeat(0, 'fast-a');
    const next = makeProfile({ id: 'fast-a', name: '新快算', type: 'bridge', options: {} }, { ...profiles[0].parameters.options, timeLimitMs: 50 });
    manager.setProfiles([next, profiles[1]]); manager.beginHand();
    expect(captureConfiguration(manager, false).seats[0].profileVersionId).toBe(next.profileVersionId);
    expect(manager.getProfileVersion(profiles[0].version)?.parameters.options.timeLimitMs).toBe(25);
  });
  it('远程决策带座位所选的版本，阶段观察不含暗牌和 seed', async () => {
    const manager = new DecisionEngineManager(); manager.setProfiles(profiles); manager.assignSeat(1, 'fast-b');
    const game = createGame(42); const seat = currentSeat(game); expect(seat).toBe(1);
    const fetched = vi.spyOn(globalThis, 'fetch').mockImplementation(async (_url, init) => {
      const body = JSON.parse(String(init?.body)); expect(body.profileId).toBe('fast-b'); expect(body.profileVersion).toBe(profiles[1].version);
      expect(body.observation).not.toHaveProperty('seed'); expect(body.observation).not.toHaveProperty('hands');
      return new Response(JSON.stringify({ success: true, action: { kind: 'bid', seat, bid: null }, engineType: 'bridge', latencyMs: 1, actualProfile: { profileId: 'fast-b', version: profiles[1].version } }));
    });
    try { await manager.getAgentForSeat(seat).nextActionAsync(game); expect(fetched).toHaveBeenCalledOnce(); } finally { fetched.mockRestore(); }
  });
  it('本地唯一合法候选也记录所选配置与确定性来源，不猜成其他同类型实例', async () => {
    const definition = parseProfilesFile({ schemaVersion: 1, profiles: [{ id: 'unique-algorithm', name: '本地算法', type: 'algorithm', options: {} }] }).profiles[0];
    const profile = makeProfile(definition, definition.options, undefined, 'local'); const logger = new DecisionLogger();
    const agent = new EnginePlayerAgent({ engine: localProfileEngine(profile), logger });
    let game = createGame(42); const declarer = currentSeat(game);
    for (let i = 0; i < 4; i++) game = bid(game, currentSeat(game), i === 0 ? 70 : null);
    game = declareTrump(game, declarer, 'S'); game = bury(game, declarer, smartBury(game, declarer));
    for (let count = 0; count < 48 && game.phase === 'playing' && legalMoves(game, currentSeat(game)).length > 1; count++) game = playCard(game, currentSeat(game), legalMoves(game, currentSeat(game))[0]);
    expect(game.phase).toBe('playing'); expect(legalMoves(game, currentSeat(game))).toHaveLength(1);
    await agent.nextActionAsync(game);
    expect(logger.getRecords()[0]).toMatchObject({ engineType: 'algorithm', actualProfile: { profileId: profile.profileId, version: profile.version }, requestedProfile: { profileId: profile.profileId, version: profile.version }, decisionSource: 'deterministic' });
  });
  it('适配器最终回退仍保存请求版本与实际备用版本，不能被备用身份覆盖', async () => {
    const logger = new DecisionLogger(); const ref = { profileId: profiles[0].profileId, version: profiles[0].version };
    const agent = new EnginePlayerAgent({ engine: { type: 'bridge', profileReference: ref, chooseCard: vi.fn().mockRejectedValue(new Error('显式计算失败')), chooseAction: vi.fn().mockRejectedValue(new Error('显式计算失败')) }, fallbackEngine: localProfileEngine(profiles[1]), logger });
    await agent.nextActionAsync(createGame(42));
    expect(logger.getRecords()[0]).toMatchObject({ requestedProfile: ref, actualProfile: { profileId: profiles[1].profileId, version: profiles[1].version }, fallbackChain: [{ profile: ref, reason: '显式计算失败' }] });
  });
  it('切换座位配置取消旧请求，迟到结果不能进入动作路径', async () => {
    const manager = new DecisionEngineManager(); manager.setProfiles(profiles); manager.assignSeat(1, 'fast-a');
    const session = new GameSession(createGame(42)); const unsubscribe = manager.subscribe(() => session.configurationChanged());
    let release!: () => void; let received: AbortSignal | undefined;
    const stub = vi.spyOn(RemoteDecisionEngine.prototype, 'chooseAction').mockImplementation(async (observation, signal) => {
      received = signal; await new Promise<void>(resolve => { release = resolve; }); return { action: { kind: 'bid', seat: observation.seat, bid: null }, engineType: 'bridge', latencyMs: 1 };
    });
    try {
      const pending = session.evaluate(manager.getAgentForSeat(1), 'auto'); await Promise.resolve(); manager.assignSeat(1, 'fast-b');
      expect(received?.aborted).toBe(true); release(); expect(await pending).toBeNull(); expect(session.getReplay().commands).toHaveLength(0);
    } finally { stub.mockRestore(); unsubscribe(); }
  });
});
