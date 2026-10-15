/** 模拟领域契约与统计（SRP）：冻结请求、持久进度和组级赢副报告共用，不依赖 UI/SQL。 */
import type { DecisionObservation } from '@yaozifen/game-view/decisionObservation';
import type { ProfileReference, EngineProfile } from '@yaozifen/ai-core/engines/profiles';
import type { SimulationStatus } from '@yaozifen/protocol/contracts';
import { pairedWinRateInterval, scoreDuplicateBoard } from '@yaozifen/ai-core/statistics/duplicateBattle';
import type { ModelRequestStats } from '@yaozifen/ai-core/engines/modelRequestTracker';
export interface SimulationRequest {
    seeds: number[];
    seats: ProfileReference[];
    mode: 'lifecycle' | 'fixed';
    fixedProfile?: ProfileReference;
    source?: {
        handId: string;
        nodeId: string | null;
    };
    decisionBudgetMs: number;
    runBudgetMs: number;
    concurrency: number;
    maxActions: number;
    maxRedeals: number;
}
export type FailureKind = 'timeout' | 'cancelled' | 'illegal' | 'http' | 'parse' | 'network' | 'execution';
export interface SimulationFault {
    requestStats?: ModelRequestStats;
    kind: FailureKind;
    message: string;
    at: number;
    game: number;
    nodeId: string | null;
    attempts?: {
        profile: ProfileReference;
        reason: string;
        kind: FailureKind;
    }[];
    observation?: DecisionObservation;
    latencyMs?: number;
    decisionFailure?: boolean;
}
export interface SimulationGame {
    handId: string;
    branchId: string;
    matchId: string;
    status: SimulationStatus;
    durationMs: number;
    actions: number;
    redeals: number;
    result?: {
        winnerSide: number;
        team0Points: number;
        team1Points: number;
        bid: number;
        success: boolean;
        unplayedPoints: number;
    };
}
export interface SimulationBoard {
    boardId: string;
    runId: string;
    index: number;
    seed: number;
    games: SimulationGame[];
    faults: SimulationFault[];
}
export interface SimulationRun {
    runId: string;
    status: SimulationStatus;
    createdAt: number;
    updatedAt: number;
    elapsedMs: number;
    sourceHash: string;
    searchSeed: number;
    searchRandomProtocol: 'independent-seeded-v1';
    executionStartedAt: number | null;
    request: SimulationRequest;
    profiles: EngineProfile[];
    implementationVersion: string;
}
export interface SimulationReport extends SimulationRun {
    boards: SimulationBoard[];
    summary: ReturnType<typeof simulationSummary> & {
        decisions: {
            actualModelCalls: number | null;
            actualModelRetries: number | null;
            requestDecisionCount: number;
            unmeasuredRequestDecisions: number;
            finalLegal: number;
            nativeIllegal: number;
            nativeLegal: number;
            noActionFailures: number;
            actualFallbacks: number;
            modelActions: number;
            sources: Record<string, number>;
            latencyMs: number;
            p50Ms: number | null;
            p95Ms: number | null;
            fallbackFailures: Record<string, number>;
            nativeModelLegal: number;
            nativeModelIllegal: number;
            nativeModelOutputs: number;
            nativeModelLegalRate: number | null;
            systemFinalLegalRate: number | null;
        };
    };
}
export function simulationSummary(boards: SimulationBoard[], continuation = false) {
    const complete = boards.filter(board => board.games.length === 2 && board.games.every(game => game.status === 'completed' && game.result));
    const scores = continuation ? [] : complete.map(board => scoreDuplicateBoard(board.games[0].result!, board.games[1].result!));
    const games = boards.flatMap(board => board.games);
    const results = games.flatMap(game => game.result ? [game.result] : []);
    return { interval: pairedWinRateInterval(scores), aWins: scores.reduce((sum, score) => sum + score.engineAWins, 0), bWins: scores.reduce((sum, score) => sum + score.engineBWins, 0),
        completedGroups: continuation ? boards.filter(board => board.games[0]?.status === 'completed').length : complete.length, incompleteGroups: boards.filter(board => board.games.some(game => game.status !== 'completed')).length,
        completedGames: results.length, durationMs: games.reduce((sum, game) => sum + game.durationMs, 0),
        contracts: Object.fromEntries([...new Set(results.map(result => result.bid))].map(bid => [bid, { count: results.filter(result => result.bid === bid).length, success: results.filter(result => result.bid === bid && result.success).length }])),
        unplayedPoints: results.reduce((sum, result) => sum + result.unplayedPoints, 0),
        faults: Object.fromEntries((['timeout', 'cancelled', 'illegal', 'http', 'parse', 'network', 'execution'] as const).map(kind => [kind, boards.flatMap(board => board.faults).filter(fault => fault.kind === kind).length])),
        note: continuation ? '历史续打仅报告本分支结果，不参与换边牌力比较。' : '按实际赢副计算；同组两局不是独立样本，小样本及区间跨零不能宣布牌力排序。' };
}
