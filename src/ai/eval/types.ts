/**
 * 评估模块类型定义与评测报告接口 (依据 docs/ai-engine-model-evaluation-plan.md 规范设计)。
 */
import { Card } from '../../cards';
import { GameState } from '../../engine';
import { PlayerObservation } from '../optimized/contracts';
import {
  BaseEvaluationReport,
  TacticalRating,
} from '../engines/llm/llmEvaluator';

export type EvalPhase = 'bidding' | 'trump' | 'bury' | 'playing';

export type DecisionSource = 'model' | 'search/heuristic' | 'deterministic' | 'fallback' | 'mock';

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
  | 'CANCELLED';

export interface ScenarioSetupResult {
  state?: GameState;
  observation?: PlayerObservation;
  candidates?: readonly Card[];
  seat: number;
}

export interface EvalScenario {
  id: string;
  name: string;
  phase: EvalPhase;
  category: string;
  description: string;
  optimalActionDesc: string;
  setup: () => ScenarioSetupResult;
  /**
   * 判定实际动作是否达到预期标准。
   * 支持同时检查 BaseEvaluationReport 与具体 ActionDecision 内容。
   */
  expectedCriteria: (report: BaseEvaluationReport, rawDecision?: any) => boolean;
}

export interface ScenarioRunResult {
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
  suiteVersion: string;
  dataHash: string;
  configHash: string;
  codeHash?: string;
  scenarioIds: string[];
  engineConfigSnapshot: Record<string, unknown>;
  runId: string;
  engineType: string;
  modelName?: string;
  timestamp: string;
  totalScenarios: number;
  passedCount: number;
  passRate: number; // 0 ~ 1.0
  legalCount: number;
  legalRate: number; // 0 ~ 1.0
  /** 调用归因统计 */
  plannedModelCalls: number;
  actualModelCalls: number;
  nativeCallCount: number;
  nativeSuccessCount: number;
  nativeSuccessRate: number | null; // null 表示 N/A (零调用)
  fallbackCount: number;
  fallbackRate: number;
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

