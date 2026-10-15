/**
 * 评估数据、运行契约与报告类型；按接口隔离原则区分各阶段样本。
 */
import { Card, Rank, Suit } from '@yaozifen/game-core/cards';
import { GameState } from '@yaozifen/game-core';
import { PlayerObservation } from '@yaozifen/ai-core/optimized/contracts';
import {
  BaseEvaluationReport,
  TacticalRating,
} from '@yaozifen/ai-core/engines/llm/llmEvaluator';

export type EvalPhase = 'bidding' | 'trump' | 'bury' | 'playing';

export type DecisionSource = 'model' | 'search/heuristic' | 'deterministic' | 'fallback' | 'mock' | 'execution-failure';

export type EvalErrorCode =
  | 'TIMEOUT'
  | 'NETWORK_ERROR'
  | 'HTTP_ERROR'
  | 'PARSE_ERROR'
  | 'SCHEMA_ERROR'
  | 'ILLEGAL_ACTION'
  | 'STRATEGY_MISS'
  | 'UNSUPPORTED_PHASE'
  | 'STALE_RESPONSE'
  | 'CANCELLED'
  | 'EXECUTION_ERROR';

export interface ScenarioSetupResult {
  state?: GameState;
  observation?: PlayerObservation;
  candidates?: readonly Card[];
  seat: number;
}

export interface ScenarioMetadata {
  id: string;
  name: string;
  phase: EvalPhase;
  category: string;
  description: string;
  optimalActionDesc: string;
}

export type CardNotation = `${Rank}${Suit}`;

export interface ScenarioRoundCard {
  seat: number;
  card: CardNotation;
}

export interface ScenarioCompletedRound {
  trickNumber: number;
  winner: number;
  points: number;
  cards: ScenarioRoundCard[];
}

export type ScenarioDefinition = ScenarioMetadata & (
  | {
    phase: 'bidding';
    setup: {
      seat: number;
      hand: CardNotation[];
      highestBid?: number;
      highestBidder?: number | null;
      history?: Array<{ seat: number; bid: number | null }>;
    };
    expected: { bids: Array<number | null> } | { minBid: number; maxBid: number };
  }
  | {
    phase: 'trump';
    setup: { seat: number; hand: CardNotation[]; winningBid?: number };
    expected: { suits: Suit[] };
  }
  | {
    phase: 'bury';
    setup: { seat: number; hand16: CardNotation[]; trump: Suit; winningBid?: number };
    expected: {
      zeroPointsBuried: true;
      trumpsPreserved?: boolean;
      minVoidsCreated?: number;
      includeCards?: CardNotation[];
      excludeCards?: CardNotation[];
    };
  }
  | {
    phase: 'playing';
    setup: {
      seat: number;
      ownHand: CardNotation[];
      trump: Suit;
      declarer: number;
      bid: number;
      leader: number;
      roundNumber: number;
      currentRound: ScenarioRoundCard[];
      completedRounds?: ScenarioCompletedRound[];
      knownBuriedCards?: CardNotation[];
      revealedHand?: { seat: number; cards: CardNotation[] };
      declarerPoints?: number;
      defenderPoints?: number;
      voidSuits?: Suit[][];
    };
    expected: { cards?: CardNotation[]; excludeCards?: CardNotation[] };
  }
);

export interface EvalScenario extends ScenarioMetadata {
  /** JSON 样本定义参与指纹；仍允许调用方提供自定义函数场景。 */
  definition?: ScenarioDefinition;
  setup: () => ScenarioSetupResult;
  /**
   * 判定实际动作是否达到预期标准。
   * 支持同时检查 BaseEvaluationReport 与具体 ActionDecision 内容。
   */
  expectedCriteria: (report: BaseEvaluationReport, rawDecision?: unknown) => boolean;
}

export interface ScenarioRunResult {
  logicalDecisionId: string;
  /** null 表示该传输未提供统计；0 表示确认未发起请求。 */
  modelRequestCount: number | null;
  modelRetryCount: number | null;
  modelRequests: import('@yaozifen/ai-core/engines/engineTypes').ModelRequestEvent[];
  scenarioId: string;
  scenarioName: string;
  phase: EvalPhase;
  category: string;
  passed: boolean;
  isLegal: boolean;
  decisionSource: DecisionSource;
  isNative: boolean;
  score: number;
  tacticalRating: TacticalRating;
  latencyMs: number;
  thinking?: string;
  conclusion?: string;
  actionTaken: string;
  optimalActionDesc: string;
  fallbackReason?: string;
  failureReason?: string;
  errorCode?: EvalErrorCode;
  details: string;
  /** 可重放日志扩展字段 */
  engineConfigSnapshot?: Record<string, unknown>;
  inputObservation?: Record<string, unknown>;
  candidates?: string[];
  rawResponse?: unknown;
  sampledWorlds?: number;
}

export interface PhaseSummary {
  total: number;
  passed: number;
  averageScore: number;
  p50LatencyMs: number;
  p95LatencyMs: number;
}

export interface BenchmarkReportSummary {
  coverage: ScenarioCoverage;
  suiteVersion: string;
  dataHash: string;
  configHash: string;
  codeHash?: string;
  scenarioIds: string[];
  engineConfigSnapshot: Record<string, unknown>;
  runId: string;
  engineType: string;
  modelName?: string;
  dataset?: 'dev' | 'holdout' | string;
  timestamp: string;
  totalScenarios: number;
  passedCount: number;
  passRate: number; // 0 ~ 1.0
  legalCount: number;
  legalRate: number; // 0 ~ 1.0
  /** 调用归因统计 */
  plannedModelCalls: number;
  actualModelCalls: number | null;
  actualModelRetries: number | null;
  /** 已确认至少发起一次 HTTP 请求的逻辑决策数，不包括重试。 */
  nativeCallCount: number;
  nativeSuccessCount: number;
  nativeSuccessRate: number | null; // null 表示 N/A (零调用)
  fallbackCount: number;
  fallbackRate: number;
  executionFailureCount: number;
  mockCount: number;
  mockRate: number;
  averageScore: number;
  phaseMacroAverageScore: number;
  averageLatencyMs: number;
  p50LatencyMs: number;
  p95LatencyMs: number;
  phaseSummaries: Record<EvalPhase, PhaseSummary>;
  scenarioResults: ScenarioRunResult[];
}

/** 统计实际执行的公开回归题，不将分层覆盖等同于随机抽样。 */
export interface ScenarioCoverage {
  total: number;
  phaseSeats: Record<EvalPhase, number[]>;
  playingPositions: number[];
  trumpSuits: Record<'bury' | 'playing', Record<Suit, number>>;
  contracts: Record<'trump' | 'bury' | 'playing', Record<string, number>>;
  playingRoles: Record<'declarer' | 'partner' | 'defender', number>;
  roundBands: Record<'early' | 'middle' | 'late', number>;
  lateGame: number;
  criticalScores: { declarer: number; defender: number };
  knownBuriedCards: number;
  openHands: Record<'declarer' | 'partner' | 'defender', number>;
}

