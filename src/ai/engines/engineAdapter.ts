/**
 * 引擎玩家适配器（DIP 原则：将 DecisionEngine 适配为 PlayerAgent / AsyncPlayerAgent）。
 * 统一执行战术精简、唯一候选快速返回、模型异常优雅回退与全链路日志记录。
 */
import { currentSeat, GameState, legalMoves, SEAT_NAMES } from '../../engine';
import { smartAgent } from '../smart';
import { AiAction, AsyncPlayerAgent, PlayerAgent } from '../types';
import { observePlayer } from '../optimized/observation';
import { pruneCandidates } from '../tactics';
import { DecisionEngine, EngineDecision } from './engineTypes';
import { AlgorithmEngine } from './algorithmEngine';
import { decisionLogger, DecisionLogger } from './decisionLogger';
import { thinkingService, ThinkingService } from './thinkingService';

export interface EnginePlayerAgentOptions {
  engine?: DecisionEngine;
  fallbackEngine?: DecisionEngine;
  nonPlayingAgent?: PlayerAgent;
  logger?: DecisionLogger;
  thinkingService?: ThinkingService;
  getGodModeState?: () => { enabled: boolean; peekedSeats: number[] };
}

export class EnginePlayerAgent implements AsyncPlayerAgent {
  private activeEngine: DecisionEngine;
  private readonly fallbackEngine: DecisionEngine;
  private readonly nonPlayingAgent: PlayerAgent;
  private readonly logger: DecisionLogger;
  private readonly thinking: ThinkingService;
  private getGodModeState?: () => { enabled: boolean; peekedSeats: number[] };

  constructor(options: EnginePlayerAgentOptions = {}) {
    this.fallbackEngine = options.fallbackEngine ?? new AlgorithmEngine();
    this.activeEngine = options.engine ?? this.fallbackEngine;
    this.nonPlayingAgent = options.nonPlayingAgent ?? smartAgent;
    this.logger = options.logger ?? decisionLogger;
    this.thinking = options.thinkingService ?? thinkingService;
    this.getGodModeState = options.getGodModeState;
  }

  setGodModeStateProvider(provider?: () => { enabled: boolean; peekedSeats: number[] }): void {
    this.getGodModeState = provider;
  }

  setEngine(engine: DecisionEngine): void {
    this.activeEngine = engine;
  }

  getEngine(): DecisionEngine {
    return this.activeEngine;
  }

  nextAction(state: GameState): AiAction | null {
    if (state.phase !== 'playing') return this.nonPlayingAgent.nextAction(state);
    const seat = currentSeat(state);
    if (seat < 0) return null;
    const observation = observePlayer(state, seat);
    const legal = legalMoves(state, seat);
    const candidates = pruneCandidates(observation, legal);
    if (candidates.length === 1) {
      return { kind: 'play', seat, card: candidates[0] };
    }
    // 同步调用使用保牌基线 / 算法快速决策
    const chosen = candidates[0];
    return { kind: 'play', seat, card: chosen };
  }

  async nextActionAsync(state: GameState, signal?: AbortSignal): Promise<AiAction | null> {
    if (signal?.aborted) throw new DOMException('已取消决策', 'AbortError');

    const seat = currentSeat(state);
    if (seat < 0) return null;

    // 全生命周期阶段（叫分、定主、扣底）优先通过当前配置引擎决策
    if (state.phase !== 'playing') {
      if (this.activeEngine.chooseAction) {
        this.thinking.startThinking(seat, `🧠 正在进行 ${this.activeEngine.type} [${state.phase}] 决策...`);
        try {
          const res = await this.activeEngine.chooseAction(state, seat, signal);
          this.thinking.finishThinking(seat, res.conclusion);
          return res.action;
        } catch (e: any) {
          if (signal?.aborted) throw e;
          const fallbackReason = e instanceof Error ? e.message : String(e);
          console.warn(`[Engine Fallback] ⚠️ 阶段 ${state.phase} 原引擎异常: ${fallbackReason}，触发备用引擎接管`);
          if (this.fallbackEngine.chooseAction) {
            const fb = await this.fallbackEngine.chooseAction(state, seat, signal);
            this.thinking.finishThinking(seat, fb.conclusion);
            return fb.action;
          }
          return this.nonPlayingAgent.nextAction(state);
        }
      }
      return this.nonPlayingAgent.nextAction(state);
    }

    const observation = observePlayer(state, seat);
    const legal = legalMoves(state, seat);
    const candidates = pruneCandidates(observation, legal);

    // 唯一候选直接出牌（无需发起模型网络请求或耗费搜索）
    if (candidates.length === 1) {
      const singleCard = candidates[0];
      this.thinking.startThinking(seat, '唯一候选牌，直接出牌');
      this.thinking.finishThinking(seat, '唯一合法候选直接出牌', singleCard);

      const godMode = this.getGodModeState?.();
      this.logger.record({
        seat,
        engineType: this.activeEngine.type,
        requestedEngine: this.activeEngine.type,
        roundNumber: state.trickNumber,
        trickNumber: state.trickNumber,
        ownHand: [...state.hands[seat]],
        currentRound: state.trick.map((t) => ({ seat: t.seat, card: t.card })),
        candidates: [...candidates],
        chosenCard: singleCard,
        latencyMs: 0,
        thinking: '根据跟门规则，当前手牌中仅有 1 张合法可用手牌，无其他分支可供选择。',
        conclusion: '唯一合法候选直接出牌。',
        confidence: 1.0,
        diagnostic: '唯一候选直接出牌',
        godModeState: godMode,
        trump: state.trump,
        declarer: state.declarer,
        bid: state.highestBid,
        declarerPoints: state.declarerTrickPoints + state.buriedPoints,
        defenderPoints: state.defenderTrickPoints,
      });
      return { kind: 'play', seat, card: singleCard };
    }

    this.thinking.startThinking(seat, `🧠 正在进行 ${this.activeEngine.type} 思考推演...`);

    let decision: EngineDecision;
    let fallbackReason: string | undefined;

    try {
      decision = await this.activeEngine.chooseCard(observation, candidates, signal, {
        onThinkingProgress: (prog) => {
          this.thinking.updateThinking(prog.seat, prog.text);
        },
      });
    } catch (error: any) {
      if (signal?.aborted) throw error;
      fallbackReason = error instanceof Error ? error.message : String(error);
      const errorStack = error instanceof Error ? error.stack : undefined;
      console.warn(
        `%c[Engine Fallback] ⚠️ [${SEAT_NAMES[seat]}家] 原引擎 ${this.activeEngine.type} 执行异常，已触发备用引擎 (${this.fallbackEngine.type}) 接管`,
        'color: #ea580c; font-weight: bold;',
        {
          seat,
          seatName: SEAT_NAMES[seat],
          requestedEngine: this.activeEngine.type,
          fallbackEngine: this.fallbackEngine.type,
          error: fallbackReason,
          errorStack,
          trickNumber: state.trickNumber,
        },
      );
      this.thinking.updateThinking(
        seat,
        `⚠️ ${this.activeEngine.type} 异常 (${fallbackReason})，正在回退至备用算法引擎...`,
      );

      // 模型超时、错误或非法回答回退到算法
      decision = await this.fallbackEngine.chooseCard(observation, candidates, signal);
      decision = {
        ...decision,
        fallbackReason: `从 ${this.activeEngine.type} 回退: ${fallbackReason}`,
        errorDetails: fallbackReason,
        thinking: decision.thinking ?? `原计划调用 ${this.activeEngine.type}，但因网络或超时异常 (${fallbackReason})，自动平滑切换至算法引擎进行胜率搜索与专家规则决策。`,
        conclusion: decision.conclusion ?? `由备用引擎接管出牌，选出 ${decision.card.rank}${decision.card.suit}。`,
      };
    }

    this.thinking.finishThinking(seat, decision.conclusion, decision.card);

    const godMode = this.getGodModeState?.();
    this.logger.record({
      seat,
      engineType: decision.engineType,
      requestedEngine: this.activeEngine.type,
      roundNumber: state.trickNumber,
      trickNumber: state.trickNumber,
      ownHand: [...state.hands[seat]],
      currentRound: state.trick.map((t) => ({ seat: t.seat, card: t.card })),
      candidates: [...candidates],
      chosenCard: decision.card,
      latencyMs: decision.latencyMs,
      thinking: decision.thinking,
      conclusion: decision.conclusion,
      modelName: decision.modelName,
      searchWinRate: decision.searchWinRate,
      probabilities: decision.probabilities,
      confidence: decision.confidence,
      fallbackReason: decision.fallbackReason,
      diagnostic: decision.diagnostic,
      promptPayload: decision.requestPayload,
      requestPayload: decision.requestPayload,
      rawResponse: decision.rawOutput,
      errorDetails: decision.errorDetails,
      godModeState: godMode,
      trump: state.trump,
      declarer: state.declarer,
      bid: state.highestBid,
      declarerPoints: state.declarerTrickPoints + state.buriedPoints,
      defenderPoints: state.defenderTrickPoints,
    });

    console.info(
      `%c[Decision Recorded] 📝 [${SEAT_NAMES[seat]}家] 最终出牌: ${decision.card.rank}${decision.card.suit} · 耗时 ${Math.round(decision.latencyMs)}ms`,
      'color: #0284c7; font-weight: bold;',
      {
        seat,
        seatName: SEAT_NAMES[seat],
        card: `${decision.card.rank}${decision.card.suit}`,
        engine: decision.engineType,
        requestedEngine: this.activeEngine.type,
        fallbackReason: decision.fallbackReason,
        conclusion: decision.conclusion,
        godMode: godMode
          ? `${godMode.enabled ? '👀 开启' : '🔒 关闭'} (透视玩家: [${godMode.peekedSeats.map((s) => SEAT_NAMES[s]).join(', ')}])`
          : '未开启',
      },
    );

    return { kind: 'play', seat, card: decision.card };
  }
}
