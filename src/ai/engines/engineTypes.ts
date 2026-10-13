/**
 * 决策引擎领域模型与统一异步接口（ISP / DIP 原则）。
 * 搜索胜率与模型概率分别记录，不混用。
 */
import { Card } from '../../cards';
import { PlayerObservation } from '../optimized/contracts';
import { GameState } from '../../engine';
import { AiAction, DecisionContext } from '../types';
import { DecisionObservation, BiddingObservation, TrumpObservation, BuryObservation, InputVisibility } from '../decisionObservation';

export type EngineType = 'bridge' | 'algorithm' | 'llm' | 'laya';

export type ThinkingPhase = 'idle' | 'thinking' | 'decided';

export interface ThinkingProgress {
  seat: number;
  text: string;
  phase: ThinkingPhase;
  conclusion?: string;
  chosenCard?: Card;
  timestamp?: number;
}

export type ThinkingCallback = (progress: ThinkingProgress) => void;

/** 仅在实际调用 HTTP 传输时报告；attempt 从 1 开始，后续为该请求的重试。 */
export interface ModelRequestEvent { attempt: number }
export interface DecisionExecutionOptions {
  onThinkingProgress?: ThinkingCallback;
  onModelRequest?: (event: ModelRequestEvent) => void;
}

export interface ChooseCardOptions {
  signal?: AbortSignal;
  onThinkingProgress?: ThinkingCallback;
}

export interface CandidateMoveEvaluation {
  card: Card;
  winRate?: number;
  expectedPoints?: number;
  probability?: number;
  score?: number;
  tag?: string;
  isChosen?: boolean;
  samples?: number;
  exactSamples?: number;
  rolloutSamples?: number;
  /** 被迫出牌：唯一合法动作，winRate/expectedPoints 为中性基线而非评估结论。 */
  forced?: boolean;
}

export interface ProfileExecution {
  requestedProfile?: import('./profiles').ProfileReference;
  actualProfile?: import('./profiles').ProfileReference;
  fallbackChain?: { profile: import('./profiles').ProfileReference; reason: string }[];
  decisionSource?: 'model' | 'heuristic' | 'search' | 'deterministic';
}

export interface EngineDecision extends ProfileExecution {
  card: Card;
  engineType: EngineType;
  latencyMs: number;
  diagnostic?: string;
  /** 思考过程（LLM 思维链、桥牌启发式推演、算法蒙特卡洛评估） */
  thinking?: string;
  /** 决策结论与战术意图摘要 */
  conclusion?: string;
  /** 调用的具体模型标识 (如 qwen38_27b, deepseek-r1) */
  modelName?: string;
  /** 搜索估计的赢副率（传统算法），不与模型概率混用 */
  searchWinRate?: number;
  /** 模型候选选项概率（LLM / Laya） */
  probabilities?: Record<string, number>;
  /** 模型置信度 */
  confidence?: number;
  /** 发生回退时的原因说明 */
  fallbackReason?: string;
  /** 原始返回字符串（供调试排查） */
  rawOutput?: string;
  /** 发送给模型的请求入参（供调试审查） */
  requestPayload?: any;
  /** 异常详情（若发生异常或降级） */
  errorDetails?: string;
  /** 候选走法结构化评估列表 */
  candidateEvaluations?: CandidateMoveEvaluation[];
  /** 蒙特卡洛/PIMC 实际评估的样本世界数 */
  worldsEvaluated?: number;
  searchStatusCounts?: Record<string, number>;
}

export interface ActionDecision extends ProfileExecution {
  action: AiAction;
  engineType: EngineType;
  latencyMs: number;
  thinking?: string;
  conclusion?: string;
  worldsEvaluated?: number;
  confidence?: number;
  modelName?: string;
  probabilities?: Record<string, number>;
  fallbackReason?: string;
  errorDetails?: string;
  rawOutput?: string;
  requestPayload?: unknown;
  decision?: EngineDecision;
}

export interface DecisionEngine {
  readonly supportsModelRequestTelemetry?: boolean;
  readonly profileReference?: import('./profiles').ProfileReference;
  readonly type: EngineType;
  chooseCard(
    observation: PlayerObservation,
    candidates: readonly Card[],
    signal?: AbortSignal,
    options?: DecisionExecutionOptions,
  ): Promise<EngineDecision>;
  chooseAction?(
    observation: DecisionObservation,
    signal?: AbortSignal,
    options?: DecisionExecutionOptions,
  ): Promise<ActionDecision>;
  chooseBid?(
    observation: BiddingObservation,
    signal?: AbortSignal,
    options?: DecisionExecutionOptions,
  ): Promise<ActionDecision>;
  chooseTrump?(
    observation: TrumpObservation,
    signal?: AbortSignal,
    options?: DecisionExecutionOptions,
  ): Promise<ActionDecision>;
  chooseBury?(
    observation: BuryObservation,
    signal?: AbortSignal,
    options?: DecisionExecutionOptions,
  ): Promise<ActionDecision>;
}

export interface DecisionRecord extends ProfileExecution {
  id: string;
  timestamp: number;
  seat: number;
  engineType: EngineType;
  requestedEngine?: EngineType;
  roundNumber: number;
  trickNumber: number;
  ownHand: Card[];
  currentRound: { seat: number; card: Card }[];
  candidates: Card[];
  chosenCard?: Card;
  context?: DecisionContext;
  phase?: GameState['phase'];
  action?: AiAction;
  status?: 'evaluated' | 'applied' | 'stale';
  appliedNodeId?: string;
  latencyMs: number;
  /** 核心字段：思考过程与决策结论 */
  thinking?: string;
  conclusion?: string;
  modelName?: string;
  searchWinRate?: number;
  probabilities?: Record<string, number>;
  confidence?: number;
  fallbackReason?: string;
  diagnostic?: string;
  /** 局势快照与调试参数 */
  promptPayload?: any;
  requestPayload?: any;
  rawResponse?: string;
  errorDetails?: string;
  /** 决策时上帝视角透视状态快照 */
  inputVisibility?: InputVisibility;
  godModeState?: {
    enabled: boolean;
    peekedSeats: number[];
  };
  trump?: string | null;
  declarer?: number | null;
  bid?: number;
  declarerPoints?: number;
  defenderPoints?: number;
  /** 候选走法结构化评估列表 */
  candidateEvaluations?: CandidateMoveEvaluation[];
}

/**
 * 安全封装 fetch 调用，避免在浏览器环境下因未绑定 window 上下文抛出：
 * "Failed to execute 'fetch' on 'Window': Illegal invocation"
 */
export function bindSafeFetch(customFetch?: typeof fetch): typeof fetch {
  if (customFetch) {
    return (input: RequestInfo | URL, init?: RequestInit) => {
      if (typeof window !== 'undefined' && customFetch === window.fetch) {
        return window.fetch(input, init);
      }
      return customFetch(input, init);
    };
  }
  return (input: RequestInfo | URL, init?: RequestInit) => {
    if (typeof window !== 'undefined' && window.fetch) {
      return window.fetch(input, init);
    }
    return globalThis.fetch(input, init);
  };
}

/**
 * 规范化组合多个 AbortSignal，严格保留原始 reason，
 * 避免出现 "signal is aborted without reason"。
 */
export function safeAnySignal(signals: (AbortSignal | undefined)[]): {
  signal: AbortSignal;
  cleanup: () => void;
} {
  const validSignals = signals.filter((s): s is AbortSignal => !!s);
  if (validSignals.length === 0) {
    const controller = new AbortController();
    return { signal: controller.signal, cleanup: () => {} };
  }
  if (validSignals.length === 1) {
    return { signal: validSignals[0], cleanup: () => {} };
  }

  // 现代环境内置 AbortSignal.any 支持
  if (typeof (AbortSignal as any).any === 'function') {
    try {
      const anySig = (AbortSignal as any).any(validSignals);
      return { signal: anySig, cleanup: () => {} };
    } catch {
      // fallback to manual handling below
    }
  }

  const controller = new AbortController();
  const listeners: Array<{ s: AbortSignal; handler: () => void }> = [];

  for (const s of validSignals) {
    if (s.aborted) {
      controller.abort(s.reason);
      break;
    }
    const handler = () => {
      controller.abort(s.reason);
    };
    s.addEventListener('abort', handler, { once: true });
    listeners.push({ s, handler });
  }

  const cleanup = () => {
    for (const { s, handler } of listeners) {
      s.removeEventListener('abort', handler);
    }
  };

  return { signal: controller.signal, cleanup };
}


/** 将取消作为控制流，隔离不遵守 signal 的客户端迟到响应，并清理监听器。 */
export function abortable<T>(promise: Promise<T>, signal?: AbortSignal): Promise<T> {
  if (!signal) return promise;
  return new Promise<T>((resolve, reject) => {
    const cancelled = () => { cleanup(); reject(signal.reason ?? new DOMException('已取消决策', 'AbortError')); };
    const cleanup = () => signal.removeEventListener('abort', cancelled);
    promise.then(value => { cleanup(); if (!signal.aborted) resolve(value); else cancelled(); }, error => { cleanup(); reject(error); });
    if (signal.aborted) cancelled(); else signal.addEventListener('abort', cancelled, { once: true });
  });
}
