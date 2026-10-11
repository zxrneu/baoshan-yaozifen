/**
 * 服务端决策调度服务 (SOLID - SRP / DIP 原则)。
 * 负责接收全阶段决策请求，调度目标引擎执行推断，
 * 当上游模型不可达或超时时，就地在服务端同进程触发毫秒级算法降级。
 */
import { DecisionRequest, DecisionResponse } from '../types';
import { DecisionEngine, ActionDecision } from '../../src/ai/engines/engineTypes';
import { BridgeEngine } from '../../src/ai/bridge/bridgeEngine';
import { ServerEngineRegistry } from '../engines/serverEngineRegistry';
import { smartBid, smartTrump, smartBury } from '../../src/ai/smart';
import { cardLabel } from '../../src/cards';

export class DecisionService {
  private readonly registry: ServerEngineRegistry;
  private readonly defaultFallbackEngine: DecisionEngine;

  constructor(
    registry: ServerEngineRegistry,
    defaultFallbackEngine: DecisionEngine = new BridgeEngine(),
  ) {
    this.registry = registry;
    this.defaultFallbackEngine = defaultFallbackEngine;
  }

  async processDecision(
    request: DecisionRequest,
    signal?: AbortSignal,
  ): Promise<DecisionResponse> {
    const started = performance.now();
    const primaryEngine = this.registry.forRequest(request.engineType, request.options);
    const fallbackEngine = request.fallbackEngine
      ? this.registry.get(request.fallbackEngine)
      : this.defaultFallbackEngine;

    // 1. 出牌阶段 (playing)
    if (request.phase === 'playing') {
      return this.handlePlayDecision(
        request,
        primaryEngine,
        fallbackEngine,
        started,
        signal,
      );
    }

    // 2. 叫分阶段 (bidding)
    if (request.phase === 'bidding') {
      return this.handleBiddingDecision(
        request,
        primaryEngine,
        fallbackEngine,
        started,
        signal,
      );
    }

    // 3. 定主阶段 (declaring / trump)
    if (request.phase === 'declaring' || request.phase === 'trump') {
      return this.handleTrumpDecision(
        request,
        primaryEngine,
        fallbackEngine,
        started,
        signal,
      );
    }

    // 4. 扣底阶段 (bury)
    if (request.phase === 'bury') {
      return this.handleBuryDecision(
        request,
        primaryEngine,
        fallbackEngine,
        started,
        signal,
      );
    }

    throw new Error(`[DecisionService] 不支持的决策阶段: ${request.phase}`);
  }

  private async handlePlayDecision(
    request: DecisionRequest,
    primaryEngine: DecisionEngine,
    fallbackEngine: DecisionEngine,
    started: number,
    signal?: AbortSignal,
  ): Promise<DecisionResponse> {
    const candidates = request.candidates ?? [];
    if (candidates.length === 0) {
      throw new Error('[DecisionService] 出牌决策失败：候选牌集为空');
    }

    // 唯一候选牌极速返回（0ms）
    if (candidates.length === 1) {
      const singleCard = candidates[0];
      return {
        success: true,
        action: { kind: 'play', seat: request.seat, card: singleCard },
        decision: {
          card: singleCard,
          engineType: primaryEngine.type,
          latencyMs: performance.now() - started,
          diagnostic: '唯一候选直接出牌',
          conclusion: `唯一合法候选直接出牌 ${cardLabel(singleCard)}。`,
        },
        thinking: '根据跟门规则，当前手牌中仅有一张合法可用牌，无需模型评估。',
        conclusion: `唯一合法候选直接出牌 ${cardLabel(singleCard)}。`,
        latencyMs: performance.now() - started,
        engineType: primaryEngine.type,
        executionEnvironment: 'server',
      };
    }

    const observation = request.observation;
    if (!observation) {
      throw new Error('[DecisionService] 出牌决策失败：缺失 PlayerObservation 局势观测');
    }

    try {
      const decision = await primaryEngine.chooseCard(observation, candidates, signal);
      return {
        success: true,
        action: { kind: 'play', seat: request.seat, card: decision.card },
        decision,
        thinking: decision.thinking,
        conclusion: decision.conclusion,
        latencyMs: performance.now() - started,
        engineType: decision.engineType,
        executionEnvironment: 'server',
      };
    } catch (err: any) {
      if (signal?.aborted) throw err;
      const errorMsg = err instanceof Error ? err.message : String(err);
      console.warn(
        `[DecisionService] ⚠️ 座位 ${request.seat} 引擎 ${primaryEngine.type} 执行异常: ${errorMsg}，启动服务端快速回退 (${fallbackEngine.type})`,
      );

      const fallbackDecision = await fallbackEngine.chooseCard(observation, candidates, signal);
      const fallbackReason = `服务端自 ${primaryEngine.type} 降级: ${errorMsg}`;

      return {
        success: true,
        action: { kind: 'play', seat: request.seat, card: fallbackDecision.card },
        decision: {
          ...fallbackDecision,
          fallbackReason,
          errorDetails: errorMsg,
        },
        thinking: fallbackDecision.thinking ?? `因主引擎网络或超时异常 (${errorMsg})，已由备用引擎接管评估。`,
        conclusion: fallbackDecision.conclusion,
        latencyMs: performance.now() - started,
        engineType: fallbackDecision.engineType,
        fallbackReason,
        executionEnvironment: 'server',
      };
    }
  }

  private async handleBiddingDecision(
    request: DecisionRequest,
    primaryEngine: DecisionEngine,
    fallbackEngine: DecisionEngine,
    started: number,
    signal?: AbortSignal,
  ): Promise<DecisionResponse> {
    const state = request.gameStateSnapshot;
    const seat = request.seat;

    try {
      let result: ActionDecision;
      if (primaryEngine.chooseBid) {
        result = await primaryEngine.chooseBid(state, seat, signal);
      } else if (primaryEngine.chooseAction) {
        result = await primaryEngine.chooseAction(state, seat, signal);
      } else {
        throw new Error(`引擎 ${primaryEngine.type} 未实现 chooseBid 接口`);
      }

      return {
        success: true,
        ...result,
        action: result.action,
        decision: result.decision,
        thinking: result.thinking,
        conclusion: result.conclusion,
        latencyMs: performance.now() - started,
        engineType: result.engineType,
        executionEnvironment: 'server',
      };
    } catch (err: any) {
      if (signal?.aborted) throw err;
      const errorMsg = err instanceof Error ? err.message : String(err);
      console.warn(`[DecisionService] ⚠️ 叫分异常: ${errorMsg}，回退备用引擎`);

      const fb = fallbackEngine.chooseBid
        ? await fallbackEngine.chooseBid(state, seat, signal)
        : {
            action: { kind: 'bid' as const, seat, bid: state ? smartBid(state, seat) : null },
            engineType: fallbackEngine.type,
            latencyMs: performance.now() - started,
            thinking: '回退至保山牌力折价叫分算法。',
            conclusion: '叫分回退评估完成',
          };

      return {
        success: true,
        action: fb.action,
        decision: fb.decision,
        thinking: fb.thinking,
        conclusion: fb.conclusion,
        latencyMs: performance.now() - started,
        engineType: fb.engineType,
        fallbackReason: `服务端叫分从 ${primaryEngine.type} 降级: ${errorMsg}`,
        executionEnvironment: 'server',
      };
    }
  }

  private async handleTrumpDecision(
    request: DecisionRequest,
    primaryEngine: DecisionEngine,
    fallbackEngine: DecisionEngine,
    started: number,
    signal?: AbortSignal,
  ): Promise<DecisionResponse> {
    const state = request.gameStateSnapshot;
    const seat = request.seat;

    try {
      let result: ActionDecision;
      if (primaryEngine.chooseTrump) {
        result = await primaryEngine.chooseTrump(state, seat, signal);
      } else if (primaryEngine.chooseAction) {
        result = await primaryEngine.chooseAction(state, seat, signal);
      } else {
        throw new Error(`引擎 ${primaryEngine.type} 未实现 chooseTrump 接口`);
      }

      return {
        success: true,
        ...result,
        action: result.action,
        decision: result.decision,
        thinking: result.thinking,
        conclusion: result.conclusion,
        latencyMs: performance.now() - started,
        engineType: result.engineType,
        executionEnvironment: 'server',
      };
    } catch (err: any) {
      if (signal?.aborted) throw err;
      const errorMsg = err instanceof Error ? err.message : String(err);
      console.warn(`[DecisionService] ⚠️ 定主异常: ${errorMsg}，回退备用引擎`);

      const fb = fallbackEngine.chooseTrump
        ? await fallbackEngine.chooseTrump(state, seat, signal)
        : {
            action: { kind: 'trump' as const, seat, trump: state ? smartTrump(state, seat) : 'S' },
            engineType: fallbackEngine.type,
            latencyMs: performance.now() - started,
            thinking: '回退至定主长套控制力算法。',
            conclusion: '定主回退完成',
          };

      return {
        success: true,
        action: fb.action,
        decision: fb.decision,
        thinking: fb.thinking,
        conclusion: fb.conclusion,
        latencyMs: performance.now() - started,
        engineType: fb.engineType,
        fallbackReason: `服务端定主从 ${primaryEngine.type} 降级: ${errorMsg}`,
        executionEnvironment: 'server',
      };
    }
  }

  private async handleBuryDecision(
    request: DecisionRequest,
    primaryEngine: DecisionEngine,
    fallbackEngine: DecisionEngine,
    started: number,
    signal?: AbortSignal,
  ): Promise<DecisionResponse> {
    const state = request.gameStateSnapshot;
    const seat = request.seat;

    try {
      let result: ActionDecision;
      if (primaryEngine.chooseBury) {
        result = await primaryEngine.chooseBury(state, seat, signal);
      } else if (primaryEngine.chooseAction) {
        result = await primaryEngine.chooseAction(state, seat, signal);
      } else {
        throw new Error(`引擎 ${primaryEngine.type} 未实现 chooseBury 接口`);
      }

      return {
        success: true,
        ...result,
        action: result.action,
        decision: result.decision,
        thinking: result.thinking,
        conclusion: result.conclusion,
        latencyMs: performance.now() - started,
        engineType: result.engineType,
        executionEnvironment: 'server',
      };
    } catch (err: any) {
      if (signal?.aborted) throw err;
      const errorMsg = err instanceof Error ? err.message : String(err);
      console.warn(`[DecisionService] ⚠️ 扣底异常: ${errorMsg}，回退备用引擎`);

      const fb = fallbackEngine.chooseBury
        ? await fallbackEngine.chooseBury(state, seat, signal)
        : {
            action: { kind: 'bury' as const, seat, cards: state ? smartBury(state, seat) : [] },
            engineType: fallbackEngine.type,
            latencyMs: performance.now() - started,
            thinking: '回退至短门保主扣底算法。',
            conclusion: '扣底回退完成',
          };

      return {
        success: true,
        action: fb.action,
        decision: fb.decision,
        thinking: fb.thinking,
        conclusion: fb.conclusion,
        latencyMs: performance.now() - started,
        engineType: fb.engineType,
        fallbackReason: `服务端扣底从 ${primaryEngine.type} 降级: ${errorMsg}`,
        executionEnvironment: 'server',
      };
    }
  }
}
