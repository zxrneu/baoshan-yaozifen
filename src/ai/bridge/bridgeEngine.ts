/**
 * 桥牌深度思考算法决策引擎 (Bridge Decision Engine)。
 * 实现统一异步契约 DecisionEngine，遵循 SOLID 设计原则。
 */
import { Card, cardId } from '../../cards';
import { PlayerObservation } from '../optimized/contracts';
import { DecisionEngine, EngineDecision } from '../engines/engineTypes';
import { evaluateBridgeTactics } from './heuristics';
import { BridgePimcEvaluator } from './pimc';
import {
  BridgeThinkingConfig,
  DEFAULT_DEEP_THINKING_CONFIG,
} from './types';

export interface BridgeEngineOptions {
  config?: BridgeThinkingConfig;
  pimcEvaluator?: BridgePimcEvaluator;
}

export class BridgeEngine implements DecisionEngine {
  readonly type = 'bridge' as const;
  private readonly config: BridgeThinkingConfig;
  private readonly pimcEvaluator: BridgePimcEvaluator;

  constructor(options: BridgeEngineOptions = {}) {
    this.config = options.config ?? DEFAULT_DEEP_THINKING_CONFIG;
    this.pimcEvaluator =
      options.pimcEvaluator ?? new BridgePimcEvaluator({ config: this.config });
  }

  async chooseCard(
    observation: PlayerObservation,
    candidates: readonly Card[],
    signal?: AbortSignal,
  ): Promise<EngineDecision> {
    const started = performance.now();
    if (candidates.length === 0) throw new Error('候选牌集不能为空');

    // 1. 唯一候选直接出牌 (0ms)
    if (candidates.length === 1) {
      return {
        card: candidates[0],
        engineType: 'bridge',
        latencyMs: performance.now() - started,
        searchWinRate: 1.0,
        diagnostic: '唯一候选直接出牌',
      };
    }

    // 2. 若模式为 fast，或外部 signal 已触发，使用纯桥牌专家启发式规则 (< 1ms)
    if (this.config.mode === 'fast' || signal?.aborted) {
      const advice = evaluateBridgeTactics(observation, candidates);
      return {
        card: advice.card,
        engineType: 'bridge',
        latencyMs: performance.now() - started,
        thinking: `桥牌专家战术规则系统研判：${advice.reason}。意图类型：${advice.intent}。`,
        conclusion: `遵循战术【${advice.intent}】，决定出 ${advice.card.rank}${advice.card.suit}。`,
        searchWinRate: advice.score / 100,
        confidence: 0.85,
        diagnostic: `桥牌专家战术[极速]: ${advice.reason} (${advice.intent})`,
      };
    }

    // 3. 深度思考模式：调用 DDS-PIMC 完美信息蒙特卡洛引擎
    try {
      const pimcDecision = await this.pimcEvaluator.evaluate(
        observation,
        candidates,
        signal,
      );

      const chosenCard =
        candidates.find((c) => cardId(c) === cardId(pimcDecision.card)) ??
        candidates[0];

      const movesDesc = pimcDecision.moves
        .map(
          (m) =>
            `${m.card.rank}${m.card.suit}: 胜率 ${(m.winRate * 100).toFixed(0)}%, 期望分 ${m.expectedPoints.toFixed(1)}`,
        )
        .join(' | ');

      return {
        card: chosenCard,
        engineType: 'bridge',
        latencyMs: performance.now() - started,
        thinking: `位棋盘 DDS 求解器完成 ${pimcDecision.worldsEvaluated} 个样本世界评估。\n各候选牌博弈树估值：${movesDesc}`,
        conclusion: `DDS 搜索选出最优期望牌 ${chosenCard.rank}${chosenCard.suit} (胜率 ${(pimcDecision.winRate * 100).toFixed(1)}%)。`,
        searchWinRate: pimcDecision.winRate,
        confidence: pimcDecision.winRate,
        diagnostic: pimcDecision.diagnostic,
      };
    } catch (error: any) {
      if (signal?.aborted) throw error;
      // 异常情况下平滑回退到桥牌专家战术
      const fallbackAdvice = evaluateBridgeTactics(observation, candidates);
      return {
        card: fallbackAdvice.card,
        engineType: 'bridge',
        latencyMs: performance.now() - started,
        thinking: `DDS 搜索异常 (${error instanceof Error ? error.message : String(error)})，回退专家规则：${fallbackAdvice.reason}`,
        conclusion: `专家规则接管，选出 ${fallbackAdvice.card.rank}${fallbackAdvice.card.suit}。`,
        searchWinRate: 0.5,
        fallbackReason: error instanceof Error ? error.message : String(error),
        diagnostic: `搜索异常回退专家规则: ${fallbackAdvice.reason}`,
      };
    }
  }
}
