/**
 * LLM 决策引擎（OpenAI 兼容 Chat Completions / Completions 协议适配）。
 * 适配 vLLM、DeepSeek 与 Qwen 系列；支持思维链（reasoning_content / <think>）提取与严格 JSON 输出。
 * 遵循 SOLID 原则，将提示词组装委托给 LlmPromptBuilder，响应解析与校验委托给 LlmResponseParser。
 * 默认请求预算为 60 秒；真实联调中存在超过 20 秒的有效响应，超时后明确回退。
 */
import { Card, cardId, cardLabel, cardPoints } from '../../cards';
import { PlayerObservation } from '../optimized/contracts';
import {
  DecisionEngine, EngineDecision, ActionDecision, ThinkingCallback, bindSafeFetch, safeAnySignal,
} from './engineTypes';
import { partnerOf, sideOf, SEAT_NAMES, GameState, legalBids, legalMoves } from '../../engine';
import { observePlayer } from '../optimized/observation';
import { pruneCandidates } from '../tactics';
import { smartBid, smartTrump, smartBury } from '../smart';
import { LlmPromptBuilder, ChatMessage } from './llm/llmPrompts';
import { LlmResponseParser } from './llm/llmParser';

import {
  ILlmClient,
  OpenAiSdkClient,
  FetchLlmClient,
  LlmProtocol,
  LlmResponseFormat,
  ReasoningEffort,
} from './llm/llmClient';

export type { LlmProtocol, LlmResponseFormat, ReasoningEffort };

export interface LlmEngineOptions {
  baseUrl?: string;
  apiKey?: string;
  model?: string;
  protocol?: LlmProtocol;
  responseFormat?: LlmResponseFormat;
  reasoningEffort?: ReasoningEffort;
  timeoutMs?: number; // 默认 60,000ms
  fetchFn?: typeof fetch;
  client?: ILlmClient;
  maxRetries?: number;
  enableDevMockOnFailure?: boolean; // 开发环境网络不可达时启用保山战术推演模拟
}

export class LlmEngine implements DecisionEngine {
  readonly type = 'llm' as const;
  private baseUrl: string;
  private apiKey?: string;
  private model: string;
  private protocol: LlmProtocol;
  private responseFormat: LlmResponseFormat;
  private reasoningEffort: ReasoningEffort;
  private timeoutMs: number;
  private fetchFn?: typeof fetch;
  private enableDevMockOnFailure: boolean;
  private maxRetries: number;
  private client: ILlmClient;

  constructor(options: LlmEngineOptions = {}) {
    this.baseUrl = options.baseUrl ?? 'http://127.0.0.1:8000/v1/';
    this.apiKey = options.apiKey;
    this.model = options.model ?? 'qwen38_27b';
    this.protocol = options.protocol ?? 'chat';
    this.responseFormat = options.responseFormat ?? 'json_object';
    this.reasoningEffort = options.reasoningEffort ?? 'default';
    this.timeoutMs = options.timeoutMs ?? 60000; // 显式配置仍优先
    this.fetchFn = options.fetchFn ? bindSafeFetch(options.fetchFn) : undefined;
    this.enableDevMockOnFailure = options.enableDevMockOnFailure ?? false;
    this.maxRetries = options.maxRetries ?? 2;
    this.client = options.client ?? this.createClient();
  }

  private createClient(): ILlmClient {
    if (this.fetchFn) {
      return new FetchLlmClient({
        baseUrl: this.baseUrl,
        apiKey: this.apiKey,
        timeoutMs: this.timeoutMs,
        fetchFn: this.fetchFn,
      });
    }
    return new OpenAiSdkClient({
      baseUrl: this.baseUrl,
      apiKey: this.apiKey,
      timeoutMs: this.timeoutMs,
      maxRetries: this.maxRetries,
      dangerouslyAllowBrowser: true,
    });
  }

  getOptions(): LlmEngineOptions {
    return {
      baseUrl: this.baseUrl,
      apiKey: this.apiKey,
      model: this.model,
      protocol: this.protocol,
      responseFormat: this.responseFormat,
      reasoningEffort: this.reasoningEffort,
      timeoutMs: this.timeoutMs,
      fetchFn: this.fetchFn,
      client: this.client,
      maxRetries: this.maxRetries,
      enableDevMockOnFailure: this.enableDevMockOnFailure,
    };
  }

  updateOptions(options: Partial<LlmEngineOptions>): void {
    let needReinit = false;
    if (options.baseUrl !== undefined && options.baseUrl !== this.baseUrl) {
      this.baseUrl = options.baseUrl;
      needReinit = true;
    }
    if (options.apiKey !== undefined && options.apiKey !== this.apiKey) {
      this.apiKey = options.apiKey;
      needReinit = true;
    }
    if (options.model !== undefined) this.model = options.model;
    if (options.protocol !== undefined) this.protocol = options.protocol;
    if (options.responseFormat !== undefined) this.responseFormat = options.responseFormat;
    if (options.reasoningEffort !== undefined) this.reasoningEffort = options.reasoningEffort;
    if (options.timeoutMs !== undefined && options.timeoutMs !== this.timeoutMs) {
      this.timeoutMs = options.timeoutMs;
      needReinit = true;
    }
    if (options.maxRetries !== undefined && options.maxRetries !== this.maxRetries) {
      this.maxRetries = options.maxRetries;
      needReinit = true;
    }
    if (options.fetchFn !== undefined) {
      this.fetchFn = options.fetchFn ? bindSafeFetch(options.fetchFn) : undefined;
      needReinit = true;
    }
    if (options.enableDevMockOnFailure !== undefined) {
      this.enableDevMockOnFailure = options.enableDevMockOnFailure;
    }

    if (options.client !== undefined) {
      this.client = options.client;
    } else if (needReinit) {
      this.client = this.createClient();
    }
  }

  getClient(): ILlmClient {
    return this.client;
  }

  /**
   * 核心网络调度器 (遵循 DRY 与 DIP，通过 ILlmClient 委托官方 SDK 或 Fetch 完成请求)
   */
  private async dispatchLlmRequest(
    messages: ChatMessage[],
    seat: number,
    signal?: AbortSignal,
    schemaConfig?: { name: string; schema: any },
  ): Promise<{ rawText: string; reasoningContent?: string; requestBody: any; latencyMs: number }> {
    const timeoutController = new AbortController();
    const timer = setTimeout(() => {
      timeoutController.abort(new DOMException(`LLM 请求超时 (${this.timeoutMs}ms)`, 'TimeoutError'));
    }, this.timeoutMs);
    const { signal: combinedSignal, cleanup } = safeAnySignal([signal, timeoutController.signal]);

    const url = this.protocol === 'chat'
      ? `${this.baseUrl.replace(/\/+$/, '')}/chat/completions`
      : `${this.baseUrl.replace(/\/+$/, '')}/completions`;

    console.info(
      `%c[LLM Request] 🚀 [${SEAT_NAMES[seat]}家] 发送决策请求 · 模型: ${this.model}`,
      'color: #2563eb; font-weight: bold;',
      {
        seat,
        seatName: SEAT_NAMES[seat],
        model: this.model,
        protocol: this.protocol,
        url,
        timeoutMs: this.timeoutMs,
        client: this.client.constructor.name,
      },
    );

    try {
      const res = await this.client.complete({
        model: this.model,
        protocol: this.protocol,
        messages,
        reasoningEffort: this.reasoningEffort,
        responseFormat: this.responseFormat,
        schemaConfig,
        signal: combinedSignal,
      });
      return res;
    } catch (networkError: any) {
      console.error(
        `%c[LLM Error] ❌ [${SEAT_NAMES[seat]}家] 网络连接或超时异常 · ${networkError.message}`,
        'color: #dc2626; font-weight: bold;',
        { seat, model: this.model, url, error: networkError },
      );
      if (combinedSignal.aborted) throw combinedSignal.reason ?? networkError;
      throw networkError;
    } finally {
      clearTimeout(timer);
      cleanup();
    }
  }

  /**
   * 1. 出牌决策 (Play Card)
   */
  async chooseCard(
    observation: PlayerObservation,
    candidates: readonly Card[],
    signal?: AbortSignal,
    options?: { onThinkingProgress?: ThinkingCallback },
  ): Promise<EngineDecision> {
    if (signal?.aborted) throw signal.reason ?? new DOMException('已取消决策', 'AbortError');
    const started = performance.now();
    if (candidates.length === 0) throw new Error('候选牌集不能为空');
    if (candidates.length === 1) {
      return {
        card: candidates[0],
        engineType: 'bridge',
        latencyMs: performance.now() - started,
        thinking: '根据跟牌规则，当前仅有 1 张合法可用手牌，无其他可选分支。',
        conclusion: '唯一合法候选直接出牌。',
        diagnostic: '唯一候选直接出牌',
      };
    }

    const onProgress = options?.onThinkingProgress;
    onProgress?.({
      seat: observation.seat,
      text: '🧠 正在分析盘面局面、搭档牌力与对手断门...',
      phase: 'thinking',
    });

    const messages = LlmPromptBuilder.buildPlayMessages(observation, candidates);

    try {
      const { rawText, reasoningContent, requestBody, latencyMs } = await this.dispatchLlmRequest(
        messages,
        observation.seat,
        signal,
        {
          name: 'play_decision',
          schema: {
            type: 'object',
            properties: {
              thinking: { type: 'string' },
              conclusion: { type: 'string' },
              cardId: {
                type: 'string',
                enum: candidates.map((c) => cardId(c)),
              },
              confidence: { type: 'number' },
              reason: { type: 'string' },
            },
            required: ['cardId'],
            additionalProperties: false,
          },
        },
      );

      const parsed = LlmResponseParser.parsePlay(rawText, candidates, reasoningContent);

      onProgress?.({
        seat: observation.seat,
        text: parsed.thinking,
        phase: 'decided',
        conclusion: parsed.conclusion,
        chosenCard: parsed.card,
      });

      console.info(
        `%c[LLM Response] ✅ [${SEAT_NAMES[observation.seat]}家] 出牌决策完成 · 耗时 ${Math.round(latencyMs)}ms`,
        'color: #16a34a; font-weight: bold;',
        {
          seat: observation.seat,
          model: this.model,
          chosenCard: `${parsed.card.rank}${parsed.card.suit} (${cardLabel(parsed.card)})`,
          conclusion: parsed.conclusion,
          confidence: parsed.confidence,
        },
      );

      return {
        card: parsed.card,
        engineType: 'llm',
        latencyMs,
        thinking: parsed.thinking,
        conclusion: parsed.conclusion,
        confidence: parsed.confidence,
        diagnostic: `LLM (${this.model}): ${parsed.conclusion}`,
        modelName: this.model,
        rawOutput: rawText,
        requestPayload: requestBody,
      };
    } catch (err: any) {
      if (this.enableDevMockOnFailure && !signal?.aborted) {
        return await this.simulateDevDecision(
          observation,
          candidates,
          started,
          messages,
          onProgress,
        );
      }
      throw err;
    }
  }

  /**
   * 2. 叫分决策 (Bid)
   */
  async chooseBid(state: GameState, seat: number, signal?: AbortSignal): Promise<ActionDecision> {
    if (signal?.aborted) throw signal.reason ?? new DOMException('已取消决策', 'AbortError');
    const started = performance.now();
    const legal = legalBids(state);
    if (legal.length === 0) {
      return {
        action: { kind: 'bid', seat, bid: null },
        engineType: 'bridge',
        latencyMs: performance.now() - started,
        thinking: '无合法叫分档位，自动放弃',
        conclusion: '放弃叫分',
      };
    }

    if (this.enableDevMockOnFailure) {
      const fb = smartBid(state, seat);
      return {
        action: { kind: 'bid', seat, bid: fb },
        engineType: 'bridge',
        fallbackReason: '开发模拟：使用启发式算法，未调用模型',
        latencyMs: performance.now() - started,
        thinking: '开发模拟策略评估手牌大牌控制力与长套吃分期望。',
        conclusion: fb === null ? '决定不叫' : `决定叫 ${fb} 分`,
      };
    }

    const messages = LlmPromptBuilder.buildBiddingMessages(state, seat, legal);

    let rawOutput: string | undefined;
    let requestPayload: unknown;
    try {
      const { rawText, reasoningContent, requestBody, latencyMs } = await this.dispatchLlmRequest(messages, seat, signal, {
        name: 'bid_decision', schema: {
          type: 'object', properties: {
            bid: { type: ['integer', 'null'], enum: [...legal, null] },
            thinking: { type: 'string' }, conclusion: { type: 'string' },
          }, required: ['bid', 'thinking', 'conclusion'], additionalProperties: false,
        },
      });
      rawOutput = rawText; requestPayload = requestBody;
      const parsed = LlmResponseParser.parseBid(rawText, legal, reasoningContent);

      return {
        action: { kind: 'bid', seat, bid: parsed.bid },
        engineType: 'llm',
        latencyMs,
        thinking: parsed.thinking,
        conclusion: parsed.conclusion,
        modelName: this.model,
        rawOutput: rawText,
        requestPayload: requestBody,
      };
    } catch (error) {
      if (signal?.aborted) throw error;
      const errorDetails = error instanceof Error ? error.message : String(error);
      // 容错降级
      const fallbackBid = smartBid(state, seat);
      return {
        action: { kind: 'bid', seat, bid: fallbackBid },
        engineType: 'bridge',
        latencyMs: performance.now() - started,
        fallbackReason: 'LLM 叫分回退：' + errorDetails,
        errorDetails, rawOutput, requestPayload,
        thinking: '采用手牌折价与长套控制力算法估算叫分。',
        conclusion: fallbackBid === null ? '不叫' : `叫 ${fallbackBid} 分`,
      };
    }
  }

  /**
   * 3. 定主决策 (Trump)
   */
  async chooseTrump(state: GameState, seat: number, signal?: AbortSignal): Promise<ActionDecision> {
    if (signal?.aborted) throw signal.reason ?? new DOMException('已取消决策', 'AbortError');
    const started = performance.now();
    const fallbackTrump = smartTrump(state, seat);

    if (this.enableDevMockOnFailure) {
      return {
        action: { kind: 'trump', seat, trump: fallbackTrump },
        engineType: 'bridge',
        fallbackReason: '开发模拟：使用启发式算法，未调用模型',
        latencyMs: performance.now() - started,
        thinking: '开发模拟评估四门花色长度、控制力与绝门潜质。',
        conclusion: `选定主牌花色: ${fallbackTrump}`,
      };
    }

    const messages = LlmPromptBuilder.buildTrumpMessages(state, seat);

    let rawOutput: string | undefined;
    let requestPayload: unknown;
    try {
      const { rawText, reasoningContent, requestBody, latencyMs } = await this.dispatchLlmRequest(messages, seat, signal, {
        name: 'trump_decision', schema: {
          type: 'object', properties: {
            trump: { type: 'string', enum: ['S', 'H', 'C', 'D'] },
            thinking: { type: 'string' }, conclusion: { type: 'string' },
          }, required: ['trump', 'thinking', 'conclusion'], additionalProperties: false,
        },
      });
      rawOutput = rawText; requestPayload = requestBody;
      const parsed = LlmResponseParser.parseTrump(rawText, reasoningContent);

      return {
        action: { kind: 'trump', seat, trump: parsed.trump },
        engineType: 'llm',
        latencyMs,
        thinking: parsed.thinking,
        conclusion: parsed.conclusion,
        modelName: this.model,
        rawOutput: rawText,
        requestPayload: requestBody,
      };
    } catch (error) {
      if (signal?.aborted) throw error;
      const errorDetails = error instanceof Error ? error.message : String(error);
      return {
        action: { kind: 'trump', seat, trump: fallbackTrump },
        engineType: 'bridge',
        latencyMs: performance.now() - started,
        fallbackReason: 'LLM 定主回退：' + errorDetails,
        errorDetails, rawOutput, requestPayload,
        conclusion: `定主: ${fallbackTrump}`,
      };
    }
  }

  /**
   * 4. 扣底决策 (Bury)
   */
  async chooseBury(state: GameState, seat: number, signal?: AbortSignal): Promise<ActionDecision> {
    if (signal?.aborted) throw signal.reason ?? new DOMException('已取消决策', 'AbortError');
    const started = performance.now();
    const fallbackCards = smartBury(state, seat);

    if (this.enableDevMockOnFailure) {
      return {
        action: { kind: 'bury', seat, cards: fallbackCards },
        engineType: 'bridge',
        fallbackReason: '开发模拟：使用启发式算法，未调用模型',
        latencyMs: performance.now() - started,
        thinking: '扣底严格遵守规则：分牌不可扣底，优先垫掉杂色短门并保留主牌与长套大牌。',
        conclusion: `扣底 ${fallbackCards.map((c) => cardLabel(c)).join(' ')}。`,
      };
    }

    const messages = LlmPromptBuilder.buildBuryMessages(state, seat);
    const hand = state.hands[seat] ?? [];

    let rawOutput: string | undefined;
    let requestPayload: unknown;
    try {
      const { rawText, reasoningContent, requestBody, latencyMs } = await this.dispatchLlmRequest(messages, seat, signal, {
        name: 'bury_decision', schema: {
          type: 'object', properties: {
            cards: { type: 'array', minItems: 4, maxItems: 4,
              items: { type: 'string', enum: hand.filter(card => cardPoints(card) === 0).map(cardId) } },
            thinking: { type: 'string' }, conclusion: { type: 'string' },
          }, required: ['cards', 'thinking', 'conclusion'], additionalProperties: false,
        },
      });
      rawOutput = rawText; requestPayload = requestBody;
      const parsed = LlmResponseParser.parseBury(rawText, hand, reasoningContent);

      return {
        action: { kind: 'bury', seat, cards: parsed.cards },
        engineType: 'llm',
        latencyMs,
        thinking: parsed.thinking,
        conclusion: parsed.conclusion,
        modelName: this.model,
        rawOutput: rawText,
        requestPayload: requestBody,
      };
    } catch (error) {
      if (signal?.aborted) throw error;
      const errorDetails = error instanceof Error ? error.message : String(error);
      return {
        action: { kind: 'bury', seat, cards: fallbackCards },
        engineType: 'bridge',
        latencyMs: performance.now() - started,
        fallbackReason: 'LLM 扣底回退：' + errorDetails,
        errorDetails, rawOutput, requestPayload,
        thinking: '扣底遵循保山幺子分铁律：严禁扣分牌 (A/10/5)，优先扣除短门制造主牌毙杀机会。',
        conclusion: `扣底 ${fallbackCards.map((c) => cardLabel(c)).join(' ')}。`,
      };
    }
  }

  /**
   * 5. 全生命周期统一动作入口 (Dispatcher)
   */
  async chooseAction(
    state: GameState,
    seat: number,
    signal?: AbortSignal,
    options?: { onThinkingProgress?: ThinkingCallback },
  ): Promise<ActionDecision> {
    if (state.phase === 'bidding') {
      return this.chooseBid(state, seat, signal);
    }
    if (state.phase === 'trump') {
      return this.chooseTrump(state, seat, signal);
    }
    if (state.phase === 'bury') {
      return this.chooseBury(state, seat, signal);
    }
    if (state.phase === 'playing') {
      const observation = observePlayer(state, seat);
      const legal = legalMoves(state, seat);
      const candidates = pruneCandidates(observation, legal);
      const decision = await this.chooseCard(observation, candidates, signal, options);
      return {
        action: { kind: 'play', seat, card: decision.card },
        decision,
        engineType: decision.engineType,
        latencyMs: decision.latencyMs,
        thinking: decision.thinking,
        conclusion: decision.conclusion,
        confidence: decision.confidence,
        modelName: decision.modelName,
        probabilities: decision.probabilities,
        fallbackReason: decision.fallbackReason,
        errorDetails: decision.errorDetails,
        rawOutput: decision.rawOutput, requestPayload: decision.requestPayload,
      };
    }
    throw new Error(`不支持的状态阶段: ${state.phase}`);
  }

  /**
   * 本地开发调试模拟决策器（Dev Tactical Simulator）
   */
  private async simulateDevDecision(
    observation: PlayerObservation,
    candidates: readonly Card[],
    started: number,
    _payload: any,
    onProgress?: ThinkingCallback,
  ): Promise<EngineDecision> {
    const seat = observation.seat;
    const partnerSeat = partnerOf(seat);
    const mySide = sideOf(seat);
    const currentTrick = observation.currentRound;

    let partnerCard: Card | undefined;
    for (const t of currentTrick) {
      if (t.seat === partnerSeat) partnerCard = t.card;
    }

    const partnerLedOrFollowed = partnerCard ? `搭档出 ${cardLabel(partnerCard)}` : '搭档尚未出牌';
    const candLabels = candidates.map((c) => cardLabel(c)).join('、');

    let chosen = candidates[0];
    let thinkingNarrative = '';
    let conclusionNarrative = '';

    if (currentTrick.length > 0) {
      const isPartnerWinning = currentTrick.some((t) => sideOf(t.seat) === mySide);
      if (isPartnerWinning) {
        const zeroCards = candidates.filter((c) => cardPoints(c) === 0);
        if (zeroCards.length > 0) {
          chosen = zeroCards[zeroCards.length - 1];
          thinkingNarrative = `【局势剖析】当前轮次中，${partnerLedOrFollowed}，己方具备赢轮优势。\n【保牌权衡】可选候选集为 [${candLabels}]。根据保山幺子分经典战术，绝不能无谓损耗高牌力控制牌（如K/Q），而应跟出最小0分牌保牌。`;
          conclusionNarrative = `跟出最小0分牌 ${cardLabel(chosen)} 保牌，保护控制牌并稳妥拿墩。`;
        } else {
          chosen = candidates[0];
          thinkingNarrative = `【局势剖析】当前轮次搭档处于有利地位。候选集 [${candLabels}] 中均为分牌，选择安全喂分。`;
          conclusionNarrative = `安全垫出分牌 ${cardLabel(chosen)} 送入本队得分账目。`;
        }
      } else {
        thinkingNarrative = `【局势剖析】当前对手处于领跑，必须评估是否超车夺取领出权。候选集 [${candLabels}]。\n【权衡推演】权衡手牌控制力与得分收益后，决定出牌。`;
        conclusionNarrative = `打出 ${cardLabel(chosen)} 争夺本轮控制权或规避大分损失。`;
      }
    } else {
      thinkingNarrative = `【领出推演】轮到首家主动领出。手牌有 ${candLabels}。\n【控牌策略】优先兑现确定赢张或拔除对手阻碍主牌，掌握后续控球权。`;
      conclusionNarrative = `主动领出 ${cardLabel(chosen)}，建立行牌主动权。`;
    }

    const chunks = [
      '🧠 正在检索对局历史与已知断门...',
      thinkingNarrative.slice(0, Math.floor(thinkingNarrative.length / 2)),
      thinkingNarrative,
    ];

    for (const chunk of chunks) {
      onProgress?.({
        seat,
        text: chunk,
        phase: 'thinking',
      });
      await new Promise((r) => setTimeout(r, 120));
    }

    onProgress?.({
      seat,
      text: thinkingNarrative,
      phase: 'decided',
      conclusion: conclusionNarrative,
      chosenCard: chosen,
    });

    return {
      card: chosen,
      engineType: 'bridge',
      latencyMs: performance.now() - started,
      thinking: thinkingNarrative,
      conclusion: conclusionNarrative,
      fallbackReason: '开发模拟：未调用模型，不计入模型评估',
      diagnostic: `LLM (Dev模拟): ${conclusionNarrative}`,
      rawOutput: JSON.stringify({ thinking: thinkingNarrative, conclusion: conclusionNarrative, cardId: cardId(chosen) }, null, 2),
      requestPayload: _payload,
    };
  }
}
