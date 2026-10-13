/** 模拟边界回归（DIP）：注入决策故障、取消和临时数据库，验证隔离与恢复。 */
import { afterEach, expect, it, vi } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { SqliteHistoryRepository } from '../server/history/sqliteRepository';
import { ServerEngineRegistry } from '../server/engines/serverEngineRegistry';
import { SimulationService, failureKind } from '../server/history/simulationService';
import { DecisionService } from '../server/services/decisionService';
import { makeProfile, normalizeOptions } from '../src/ai/engines/profiles';
import { OpenAiSdkClient } from '../src/ai/engines/llm/llmClient';
import { observeBidding } from '../src/ai/decisionObservation';
import { createGame, currentSeat } from '../src/engine';
import { historyDetail } from '../server/history/http';
import { validatedReplay } from '../src/history/replay';
import { decisionLogger as defaultDecisionLogger } from '../src/ai/engines/decisionLogger';
import { historyPlayingState } from './fixtures/history';
import type { DecisionObservation } from '../src/ai/decisionObservation';
import { applyAiAction } from '../src/ai/applyAction';
import type { SimulationRequest } from '../src/history/simulation';
const repos: SqliteHistoryRepository[] = [];
const dirs: string[] = [];
afterEach(() => { repos.forEach(repo => repo.close()); dirs.forEach(dir => rmSync(dir, { recursive: true, force: true })); vi.restoreAllMocks(); });
function setup(path = ':memory:') {
    const repo = new SqliteHistoryRepository({ path });
    repos.push(repo);
    const registry = new ServerEngineRegistry();
    registry.setProfileLoader(id => repo.getProfileVersion(id));
    const definition = { id: 'fast', name: '极速测试', type: 'bridge' as const, options: { mode: 'fast' } };
    const profile = makeProfile(definition, normalizeOptions('bridge', definition.options));
    registry.profiles.versions.set(profile.version, { profile });
    const ref = { profileId: profile.profileId, version: profile.version };
    const decisions = new DecisionService(registry);
    const service = new SimulationService(() => repo, registry, decisions);
    const input: SimulationRequest = { seeds: [731], seats: [ref, ref, ref, ref], mode: 'lifecycle', decisionBudgetMs: 1000, runBudgetMs: 30000, concurrency: 1, maxActions: 512, maxRedeals: 3 };
    return { repo, registry, service, decisions, input, profile, ref };
}
it('从历史节点冻结四座配置创建独立分支，原路径及全局日志不变，100分明牌随动作同步', async () => {
    const { repo, service, input, decisions } = setup();
    const state = historyPlayingState(100);
    repo.writeHistory({ protocolVersion: 2, match: { matchId: 'm', source: 'human', targetWins: 5, startedAt: 1 }, hand: { handId: 'h', matchId: 'm', handIndex: 0, startSnapshot: state, startedAt: 1 }, branch: { branchId: 'b', handId: 'h', name: '原路径', createdAt: 1 } });
    const command = { kind: 'play' as const, seat: currentSeat(state), card: state.hands[currentSeat(state)][0] };
    repo.recordCommit({ matchId: 'm', node: { nodeId: 'n', branchId: 'b', seq: 0, source: 'human', command, state: applyAiAction(state, command), createdAt: 2 } });
    const original = historyDetail(repo, 'h');
    const global = defaultDecisionLogger.getRecords();
    const observed: DecisionObservation[] = [];
    const process = decisions.processDecision.bind(decisions);
    vi.spyOn(decisions, 'processDecision').mockImplementation(async (req, signal) => { observed.push({ ...req.observation, phase: req.phase } as DecisionObservation); return process(req, signal); });
    const request = { ...input, source: { handId: 'h', nodeId: 'n' } };
    const started = service.start(request);
    request.seats[0] = { profileId: 'changed', version: 'changed' };
    const report = await service.wait(started.runId);
    expect(report.status).toBe('completed');
    expect(report.boards[0].games).toHaveLength(1);
    const branch = repo.getBranch(report.boards[0].games[0].branchId)!;
    expect(branch.sourceNodeId).toBe('n');
    expect(branch.kind).toBe('branch');
    const detail = validatedReplay(historyDetail(repo, 'h'));
    expect(detail.branches.find(item => item.branchId === 'b')).toEqual(original.branches[0]);
    expect(detail.hand).toEqual(original.hand);
    expect(defaultDecisionLogger.getRecords()).toEqual(global);
    expect(observed.length).toBeGreaterThan(0);
    for (const observation of observed) {
        expect(observation).not.toHaveProperty('seed');
        expect(observation).not.toHaveProperty('hands');
        if (observation.phase === 'playing') {
            expect(observation.revealedHand).toBeDefined();
            expect(observation.revealedHand!.cards).toHaveLength(observation.handCounts[observation.revealedHand!.seat]);
        }
    }
});
it('固定前三阶段使用共同配置，两局保存相同合同与起手，报告单独标识协议', async () => {
    const { repo, service, input, ref } = setup();
    const started = service.start({ ...input, mode: 'fixed', fixedProfile: ref });
    const report = await service.wait(started.runId);
    expect(report.status).toBe('completed');
    expect(report.request.mode).toBe('fixed');
    const games = report.boards[0].games.map(game => historyDetail(repo, game.handId));
    const starts = games.map(detail => detail.nodes.find(node => node.command.kind === 'bury')!.state);
    expect(starts[0]).toEqual(starts[1]);
    expect(report.summary.interval.groups).toBe(1);
});
it('取消挂起请求忽略迟到动作，重启续跑沿已提交游标且组与副牌不重复', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'simulation-'));
    dirs.push(dir);
    const path = join(dir, 'history.sqlite');
    const { repo, service, input, decisions } = setup(path);
    let release!: () => void;
    let entered!: () => void;
    const called = new Promise<void>(resolve => { entered = resolve; });
    const original = decisions.processDecision.bind(decisions);
    let calls = 0;
    vi.spyOn(decisions, 'processDecision').mockImplementation(async (req, signal) => {
        calls++;
        if (calls === 2) {
            entered();
            await new Promise<void>(resolve => { release = resolve; });
        }
        return original(req, signal);
    });
    const started = service.start(input);
    await called;
    const cancel = service.cancel(started.runId);
    release();
    const stopped = await cancel;
    expect(stopped.status).toBe('cancelled');
    expect(repo.listActionNodes(stopped.boards[0].games[0].branchId)).toHaveLength(1);
    repo.close();
    const reopened = setup(path);
    reopened.service.resume(started.runId);
    const resumed = await reopened.service.wait(started.runId);
    expect(resumed.status).toBe('completed');
    expect(resumed.boards).toHaveLength(1);
    expect(reopened.repo.listMatches({ source: 'simulation' })).toHaveLength(2);
    const before = resumed.boards.map(board => board.games.map(game => game.actions));
    reopened.service.resume(started.runId);
    expect((await reopened.service.wait(started.runId)).boards.map(board => board.games.map(game => game.actions))).toEqual(before);
});
it('无动作连接失败单列故障，实际备用调用归因且不算原生非法输出', async () => {
    const { service, input, decisions } = setup();
    vi.spyOn(decisions, 'processDecision').mockRejectedValue(new TypeError('fetch failed'));
    const report = await service.wait(service.start(input).runId);
    expect(report.status).toBe('failed');
    expect(report.summary.faults.network).toBe(2);
    expect(report.summary.faults.illegal).toBe(0);
    expect(report.summary.aWins + report.summary.bWins).toBe(0);
    expect(report.summary.decisions.nativeIllegal).toBe(0);
    expect(report.summary.decisions.noActionFailures).toBe(2);
});
it('总预算能结束忽略取消信号的挂起决策并保留失败进度', async () => {
    const { service, input, decisions } = setup();
    vi.spyOn(decisions, 'processDecision').mockImplementation(() => new Promise(() => { }));
    const report = await service.wait(service.start({ ...input, runBudgetMs: 30 }).runId);
    expect(report.status).toBe('failed');
    expect(report.summary.faults.timeout).toBe(1);
}, 1000);
it('全员不叫记录每次重发，超上限终止且不强制合同', async () => {
    const { service, input, decisions, repo } = setup();
    vi.spyOn(decisions, 'processDecision').mockImplementation(async (req) => ({ success: true, action: { kind: 'bid', seat: req.seat, bid: null }, latencyMs: 0, engineType: 'bridge', executionEnvironment: 'server' }));
    const report = await service.wait(service.start({ ...input, maxRedeals: 1 }).runId);
    expect(report.status).toBe('failed');
    expect(report.boards[0].games.every(game => game.redeals === 2)).toBe(true);
    expect(report.boards[0].games.every(game => repo.listActionNodes(game.branchId).every(node => node.command.kind === 'bid' && node.command.bid === null))).toBe(true);
});
it('参数总量、未知版本和重复种子在创建记录前拒绝', () => {
    const { service, input, repo } = setup();
    expect(() => service.start({ ...input, seeds: [731, 731] })).toThrow();
    expect(() => service.start({ ...input, concurrency: 9 })).toThrow();
    expect(() => service.start({ ...input, seats: input.seats.map(ref => ({ ...ref, version: 'unknown' })) })).toThrow();
    expect(repo.listSimulationRuns()).toEqual([]);
});
it('原生非法后实际回退分别计数，网络失败不会混入原生非法分母', async () => {
    const { service, input, registry, profile } = setup();
    const definition = { id: 'native', name: '原生测试', type: 'llm' as const, options: {} };
    const primary = makeProfile(definition, normalizeOptions('llm', {}), { profileId: profile.profileId, version: profile.version });
    registry.profiles.versions.set(primary.version, { profile: primary, baseUrl: 'http://invalid.test' });
    const original = registry.forProfile.bind(registry);
    vi.spyOn(registry, 'forProfile').mockImplementation((id, version) => id === 'native' ? { type: 'llm', chooseCard: async () => { throw new TypeError('fetch failed'); }, chooseAction: async (obs) => ({ engineType: 'llm', latencyMs: 0, action: { kind: 'bid', seat: obs.seat, bid: 65 } }) } : original(id, version));
    const ref = { profileId: primary.profileId, version: primary.version };
    const report = await service.wait(service.start({ ...input, seats: [ref, ref, ref, ref] }).runId);
    expect(report.status).toBe('completed');
    expect(report.summary.decisions.actualFallbacks).toBeGreaterThan(0);
    expect(report.summary.decisions.nativeIllegal).toBeGreaterThan(0);
    expect(report.summary.decisions.fallbackFailures.network).toBeGreaterThan(0);
    expect(report.summary.decisions.sources.model).toBe(0);
});
it('全部备用失败保留每次尝试的归因，最后无动作失败与原生非法独立统计', async () => {
    const { service, input, registry, profile } = setup();
    const primary = makeProfile({ id: 'bad', name: '非法原生', type: 'llm', options: {} }, normalizeOptions('llm', {}), { profileId: profile.profileId, version: profile.version });
    registry.profiles.versions.set(primary.version, { profile: primary, baseUrl: 'http://invalid.test' });
    vi.spyOn(registry, 'forProfile').mockImplementation(id => id === 'bad' ? { type: 'llm', chooseCard: async () => { throw new Error('非法阶段动作'); }, chooseAction: async (obs) => ({ engineType: 'llm', latencyMs: 0, action: { kind: 'bid', seat: obs.seat, bid: 65 } }) } : { type: 'bridge', chooseCard: async () => { throw new TypeError('fetch failed'); }, chooseAction: async () => { throw new TypeError('fetch failed'); } });
    const ref = { profileId: primary.profileId, version: primary.version };
    const report = await service.wait(service.start({ ...input, seats: Array(4).fill(ref) }).runId);
    expect(report.status).toBe('failed');
    expect(report.summary.decisions.nativeIllegal).toBe(2);
    expect(report.summary.decisions.noActionFailures).toBe(2);
    expect(report.boards[0].faults.every(fault => fault.attempts?.length === 2)).toBe(true);
});
it('运行冻结源码与搜索随机协议，源码版本不符时拒绝混合续跑', async () => {
    const { repo, service, input } = setup();
    const report = await service.cancel(service.start(input).runId);
    expect(report.sourceHash).toMatch(/^sha256:/);
    expect(report.searchRandomProtocol).toBe('independent-seeded-v1');
    repo.saveSimulationRun({ ...repo.getSimulationRun(report.runId)!, sourceHash: 'sha256:changed' });
    expect(() => service.resume(report.runId)).toThrow('源码');
});
it('四座配置及换边真实路由，故障后的报告读取不依赖模型服务或旧端点恢复', async () => {
    const { service, input, registry, repo, profile } = setup();
    const seats = [0, 1, 2, 3].map(index => { const definition = { id: `seat${index}`, name: `座位${index}`, type: 'bridge' as const, options: { mode: 'fast' } }; const current = makeProfile(definition, normalizeOptions('bridge', definition.options)); registry.profiles.versions.set(current.version, { profile: current }); return { profileId: current.profileId, version: current.version }; });
    const failed = makeProfile({ id: 'model', name: '离线模型', type: 'llm', options: {} }, normalizeOptions('llm', {}), { profileId: profile.profileId, version: profile.version });
    registry.profiles.versions.set(failed.version, { profile: failed, baseUrl: 'http://invalid.test' });
    const original = registry.forProfile.bind(registry);
    vi.spyOn(registry, 'forProfile').mockImplementation((id, version, seed) => id === 'model' ? { type: 'llm', chooseCard: async () => { throw new TypeError('fetch failed'); }, chooseAction: async () => { throw new TypeError('fetch failed'); } } : original(id, version, seed));
    const report = await service.wait(service.start({ ...input, seats: [{ profileId: failed.profileId, version: failed.version }, ...seats.slice(1)] }).runId);
    expect(report.status).toBe('completed');
    const routes = [report.request.seats, [report.request.seats[1], report.request.seats[0], report.request.seats[3], report.request.seats[2]]];
    report.boards[0].games.forEach((game, index) => repo.listActionNodes(game.branchId).forEach(node => { const evaluation = repo.listEvaluations(node.nodeId)[0]; expect(evaluation.recommended).toMatchObject({ requestedProfile: routes[index][evaluation.seat] }); }));
    registry.profiles.versions.delete(failed.version);
    vi.spyOn(registry, 'getProfile').mockImplementation(() => { throw new Error('服务端点已变化'); });
    expect(() => service.report(report.runId)).not.toThrow();
});
it('固定前三阶段在座位历史中保存共同实际配置，扣底成功后切回四座出牌配置', async () => {
    const { service, input, registry, repo, ref } = setup();
    const definition = { id: 'opening', name: '共同开局', type: 'bridge' as const, options: { mode: 'fast' } };
    const opening = makeProfile(definition, normalizeOptions('bridge', definition.options));
    registry.profiles.versions.set(opening.version, { profile: opening });
    const report = await service.wait(service.start({ ...input, mode: 'fixed', fixedProfile: { profileId: opening.profileId, version: opening.version } }).runId);
    expect(report.status).toBe('completed');
    for (const game of report.boards[0].games) {
        const detail = historyDetail(repo, game.handId);
        expect(detail.assignments.filter(assignment => assignment.nodeId === null).every(assignment => assignment.profileVersionId === opening.profileVersionId)).toBe(true);
        const bury = detail.nodes.find(node => node.command.kind === 'bury')!;
        expect(detail.assignments.filter(assignment => assignment.nodeId === bury.nodeId).every(assignment => assignment.profileVersionId === ref.version.replace('sha256:', 'pv_'))).toBe(true);
    }
});
it('并发组发生持久化故障时终止其他挂起组，运行结束后不能继续提交', async () => {
    const { service, input, repo, decisions } = setup();
    let releaseFirst!: () => void;
    let secondEntered!: () => void;
    let secondSignal: AbortSignal | undefined;
    const secondReady = new Promise<void>(resolve => { secondEntered = resolve; });
    let calls = 0;
    vi.spyOn(decisions, 'processDecision').mockImplementation(async (req, signal) => {
        calls++;
        if (calls === 1)
            await new Promise<void>(resolve => { releaseFirst = resolve; });
        else {
            secondSignal = signal;
            secondEntered();
            await new Promise<void>(() => { });
        }
        return { success: true, engineType: 'bridge', latencyMs: 0, executionEnvironment: 'server', action: { kind: 'bid', seat: req.seat, bid: 70 } };
    });
    const save = repo.saveSimulationBoard.bind(repo);
    vi.spyOn(repo, 'saveSimulationBoard').mockImplementation(board => {
        if (board.index === 0 && board.games[0]?.actions === 1)
            throw new Error('注入磁盘写入失败');
        save(board);
    });
    const started = service.start({ ...input, seeds: [731, 732], concurrency: 2 });
    await secondReady;
    releaseFirst();
    const report = await service.wait(started.runId);
    expect(report.status).toBe('failed');
    expect(secondSignal?.aborted).toBe(true);
});
it('搜索seed不能绕过模型配置的共享并发槽，模型服务最大并发仍为一', async () => {
    const { registry } = setup();
    const definition = { id: 'serial-model', name: '串行模型', type: 'llm' as const, options: { maxConcurrency: 1 } };
    const profile = makeProfile(definition, normalizeOptions('llm', definition.options));
    registry.profiles.versions.set(profile.version, { profile, baseUrl: 'http://invalid.test' });
    let active = 0;
    let maximum = 0;
    let release!: () => void;
    let entered!: () => void;
    const gate = new Promise<void>(resolve => { release = resolve; });
    const ready = new Promise<void>(resolve => { entered = resolve; });
    vi.spyOn(OpenAiSdkClient.prototype, 'complete').mockImplementation(async () => { active++; maximum = Math.max(maximum, active); entered(); await gate; active--; return { rawText: '{"bid":null}', requestBody: {}, latencyMs: 0 }; });
    const state = createGame(731);
    const observation = observeBidding(state, currentSeat(state));
    const first = registry.forProfile(profile.profileId, profile.version, 11).chooseBid!(observation);
    await ready;
    const second = registry.forProfile(profile.profileId, profile.version, 22).chooseBid!(observation);
    await new Promise(resolve => setTimeout(resolve, 20));
    release();
    await Promise.all([first, second]);
    expect(maximum).toBe(1);
});
it('无动作失败将模拟副标记失败，历史节点续打失败不改原比赛状态', async () => {
    const { service, input, repo, decisions } = setup();
    vi.spyOn(decisions, 'processDecision').mockRejectedValue(new TypeError('fetch failed'));
    const report = await service.wait(service.start(input).runId);
    expect(report.boards[0].games.every(game => repo.getMatch(game.matchId)?.status === 'failed')).toBe(true);
});
it('备用模型真实合法输出进入原生输出分母，网络失败不占分母', async () => {
    const { service, input, registry, profile } = setup();
    const fast = registry.forProfile(profile.profileId, profile.version);
    const backup = makeProfile({ id: 'model-backup', name: '备用模型', type: 'llm', options: {} }, normalizeOptions('llm', {}));
    const primary = makeProfile({ id: 'model-primary', name: '断网模型', type: 'llm', options: {} }, normalizeOptions('llm', {}), { profileId: backup.profileId, version: backup.version });
    registry.profiles.versions.set(backup.version, { profile: backup, baseUrl: 'http://invalid.test' });
    registry.profiles.versions.set(primary.version, { profile: primary, baseUrl: 'http://invalid.test' });
    vi.spyOn(registry, 'forProfile').mockImplementation(id => id === primary.profileId ? { type: 'llm', chooseCard: async () => { throw new TypeError('fetch failed'); }, chooseAction: async () => { throw new TypeError('fetch failed'); } } : { type: 'llm', chooseCard: async (...args) => ({ ...await fast.chooseCard(...args), engineType: 'llm' }), chooseAction: async (...args) => ({ ...await fast.chooseAction!(...args), engineType: 'llm' }) });
    const ref = { profileId: primary.profileId, version: primary.version };
    const report = await service.wait(service.start({ ...input, seats: Array(4).fill(ref) }).runId);
    expect(report.status).toBe('completed');
    expect(report.summary.decisions.nativeModelLegal).toBeGreaterThan(0);
    expect(report.summary.decisions.nativeModelLegalRate).toBe(1);
});
it('结算动作成功但组摘要写入失败后续跑修复摘要与比赛状态，不重复决策', async () => {
    const { service, input, repo } = setup();
    const save = repo.saveSimulationBoard.bind(repo);
    let injected = false;
    vi.spyOn(repo, 'saveSimulationBoard').mockImplementation(board => { if (!injected && board.index === 0 && board.games[0] && repo.getHand(board.games[0].handId)?.result) {
        injected = true;
        throw new Error('注入结算后摘要失败');
    } save(board); });
    const started = service.start(input);
    const failed = await service.wait(started.runId);
    expect(failed.status).toBe('failed');
    const game = failed.boards[0].games[0];
    const actions = repo.listActionNodes(game.branchId).length;
    service.resume(started.runId);
    const report = await service.wait(started.runId);
    expect(report.status).toBe('completed');
    expect(repo.listActionNodes(game.branchId)).toHaveLength(actions);
    expect(repo.getMatch(game.matchId)?.status).toBe('completed');
});
it('System One 启发式扣底的非法动作不计入模型原生输出分母', async () => {
    const { service, input, registry, profile } = setup();
    const fast = registry.forProfile(profile.profileId, profile.version);
    const model = makeProfile({ id: 'systemone', name: '扣底边界', type: 'laya', options: {} }, normalizeOptions('laya', {}), { profileId: profile.profileId, version: profile.version });
    registry.profiles.versions.set(model.version, { profile: model, baseUrl: 'http://invalid.test' });
    const original = registry.forProfile.bind(registry);
    vi.spyOn(registry, 'forProfile').mockImplementation((id, version, seed) => id === model.profileId ? { type: 'laya', chooseCard: async (...args) => ({ ...await fast.chooseCard(...args), engineType: 'laya' }), chooseAction: async (observation, signal) => observation.phase === 'bury' ? { engineType: 'laya', latencyMs: 0, action: { kind: 'bury', seat: observation.seat, cards: [] } } : { ...await fast.chooseAction!(observation, signal), engineType: 'laya' } } : original(id, version, seed));
    const ref = { profileId: model.profileId, version: model.version };
    const report = await service.wait(service.start({ ...input, seats: Array(4).fill(ref) }).runId);
    expect(report.status).toBe('completed');
    expect(report.summary.decisions.nativeIllegal).toBe(2);
    expect(report.summary.decisions.nativeModelIllegal).toBe(0);
});
it('真实引擎的HTTP、格式缺失和违规扣底分别归因', () => {
    expect(failureKind(new Error('Laya 叫分请求失败 (503 unavailable)'))).toBe('http');
    expect(failureKind(new Error('Laya 返回格式无效：缺失 answers.play.choice'))).toBe('parse');
    expect(failureKind(new Error('LLM 扣底牌不在手牌中: AS'))).toBe('illegal');
    expect(failureKind(new Error('LLM 违规扣留分牌: A'))).toBe('illegal');
});
