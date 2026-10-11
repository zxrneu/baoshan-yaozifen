import { currentSeat, GameState, legalMoves } from '../../engine';
import { cardId } from '../../cards';
import { smartAgent } from '../smart';
import { AiAction, AsyncPlayerAgent, DecisionContext, PlayerAgent } from '../types';
import { applyAiAction } from '../applyAction';
import { observePlayer } from '../optimized/observation';
import { pruneCandidates } from '../tactics';
import { ActionDecision, DecisionEngine, EngineDecision } from './engineTypes';
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
  private getGodModeState?: EnginePlayerAgentOptions['getGodModeState'];
  constructor(options: EnginePlayerAgentOptions = {}) {
    this.fallbackEngine = options.fallbackEngine ?? new AlgorithmEngine();
    this.activeEngine = options.engine ?? this.fallbackEngine;
    this.nonPlayingAgent = options.nonPlayingAgent ?? smartAgent;
    this.logger = options.logger ?? decisionLogger;
    this.thinking = options.thinkingService ?? thinkingService;
    this.getGodModeState = options.getGodModeState;
  }
  setGodModeStateProvider(provider?: EnginePlayerAgentOptions['getGodModeState']): void { this.getGodModeState = provider; }
  setEngine(engine: DecisionEngine): void { this.activeEngine = engine; }
  getEngine(): DecisionEngine { return this.activeEngine; }
  nextAction(state: GameState): AiAction | null {
    if (state.phase !== 'playing') return this.nonPlayingAgent.nextAction(state);
    const seat = currentSeat(state);
    const candidates = pruneCandidates(observePlayer(state, seat), legalMoves(state, seat));
    return candidates.length ? { kind: 'play', seat, card: candidates[0] } : null;
  }
  async nextActionAsync(state: GameState, signal?: AbortSignal, context?: DecisionContext): Promise<AiAction | null> {
    const check = () => { if (signal?.aborted) throw signal.reason ?? new DOMException('已取消决策', 'AbortError'); };
    check();
    const seat = currentSeat(state);
    if (seat < 0) return null;
    // Capture the engine once: switching the next request cannot relabel this evaluation.
    const engine = this.activeEngine;
    const requestedEngine = engine.type;
    const started = performance.now();
    const candidates = state.phase === 'playing'
      ? pruneCandidates(observePlayer(state, seat), legalMoves(state, seat)) : [];
    let result: ActionDecision;
    this.thinking.startThinking(seat, '正在进行 ' + requestedEngine + ' [' + state.phase + '] 决策…');
    try {
      if (state.phase === 'playing') {
        let decision: EngineDecision;
        if (candidates.length === 1) {
          decision = { card: candidates[0], engineType: 'bridge', latencyMs: 0,
            diagnostic: '唯一候选直接出牌', conclusion: '候选精简后只有一张牌，无需调用模型。' };
        } else {
          decision = await engine.chooseCard(observePlayer(state, seat), candidates, signal, {
            onThinkingProgress: progress => { if (!signal?.aborted) this.thinking.updateThinking(seat, progress.text); },
          });
        }
        result = { ...decision, action: { kind: 'play', seat, card: decision.card }, decision };
      } else if (engine.chooseAction) {
        result = await engine.chooseAction(state, seat, signal);
      } else {
        throw new Error('引擎没有实现当前阶段决策');
      }
      check();
      if (result.action.seat !== seat) throw new Error('引擎返回了错误座位');
      applyAiAction(state, result.action);
    } catch (error) {
      check();
      const reason = error instanceof Error ? error.message : String(error);
      if (state.phase === 'playing') {
        const decision = await this.fallbackEngine.chooseCard(observePlayer(state, seat), candidates, signal);
        result = { ...decision, decision, action: { kind: 'play', seat, card: decision.card } };
      } else if (this.fallbackEngine.chooseAction) {
        result = await this.fallbackEngine.chooseAction(state, seat, signal);
      } else {
        const action = this.nonPlayingAgent.nextAction(state);
        if (!action) throw error;
        result = { action, engineType: 'bridge', latencyMs: performance.now() - started };
      }
      result = { ...result, fallbackReason: '从 ' + requestedEngine + ' 回退：' + reason, errorDetails: reason };
    }
    check();
    applyAiAction(state, result.action);
    const decision = result.decision;
    const chosenCard = result.action.kind === 'play' ? result.action.card : undefined;
    this.thinking.finishThinking(seat, result.conclusion, chosenCard);
    this.logger.record({
      seat, context, phase: state.phase, action: result.action, status: 'evaluated',
      engineType: result.engineType, requestedEngine, roundNumber: state.trickNumber, trickNumber: state.trickNumber,
      ownHand: [...state.hands[seat]], currentRound: state.trick.map(t => ({ ...t })), candidates, chosenCard,
      latencyMs: result.latencyMs, thinking: result.thinking, conclusion: result.conclusion, modelName: result.modelName,
      searchWinRate: decision?.searchWinRate, probabilities: result.probabilities, confidence: result.confidence,
      fallbackReason: result.fallbackReason, diagnostic: decision?.diagnostic,
      requestPayload: result.requestPayload ?? decision?.requestPayload,
      promptPayload: result.requestPayload ?? decision?.requestPayload,
      rawResponse: result.rawOutput ?? decision?.rawOutput, errorDetails: result.errorDetails,
      godModeState: this.getGodModeState?.(), trump: state.trump, declarer: state.declarer, bid: state.highestBid,
      declarerPoints: state.declarerTrickPoints + state.buriedPoints, defenderPoints: state.defenderTrickPoints,
      candidateEvaluations: decision?.candidateEvaluations ?? candidates.map(card => ({
        card, isChosen: chosenCard ? cardId(card) === cardId(chosenCard) : false,
      })),
    });
    return result.action;
  }
}
