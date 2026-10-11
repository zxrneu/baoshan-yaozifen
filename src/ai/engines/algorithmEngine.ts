/**
 * 传统算法决策引擎（SRP：执行配对胜率搜索与信息集残局求解）。
 * 默认在 Worker 中运行，预算 250ms；将 ISMCTS 作为后续对照方案。
 */
import { Card, cardId } from '../../cards';
import { AsyncCardSelector, PlayerObservation } from '../optimized/contracts';
import { WorkerCardSelector } from '../optimized/workerClient';
import { DecisionEngine, EngineDecision } from './engineTypes';

export class AlgorithmEngine implements DecisionEngine {
  readonly type = 'algorithm' as const;

  constructor(
    private readonly selector: AsyncCardSelector = new WorkerCardSelector(),
  ) {}

  async chooseCard(
    observation: PlayerObservation,
    candidates: readonly Card[],
    signal?: AbortSignal,
  ): Promise<EngineDecision> {
    const started = performance.now();
    if (candidates.length === 0) throw new Error('候选牌集不能为空');
    if (candidates.length === 1) {
      return {
        card: candidates[0],
        engineType: 'algorithm',
        latencyMs: performance.now() - started,
        diagnostic: '唯一候选直接出牌',
      };
    }

    const decision = await this.selector.choose(observation, signal);
    const chosen =
      candidates.find((c) => cardId(c) === cardId(decision.card)) ?? candidates[0];
    const moveEst = decision.moves.find((m) => cardId(m.card) === cardId(chosen));

    const winRatePct = moveEst?.winRate !== undefined ? `${(moveEst.winRate * 100).toFixed(1)}%` : '未评估';
    const movesDesc = decision.moves
      .map((m) => `${m.card.rank}${m.card.suit}: ${(m.winRate * 100).toFixed(0)}%`)
      .join(' | ');

    return {
      card: chosen,
      engineType: 'algorithm',
      latencyMs: performance.now() - started,
      searchWinRate: moveEst?.winRate,
      confidence: moveEst?.winRate,
      thinking: `Worker 约束蒙特卡洛采样完成 ${decision.worlds} 个样本世界评估。\n评估状态: ${decision.status}。\n候选牌估计胜率: ${movesDesc || winRatePct}`,
      conclusion: `算法引擎选出评估胜率最高手牌 ${chosen.rank}${chosen.suit} (预估胜率 ${winRatePct})。`,
      diagnostic:
        decision.diagnostic ?? `状态: ${decision.status}, 世界样本: ${decision.worlds}`,
    };
  }
}
