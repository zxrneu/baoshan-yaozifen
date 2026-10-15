/** 独立模拟编排（SRP / DIP）：版本冻结、观察投影、逐动作存库与可续跑组游标。 */
import { createGame, currentSeat, legalMoves, sideOf } from '@yaozifen/game-core';
import { observeDecision } from '@yaozifen/game-view/decisionObservation';
import { applyAiAction } from '@yaozifen/ai-core/applyAction';
import { safeDiagnostic } from '@yaozifen/history-core/capture';
import { HISTORY_PROTOCOL_VERSION, type HistoryRepository } from '@yaozifen/history-core/contracts';
import { newHistoryId, derivedHistoryId } from '@yaozifen/protocol/ids';
import { simulationSummary, type SimulationRequest, type SimulationRun, type SimulationBoard, type SimulationGame, type SimulationReport, type FailureKind } from '@yaozifen/history-core/simulation';
import type { ProfileReference, EngineProfile } from '@yaozifen/ai-core/engines/profiles';
import { sanitizeDecisionRequest, type DecisionRequest } from '@yaozifen/ai-core/engines/decisionProtocol';
import { abortable } from '@yaozifen/ai-core/engines/engineTypes';
import { ModelRequestTracker, type ModelRequestStats } from '@yaozifen/ai-core/engines/modelRequestTracker';
import { historyDetail } from './http';
import { validatedReplay } from '@yaozifen/history-core/replay';
import { isRecord } from '@yaozifen/protocol/errors';
import { contentDigest } from '@yaozifen/protocol/json';
import { simulationSourceHash } from './sourceFingerprint';
import { DecisionService, DecisionExecutionError } from '../services/decisionService';
import type { ServerEngineRegistry } from '../engines/serverEngineRegistry';
import { HistoryProtocolError } from '@yaozifen/protocol/errors';
const IMPLEMENTATION = 'simulation-v2:basic-v1:profiles-v1:requests-v1';
export function failureKind(error: unknown): FailureKind {
    if (error instanceof Error && error.name === 'TimeoutError')
        return 'timeout';
    if (error instanceof Error && error.name === 'AbortError')
        return 'cancelled';
    if (error instanceof SimulationStorageFailure)
        return error.kind;
    if (error instanceof SimulationDecisionFailure)
        return error.kind;
    const message = error instanceof Error ? error.message : String(error);
    if (/超时|timeout|预算/i.test(message))
        return 'timeout';
    if (/取消|cancel|abort/i.test(message))
        return 'cancelled';
    if (/非法|错误座位|违规|扣底牌不在手牌中/.test(message))
        return 'illegal';
    if (/HTTP|status|状态码|请求失败\s*\([45]\d{2}/i.test(message))
        return 'http';
    if (/JSON|解析|schema|格式|缺失/i.test(message))
        return 'parse';
    if (error instanceof TypeError || /fetch|connect|网络|连接/i.test(message))
        return 'network';
    return 'execution';
}
export class SimulationService {
    private sourceHash = simulationSourceHash();
    private active = new Map<string, {
        controller: AbortController;
        task: Promise<void>;
    }>();
    constructor(private repository: () => HistoryRepository | null, private registry: ServerEngineRegistry, private decisions = new DecisionService(registry)) { }
    private repo() {
        const repo = this.repository();
        if (!repo)
            throw new HistoryProtocolError('历史存储已禁用');
        return repo;
    }
    start(input: SimulationRequest): SimulationReport {
        if (!input || !['lifecycle', 'fixed'].includes(input.mode) || input.source && input.mode !== 'lifecycle')
            throw new HistoryProtocolError('模拟模式不支持');
        const integer = (value: number, min: number, max: number) => Number.isInteger(value) && value >= min && value <= max;
        if (!Array.isArray(input.seeds) || !input.seeds.length || input.seeds.length > 1000 || new Set(input.seeds).size !== input.seeds.length || input.seeds.some(seed => !integer(seed, 0, 0xffffffff))
            || !Array.isArray(input.seats) || input.seats.length !== 4 || !integer(input.concurrency, 1, 8) || !integer(input.decisionBudgetMs, 1, 3600000) || !integer(input.runBudgetMs, 1, 3600000)
            || !integer(input.maxActions, 1, 4096) || !integer(input.maxRedeals, 0, 20))
            throw new HistoryProtocolError('模拟参数超出范围');
        const profiles = new Map<string, EngineProfile>();
        const resolve = (ref: ProfileReference) => {
            if (!ref || typeof ref.profileId !== 'string' || typeof ref.version !== 'string')
                throw new HistoryProtocolError('模拟需要冻结配置版本');
            const profile = this.registry.getProfile(ref.profileId, ref.version);
            if (profiles.has(profile.version))
                return;
            profiles.set(profile.version, profile);
            if (profile.parameters.fallback)
                resolve(profile.parameters.fallback);
        };
        input.seats.forEach(resolve);
        if (input.mode === 'fixed') {
            if (!input.fixedProfile)
                throw new HistoryProtocolError('固定前三阶段需要共同配置');
            resolve(input.fixedProfile);
        }
        if (input.source) {
            const detail = validatedReplay(historyDetail(this.repo(), input.source.handId));
            const source = input.source.nodeId === null ? detail.hand.startSnapshot : detail.nodes.find(node => node.nodeId === input.source!.nodeId)?.state;
            if (!source || currentSeat(source) < 0)
                throw new HistoryProtocolError('来源节点不存在或已结算');
            input = { ...input, seeds: [source.seed], concurrency: 1 };
        }
        const run: SimulationRun = { runId: newHistoryId('run'), status: 'pending', createdAt: Date.now(), updatedAt: Date.now(), elapsedMs: 0, executionStartedAt: null, sourceHash: this.sourceHash, searchSeed: globalThis.crypto.getRandomValues(new Uint32Array(1))[0], searchRandomProtocol: 'independent-seeded-v1', request: { ...structuredClone(input), seats: input.seats.map(ref => ({ profileId: ref.profileId, version: ref.version })) }, profiles: [...profiles.values()], implementationVersion: IMPLEMENTATION };
        for (const profile of run.profiles)
            this.repo().recordProfileVersion(profile);
        this.repo().saveSimulationRun(run);
        this.resume(run.runId);
        return this.report(run.runId);
    }
    list() { return this.repo().listSimulationRuns().map(run => ({ ...run, status: run.status === 'running' && !this.active.has(run.runId) ? 'cancelled' as const : run.status })); }
    report(id: string): SimulationReport {
        const run = this.repo().getSimulationRun(id);
        if (!run)
            throw new HistoryProtocolError('模拟不存在');
        const boards = this.repo().listSimulationBoards(id);
        return { ...run, status: run.status === 'running' && !this.active.has(id) ? 'cancelled' : run.status, boards, summary: { ...simulationSummary(boards, !!run.request.source), decisions: this.decisionSummary(boards, run.profiles) } };
    }
    private decisionSummary(boards: SimulationBoard[], profiles: EngineProfile[]) {
        const evaluations = boards.flatMap(board => board.games.flatMap(game => this.repo().listActionNodes(game.branchId).flatMap(node => this.repo().listEvaluations(node.nodeId))));
        const records = evaluations.map(value => isRecord(value.recommended) ? value.recommended : {});
        const faults = boards.flatMap(board => board.faults);
        const chains = records.flatMap((record, index) => Array.isArray(record.fallbackChain) ? record.fallbackChain.map(entry => isRecord(entry) ? { ...entry, phase: evaluations[index].phase } : {}) : []).concat(faults.flatMap(fault => (fault.attempts ?? []).map(entry => ({ ...entry, phase: fault.observation?.phase }))));
        const nativeIllegal = chains.filter(entry => isRecord(entry) && failureKind(new Error(String(entry.reason))) === 'illegal').length + faults.filter(fault => fault.kind === 'illegal' && !fault.attempts?.length).length;
        const noActionFailures = faults.filter(fault => fault.decisionFailure).length;
        const nativeModelLegal = records.filter(record => record.decisionSource === 'model').length;
        const nativeModelIllegal = chains.filter(entry => {
            if (!isRecord(entry) || !isRecord(entry.profile))
                return false;
            const reference = entry.profile;
            return profiles.some(profile => profile.version === reference.version && profile.parameters.capabilities[String(entry.phase)] === 'model') && failureKind(new Error(String(entry.reason))) === 'illegal';
        }).length;
        const seenDecisions = new Set<string>();
        const requestStats = records.map(record => record.requestStats).concat(faults.filter(fault => fault.decisionFailure || fault.requestStats).map(fault => fault.requestStats))
            .filter(value => {
                if (!isRecord(value) || value.protocolVersion !== 1 || typeof value.logicalDecisionId !== 'string') return true;
                if (seenDecisions.has(value.logicalDecisionId)) return false;
                seenDecisions.add(value.logicalDecisionId);
                return true;
            });
        const measured = requestStats.map(value => isRecord(value) && value.protocolVersion === 1
            && (value.modelRequestCount === null || Number.isSafeInteger(value.modelRequestCount) && Number(value.modelRequestCount) >= 0)
            && (value.modelRetryCount === null || Number.isSafeInteger(value.modelRetryCount) && Number(value.modelRetryCount) >= 0)
            ? value : null);
        const unmeasuredRequestDecisions = measured.filter(value => !value || value.modelRequestCount === null || value.modelRetryCount === null).length;
        const actualModelCalls = unmeasuredRequestDecisions ? null : measured.reduce((sum, value) => sum + Number(value!.modelRequestCount), 0);
        const actualModelRetries = unmeasuredRequestDecisions ? null : measured.reduce((sum, value) => sum + Number(value!.modelRetryCount), 0);
        const requestDecisionCount = measured.filter(value => value && typeof value.modelRequestCount === 'number' && value.modelRequestCount > 0).length;
        return { actualModelCalls, actualModelRetries, requestDecisionCount, unmeasuredRequestDecisions, nativeModelLegal, nativeModelIllegal, nativeModelOutputs: nativeModelLegal + nativeModelIllegal, nativeModelLegalRate: nativeModelLegal + nativeModelIllegal ? nativeModelLegal / (nativeModelLegal + nativeModelIllegal) : null,
            systemFinalLegalRate: evaluations.length + noActionFailures ? evaluations.length / (evaluations.length + noActionFailures) : null,
            finalLegal: evaluations.length, nativeIllegal, nativeLegal: records.filter(record => !Array.isArray(record.fallbackChain) || !record.fallbackChain.length).length,
            noActionFailures,
            actualFallbacks: records.filter(record => Array.isArray(record.fallbackChain) && record.fallbackChain.length).length,
            modelActions: records.filter(record => record.decisionSource === 'model').length,
            sources: Object.fromEntries(['model', 'heuristic', 'search', 'deterministic'].map(source => [source, records.filter(record => record.decisionSource === source).length])),
            latencyMs: evaluations.reduce((sum, value) => sum + value.latencyMs, 0),
            p50Ms: percentile(evaluations.map(value => value.latencyMs), 0.5), p95Ms: percentile(evaluations.map(value => value.latencyMs), 0.95),
            fallbackFailures: Object.fromEntries((['timeout', 'cancelled', 'illegal', 'http', 'parse', 'network', 'execution'] as const).map(kind => [kind, chains.filter(entry => isRecord(entry) && failureKind(new Error(String(entry.reason))) === kind).length])) };
    }
    resume(id: string) {
        const run = this.repo().getSimulationRun(id);
        if (!run)
            throw new HistoryProtocolError('模拟不存在');
        if (this.active.has(id) || run.status === 'completed')
            return;
        if (run.sourceHash !== this.sourceHash)
            throw new HistoryProtocolError('模拟源码已变化，请创建新运行');
        if (run.implementationVersion !== IMPLEMENTATION)
            throw new HistoryProtocolError('模拟实现版本不兼容');
        // 恢复旧版本及备用链，服务地址变更由 ProfileStore 明确拒绝。
        for (const profile of run.profiles)
            this.registry.getProfile(profile.profileId, profile.version);
        if (run.executionStartedAt !== null)
            run.elapsedMs += Math.max(0, Date.now() - run.executionStartedAt);
        run.executionStartedAt = Date.now();
        run.status = 'running';
        run.updatedAt = Date.now();
        this.repo().saveSimulationRun(run);
        const controller = new AbortController();
        const task = Promise.resolve().then(() => this.execute(run, controller)).finally(() => this.active.delete(id));
        this.active.set(id, { controller, task });
        void task.catch(() => { });
    }
    async cancel(id: string) {
        const active = this.active.get(id);
        if (active) {
            active.controller.abort(new DOMException('已取消模拟', 'AbortError'));
            await active.task;
        }
        return this.report(id);
    }
    async wait(id: string) { await this.active.get(id)?.task; return this.report(id); }
    private async execute(run: SimulationRun, controller: AbortController) {
        const started = performance.now();
        const remaining = run.request.runBudgetMs - run.elapsedMs;
        const timer = setTimeout(() => controller.abort(new DOMException('模拟总预算耗尽', 'TimeoutError')), Math.max(0, remaining));
        let cursor = 0;
        let failed = false;
        const worker = async () => {
            while (cursor < run.request.seeds.length && !controller.signal.aborted) {
                const index = cursor++;
                let board = this.repo().listSimulationBoards(run.runId).find(value => value.index === index);
                if (!board) {
                    board = { boardId: derivedHistoryId('board', `${run.runId}:${index}`), runId: run.runId, index, seed: run.request.seeds[index], games: [], faults: [] };
                    this.repo().saveSimulationBoard(board);
                }
                for (let gameIndex = 0; gameIndex < (run.request.source ? 1 : 2) && !controller.signal.aborted; gameIndex++) {
                    let game = board.games[gameIndex];
                    if (game?.status === 'completed')
                        continue;
                    if (!game) {
                        const key = `${board.boardId}:${gameIndex}`;
                        game = { handId: run.request.source?.handId ?? derivedHistoryId('hand', key), matchId: run.request.source ? this.repo().getHand(run.request.source.handId)!.matchId : derivedHistoryId('match', key), branchId: derivedHistoryId('branch', key), status: 'pending', durationMs: 0, actions: 0, redeals: 0 };
                        board.games.push(game);
                        this.repo().saveSimulationBoard(board);
                    }
                    try {
                        await this.play(run, board, game, gameIndex, controller.signal);
                    }
                    catch (error) {
                        game.status = controller.signal.aborted && failureKind(controller.signal.reason) === 'cancelled' ? 'cancelled' : 'failed';
                        failed ||= !controller.signal.aborted;
                        board.faults.push({ kind: failureKind(error), message: safeDiagnostic(error instanceof Error ? error.message : String(error)) ?? '执行失败', at: Date.now(), game: gameIndex, nodeId: this.repo().getBranch(game.branchId)?.tipNodeId ?? null, ...(error instanceof SimulationDecisionFailure ? { attempts: error.attempts, observation: error.observation, latencyMs: error.latencyMs, decisionFailure: true, requestStats: error.requestStats } : { decisionFailure: false, ...(error instanceof SimulationStorageFailure ? { requestStats: error.requestStats } : {}) }) });
                    }
                    if (!run.request.source && this.repo().getMatch(game.matchId) && game.status === 'failed')
                        this.repo().updateMatchStatus(game.matchId, 'failed', Date.now());
                    this.repo().saveSimulationBoard(board);
                }
            }
        };
        try {
            if (remaining <= 0)
                controller.abort(new DOMException('模拟总预算耗尽', 'TimeoutError'));
            await Promise.allSettled(Array.from({ length: run.request.concurrency }, () => worker().catch(error => { failed = true; controller.abort(error); })));
            run.status = controller.signal.aborted ? (failureKind(controller.signal.reason) === 'cancelled' ? 'cancelled' : 'failed') : failed ? 'failed' : 'completed';
        }
        catch {
            run.status = 'failed';
        }
        finally {
            clearTimeout(timer);
            run.elapsedMs += performance.now() - started;
            run.executionStartedAt = null;
            run.updatedAt = Date.now();
            this.repo().saveSimulationRun(run);
        }
    }
    private async decide(request: DecisionRequest, signal: AbortSignal, searchSeed: number) {
        const started = performance.now();
        const tracker = new ModelRequestTracker();
        const logicalDecisionId = `${request.requestId}:${newHistoryId('evaluation')}`;
        try {
            const result = await abortable(this.decisions.processDecision(request, signal, undefined, searchSeed, tracker), signal);
            return { result, requestStats: tracker.finish(logicalDecisionId) };
        }
        catch (error) {
            throw new SimulationDecisionFailure(error, request, performance.now() - started, tracker.finish(logicalDecisionId));
        }
    }
    private async play(run: SimulationRun, board: SimulationBoard, game: SimulationGame, gameIndex: number, signal: AbortSignal) {
        const started = performance.now();
        const repo = this.repo();
        let branch = repo.getBranch(game.branchId);
        const routes = gameIndex === 0 ? run.request.seats : [run.request.seats[1], run.request.seats[0], run.request.seats[3], run.request.seats[2]];
        const assignments = (nodeId: string | null, phase: string) => (run.request.mode === 'fixed' && phase !== 'playing' && phase !== 'handEnd' && phase !== 'matchEnd' ? Array<ProfileReference>(4).fill(run.request.fixedProfile!) : routes).map((ref, seat) => ({ assignmentId: derivedHistoryId('assignment', `${game.branchId}:${nodeId}:${seat}`), handId: game.handId, branchId: game.branchId, nodeId, seat, kind: 'ai' as const, profileVersionId: run.profiles.find(profile => profile.version === ref.version)!.profileVersionId, createdAt: Date.now() }));
        if (!branch && run.request.source) {
            repo.writeHistory({ protocolVersion: HISTORY_PROTOCOL_VERSION, branch: { branchId: game.branchId, handId: game.handId, sourceNodeId: run.request.source.nodeId, name: `历史续打 ${run.runId}`, kind: 'branch', createdAt: Date.now() }, profiles: run.profiles, assignments: assignments(null, 'bidding') });
            branch = repo.getBranch(game.branchId)!;
        }
        if (!branch) {
            const state = createGame(board.seed, { targetWins: 1 });
            const at = Date.now();
            repo.writeHistory({ protocolVersion: HISTORY_PROTOCOL_VERSION, match: { matchId: game.matchId, source: 'simulation', targetWins: 1, startedAt: at, implementationVersion: IMPLEMENTATION }, hand: { handId: game.handId, matchId: game.matchId, handIndex: 0, startSnapshot: state, startedAt: at }, branch: { branchId: game.branchId, handId: game.handId, name: '换边模拟', kind: 'actual', createdAt: at }, profiles: run.profiles, assignments: assignments(null, 'bidding') });
            branch = repo.getBranch(game.branchId)!;
        }
        let parent = branch.tipNodeId ?? branch.sourceNodeId;
        let state = parent ? repo.getActionNode(parent)!.state : repo.getHand(game.handId)!.startSnapshot;
        let seq = parent ? repo.getActionNode(parent)!.seq + 1 : 0;
        const originSeq = branch.sourceNodeId ? repo.getActionNode(branch.sourceNodeId)!.seq + 1 : 0;
        const fixedNodes = run.request.mode === 'fixed' && gameIndex === 1 ? repo.listActionNodes(board.games[0].branchId).filter(node => ['bid', 'trump', 'bury'].includes(node.command.kind)) : [];
        let uncommittedRequestStats: ModelRequestStats | undefined;
        game.status = 'running';
        if (!run.request.source)
            repo.updateMatchStatus(game.matchId, state.result ? 'completed' : 'in_progress', state.result ? repo.getHand(game.handId)!.endedAt : null);
        try {
            while (currentSeat(state) >= 0) {
                if (signal.aborted)
                    throw signal.reason;
                if (seq - originSeq >= run.request.maxActions)
                    throw new Error('模拟动作数超出上限');
                const seat = currentSeat(state);
                const observation = observeDecision(state, seat);
                const ref = run.request.mode === 'fixed' && state.phase !== 'playing' ? run.request.fixedProfile! : routes[seat];
                const profile = run.profiles.find(value => value.version === ref.version)!;
                const request = sanitizeDecisionRequest({ phase: observation.phase, seat, engineType: profile.type, profileId: ref.profileId, profileVersion: ref.version, observation, ...(observation.phase === 'playing' ? { candidates: legalMoves(state, seat) } : {}), totalBudgetMs: run.request.decisionBudgetMs, requestId: `${game.branchId}:${seq}` } as DecisionRequest);
                const fixed = run.request.mode === 'fixed' && gameIndex === 1 && state.phase !== 'playing' ? fixedNodes[seq] : undefined;
                if (run.request.mode === 'fixed' && gameIndex === 1 && state.phase !== 'playing' && !fixed)
                    throw new Error('共同前三阶段未完成，无法换边');
                const { result, requestStats }: { result: import('@yaozifen/ai-core/engines/decisionProtocol').DecisionResponse; requestStats: ModelRequestStats } = fixed ? { result: { executionEnvironment: 'server', success: true, action: fixed.command as import('@yaozifen/ai-core/types').AiAction, engineType: profile.type, requestedProfile: ref, actualProfile: ref, decisionSource: 'deterministic' as const, fallbackChain: [], latencyMs: 0 }, requestStats: new ModelRequestTracker().finish(`${request.requestId}:${newHistoryId('evaluation')}`) } : await this.decide(request, signal, Number.parseInt(contentDigest(`${run.searchSeed}:${board.index}:${gameIndex}:${seq - originSeq}`).slice(7, 15), 16));
                uncommittedRequestStats = requestStats;
                if (signal.aborted)
                    throw signal.reason;
                const after = applyAiAction(state, result.action);
                if (after === state)
                    throw new Error('非法模拟动作');
                const redeal = state.phase === 'bidding' && after.phase === 'bidding' && after.bidding.length === 0;
                const nodeId = derivedHistoryId('node', `${game.branchId}:${seq}`);
                const at = Date.now();
                const actual = run.profiles.find(value => value.version === result.actualProfile?.version) ?? profile;
                repo.writeHistory({ protocolVersion: HISTORY_PROTOCOL_VERSION, commit: { matchId: game.matchId, node: { nodeId, branchId: game.branchId, parentId: parent, seq, command: result.action, source: 'ai', state: after, createdAt: at }, seatAssignments: assignments(nodeId, after.phase),
                        evaluation: { evaluationId: derivedHistoryId('evaluation', nodeId), nodeId, requestId: request.requestId!, sessionId: run.runId, seat, phase: state.phase, purpose: 'step', observation, observationPoint: 'before', candidates: request.phase === 'playing' ? request.candidates : [], recommended: { requestStats, action: result.action, requestedProfile: result.requestedProfile, actualProfile: result.actualProfile, decisionSource: result.decisionSource, fallbackChain: result.fallbackChain?.map(entry => ({ ...entry, reason: safeDiagnostic(entry.reason) })), redeal, fixedOpeningReplay: !!fixed, originEvaluationId: fixed ? repo.listEvaluations(fixed.nodeId)[0]?.evaluationId : undefined, candidateEvaluations: result.decision?.candidateEvaluations, diagnostic: safeDiagnostic(result.decision?.diagnostic), conclusion: safeDiagnostic(result.decision?.conclusion), searchWinRate: result.decision?.searchWinRate, confidence: result.decision?.confidence }, status: 'applied', appliedNodeId: nodeId, latencyMs: result.latencyMs, profileVersionId: actual.profileVersionId, engineType: result.engineType, modelName: safeDiagnostic(result.modelName ?? undefined), fallbackReason: safeDiagnostic(result.fallbackReason ?? undefined), createdAt: at },
                        ...(after.result && !run.request.source ? { handSummary: { endedAt: at, declarer: after.declarer, bid: after.highestBid, trump: after.trump, result: after.result, unplayedPoints: after.result.unplayedPoints ?? 0 } } : {}) },
                    ...(after.result && !run.request.source ? { status: { matchId: game.matchId, status: 'completed', endedAt: at } } : {}) });
                uncommittedRequestStats = undefined;
                state = after;
                parent = nodeId;
                seq++;
                game.actions = seq - originSeq;
                game.redeals = repo.listActionNodes(game.branchId).filter(node => node.state.phase === 'bidding' && node.state.bidding.length === 0).length;
                this.repo().saveSimulationBoard(board);
                if (redeal && game.redeals > run.request.maxRedeals)
                    throw new Error('重发牌次数超出上限，未强制叫分');
                // 将事件循环还给取消请求、预算计时器及并行组。
                await new Promise<void>(resolve => setTimeout(resolve, 0));
            }
            if (!state.result)
                throw new Error('模拟没有结算');
            const result = state.result;
            const declarerSide = sideOf(state.declarer!);
            game.result = { winnerSide: result.winnerSide, team0Points: declarerSide === 0 ? result.declarerPoints : result.defenderPoints, team1Points: declarerSide === 1 ? result.declarerPoints : result.defenderPoints, bid: state.highestBid, success: result.success, unplayedPoints: result.unplayedPoints ?? 0 };
            game.status = 'completed';
        }
        catch (error) {
            if (uncommittedRequestStats) throw new SimulationStorageFailure(error, uncommittedRequestStats);
            throw error;
        }
        finally {
            game.durationMs += performance.now() - started;
        }
    }
}
function percentile(values: number[], fraction: number) {
    if (!values.length)
        return null;
    values.sort((a, b) => a - b);
    return values[Math.max(0, Math.ceil(values.length * fraction) - 1)];
}
class SimulationDecisionFailure extends Error {
    readonly kind: FailureKind;
    readonly attempts: NonNullable<import('@yaozifen/history-core/simulation').SimulationFault['attempts']>;
    readonly observation: import('@yaozifen/game-view/decisionObservation').DecisionObservation;
    constructor(error: unknown, request: DecisionRequest, readonly latencyMs: number, readonly requestStats: ModelRequestStats) {
        super(safeDiagnostic(error instanceof Error ? error.message : String(error)) ?? '决策失败');
        this.kind = failureKind(error);
        const attempts = error instanceof DecisionExecutionError ? error.attempts : [{ profile: { profileId: request.profileId!, version: request.profileVersion! }, reason: this.message }];
        this.attempts = attempts.map(entry => ({ ...entry, reason: safeDiagnostic(entry.reason) ?? '执行失败', kind: failureKind(new Error(entry.reason)) }));
        this.observation = { ...request.observation, phase: request.phase } as import('@yaozifen/game-view/decisionObservation').DecisionObservation;
    }
}

/** 动作提交失败也保留已发生的传输；与决策无动作失败分开归因。 */
class SimulationStorageFailure extends Error {
    readonly kind: FailureKind;
    constructor(cause: unknown, readonly requestStats: ModelRequestStats) {
        super(cause instanceof Error ? cause.message : String(cause), { cause });
        this.kind = failureKind(cause);
    }
}
