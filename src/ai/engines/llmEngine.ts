/**
 * LLM 决策引擎（OpenAI 兼容 Chat Completions / Completions 协议适配）。
 * 适配 vLLM、DeepSeek 与 Qwen 系列；支持思维链（reasoning_content / <think>）提取与严格 JSON 输出。
 * 遵循 SOLID 原则，将提示词组装委托给 LlmPromptBuilder，响应解析与校验委托给 LlmResponseParser。
 * 默认超时时间延长至 20 秒 (20,000ms)，以保障深度思考模型 (Thinking Models) 有充裕时间推演。
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

export type LlmProtocol = 'chat' | 'completion';
export type LlmResponseFormat = 'json_object' | 'json_schema' | 'text';
export type ReasoningEffort = 'default' | 'none' | 'low' | 'medium' | 'high';

export interface LlmEngineOptions {
  baseUrl?: string;
  apiKey?: string;
  model?: string;
  protocol?: LlmProtocol;
  responseFormat?: LlmResponseFormat;
  reasoningEffort?: ReasoningEffort;
  timeoutMs?: number; // 默认 20,000ms (长超时)
  fetchFn?: typeof fetch;
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
  private fetchFn: typeof fetch;
  private enableDevMockOnFailure: boolean;

  constructor(options: LlmEngineOptions = {}) {
    this.baseUrl = options.baseUrl ?? 'http://127.0.0.1:8000/v1/';
    this.apiKey = options.apiKey;
    this.model = options.model ?? 'qwen38_27b';
    this.protocol = options.protocol ?? 'chat';
    this.responseFormat = options.responseFormat ?? 'json_object';
    this.reasoningEffort = options.reasoningEffort ?? 'default';
    this.timeoutMs = options.timeoutMs ?? 20000; // 默认延长至 20 秒
    this.fetchFn = bindSafeFetch(options.fetchFn);
    this.enableDevMockOnFailure = options.enableDevMockOnFailure ?? false;
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
      enableDevMockOnFailure: this.enableDevMockOnFailure,
    };
  }

  updateOptions(options: Partial<LlmEngineOptions>): void {
    if (options.baseUrl !== undefined) this.baseUrl = options.baseUrl;
    if (options.apiKey !== undefined) this.apiKey = options.apiKey;
    if (options.model !== undefined) this.model = options.model;
    if (options.protocol !== undefined) this.protocol = options.protocol;
    if (options.responseFormat !== undefined) this.responseFormat = options.responseFormat;
    if (options.reasoningEffort !== undefined) this.reasoningEffort = options.reasoningEffort;
    if (options.timeoutMs !== undefined) this.timeoutMs = options.timeoutMs;
    if (options.fetchFn !== undefined) this.fetchFn = bindSafeFetch(options.fetchFn);
    if (options.enableDevMockOnFailure !== undefined) {
      this.enableDevMockOnFailure = options.enableDevMockOnFailure;
    }
  }

  /**
   * 核心网络调度器 (遵循 DRY，统一处理超时控制与协议组装)
   */
  private async dispatchLlmRequest(
    messages: ChatMessage[],
    seat: number,
    signal?: AbortSignal,
    schemaConfig?: { name: string; schema: any },
  ): Promise<{ rawText: string; reasoningContent?: string; requestBody: any; latencyMs: number }> {
    const started = performance.now();
    const timeoutController = new AbortController();
    const timer = setTimeout(() => {
      timeoutController.abort(new DOMException(`LLM 请求超时 (${this.timeoutMs}ms)`, 'TimeoutError'));
    }, this.timeoutMs);
    const { signal: combinedSignal, cleanup } = safeAnySignal([signal, timeoutController.signal]);

    try {
      const headers: Record<string, string> = {
        'Content-Type': 'application/json',
      };
      if (this.apiKey) {
        headers['Authorization'] = `Bearer ${this.apiKey}`;
      }

      let url: string;
      let body: any;

      if (this.protocol === 'chat') {
        url = `${this.baseUrl.replace(/\/+$/, '')}/chat/completions`;
        const req: any = {
          model: this.model,
          messages,
        };
        if (this.reasoningEffort && this.reasoningEffort !== 'default') {
          req.reasoning_effort = this.reasoningEffort;
        } else {
          req.temperature = 0.1;
        }

        if (this.responseFormat === 'json_object') {
          req.response_format = { type: 'json_object' };
        } else if (this.responseFormat === 'json_schema' && schemaConfig) {
          req.response_format = {
            type: 'json_schema',
            json_schema: {
              name: schemaConfig.name,
              strict: true,
              schema: schemaConfig.schema,
            },
          };
        }
        body = req;
      } else {
        url = `${this.baseUrl.replace(/\/+$/, '')}/completions`;
        body = {
          model: this.model,
          prompt: `${messages[0].content}\n\n局面数据:\n${messages[1]?.content ?? ''}\n\n请输出JSON:`,
          temperature: 0.1,
        };
      }

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
          requestPayload: body,
        },
      );

      let response: Response;
      try {
        response = await this.fetchFn(url, {
          method: 'POST',
          headers,
          body: JSON.stringify(body),
          signal: combinedSignal,
        });
      } catch (networkError: any) {
        console.error(
          `%c[LLM Error] ❌ [${SEAT_NAMES[seat]}家] 网络连接或超时异常 · ${networkError.message}`,
          'color: #dc2626; font-weight: bold;',
          { seat, model: this.model, url, error: networkError },
        );
        throw networkError;
      }

      if (!response.ok) {
        const errBody = await response.text().catch(() => '');
        console.error(
          `%c[LLM Error] ❌ [${SEAT_NAMES[seat]}家] 服务端返回 HTTP 异常 · HTTP ${response.status} ${response.statusText}`,
          'color: #dc2626; font-weight: bold;',
          { status: response.status, statusText: response.statusText, responseBody: errBody, model: this.model, url },
        );
        throw new Error(`LLM 请求失败 (${response.status} ${response.statusText}): ${errBody.slice(0, 200)}`);
      }

      const resJson = await response.json();
      const choice = resJson.choices?.[0];
      const reasoningContent = choice?.message?.reasoning_content;
      const rawText = this.protocol === 'chat' ? choice?.message?.content : choice?.text;

      if (!rawText || typeof rawText !== 'string') {
        throw new Error('LLM 响应缺失有效文本内容');
      }

      return {
        rawText,
        reasoningContent,
        requestBody: body,
        latencyMs: performance.now() - started,
      };
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
    const started = performance.now();
    if (candidates.length === 0) throw new Error('候选牌集不能为空');
    if (candidates.length === 1) {
      return {
        card: candidates[0],
        engineType: 'llm',
        latencyMs: performance.now() - started,
        thinking: '根据跟牌规则，当前仅有 1 张合法可用手牌，无其他可选分支。',
        conclusion: '唯一合法候选直接出牌。',
        diagnostic: '唯一候选直接出牌',
        modelName: this.model,
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
    const started = performance.now();
    const legal = legalBids(state);
    if (legal.length === 0) {
      return {
        action: { kind: 'bid', seat, bid: null },
        engineType: 'llm',
        latencyMs: performance.now() - started,
        thinking: '无合法叫分档位，自动放弃',
        conclusion: '放弃叫分',
      };
    }

    if (this.enableDevMockOnFailure) {
      const fb = smartBid(state, seat);
      return {
        action: { kind: 'bid', seat, bid: fb },
        engineType: 'llm',
        latencyMs: performance.now() - started,
        thinking: 'LLM 策略推演评估手牌大牌控制力与长套吃分期望。',
        conclusion: fb === null ? '决定不叫' : `决定叫 ${fb} 分`,
      };
    }

    const messages = LlmPromptBuilder.buildBiddingMessages(state, seat, legal);

    try {
      const { rawText, reasoningContent, latencyMs } = await this.dispatchLlmRequest(messages, seat, signal);
      const parsed = LlmResponseParser.parseBid(rawText, legal, reasoningContent);

      return {
        action: { kind: 'bid', seat, bid: parsed.bid },
        engineType: 'llm',
        latencyMs,
        thinking: parsed.thinking,
        conclusion: parsed.conclusion,
        modelName: this.model,
        rawOutput: rawText,
      };
    } catch {
      // 容错降级
      const fallbackBid = smartBid(state, seat);
      return {
        action: { kind: 'bid', seat, bid: fallbackBid },
        engineType: 'llm',
        latencyMs: performance.now() - started,
        fallbackReason: 'LLM 叫分网络离线或解析异常，回退保山估值算法',
        thinking: '采用手牌折价与长套控制力算法估算叫分。',
        conclusion: fallbackBid === null ? '不叫' : `叫 ${fallbackBid} 分`,
      };
    }
  }

  /**
   * 3. 定主决策 (Trump)
   */
  async chooseTrump(state: GameState, seat: number, signal?: AbortSignal): Promise<ActionDecision> {
    const started = performance.now();
    const fallbackTrump = smartTrump(state, seat);

    if (this.enableDevMockOnFailure) {
      return {
        action: { kind: 'trump', seat, trump: fallbackTrump },
        engineType: 'llm',
        latencyMs: performance.now() - started,
        thinking: 'LLM 评估四门花色长度、控制力与绝门潜质。',
        conclusion: `选定主牌花色: ${fallbackTrump}`,
      };
    }

    const messages = LlmPromptBuilder.buildTrumpMessages(state, seat);

    try {
      const { rawText, reasoningContent, latencyMs } = await this.dispatchLlmRequest(messages, seat, signal);
      const parsed = LlmResponseParser.parseTrump(rawText, reasoningContent);

      return {
        action: { kind: 'trump', seat, trump: parsed.trump },
        engineType: 'llm',
        latencyMs,
        thinking: parsed.thinking,
        conclusion: parsed.conclusion,
        modelName: this.model,
        rawOutput: rawText,
      };
    } catch {
      return {
        action: { kind: 'trump', seat, trump: fallbackTrump },
        engineType: 'llm',
        latencyMs: performance.now() - started,
        fallbackReason: 'LLM 定主网络离线，回退定主算法',
        conclusion: `定主: ${fallbackTrump}`,
      };
    }
  }

  /**
   * 4. 扣底决策 (Bury)
   */
  async chooseBury(state: GameState, seat: number, signal?: AbortSignal): Promise<ActionDecision> {
    const started = performance.now();
    const fallbackCards = smartBury(state, seat);

    if (this.enableDevMockOnFailure) {
      return {
        action: { kind: 'bury', seat, cards: fallbackCards },
        engineType: 'llm',
        latencyMs: performance.now() - started,
        thinking: '扣底严格遵守规则：分牌不可扣底，优先垫掉杂色短门并保留主牌与长套大牌。',
        conclusion: `扣底 ${fallbackCards.map((c) => cardLabel(c)).join(' ')}。`,
      };
    }

    const messages = LlmPromptBuilder.buildBuryMessages(state, seat);
    const hand = state.hands[seat] ?? [];

    try {
      const { rawText, reasoningContent, latencyMs } = await this.dispatchLlmRequest(messages, seat, signal);
      const parsed = LlmResponseParser.parseBury(rawText, hand, reasoningContent);

      return {
        action: { kind: 'bury', seat, cards: parsed.cards },
        engineType: 'llm',
        latencyMs,
        thinking: parsed.thinking,
        conclusion: parsed.conclusion,
        modelName: this.model,
        rawOutput: rawText,
      };
    } catch {
      return {
        action: { kind: 'bury', seat, cards: fallbackCards },
        engineType: 'llm',
        latencyMs: performance.now() - started,
        fallbackReason: 'LLM 扣底网络离线或触碰红线，回退保山绝门扣底算法',
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
        engineType: 'llm',
        latencyMs: decision.latencyMs,
        thinking: decision.thinking,
        conclusion: decision.conclusion,
        confidence: decision.confidence,
        modelName: decision.modelName,
        probabilities: decision.probabilities,
        fallbackReason: decision.fallbackReason,
        errorDetails: decision.errorDetails,
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
      engineType: 'llm',
      latencyMs: performance.now() - started,
      thinking: thinkingNarrative,
      conclusion: conclusionNarrative,
      confidence: 0.95,
      diagnostic: `LLM (Dev模拟): ${conclusionNarrative}`,
      modelName: `${this.model} [DevMode]`,
      rawOutput: JSON.stringify({ thinking: thinkingNarrative, conclusion: conclusionNarrative, cardId: cardId(chosen) }, null, 2),
      requestPayload: _payload,
    };
  }
}
