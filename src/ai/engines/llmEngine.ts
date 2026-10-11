/**
 * LLM 决策引擎（OpenAI 兼容 Chat Completions / Completions 协议适配）。
 * 适配 vLLM 与 DeepSeek；支持思维链（reasoning_content / <think>）提取与结构化输出；默认超时 8 秒。
 */
import { Card, cardId, cardLabel, cardPoints } from '../../cards';
import { PlayerObservation } from '../optimized/contracts';
import { DecisionEngine, EngineDecision, ThinkingCallback, bindSafeFetch } from './engineTypes';
import { partnerOf, sideOf, SEAT_NAMES } from '../../engine';

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
  timeoutMs?: number; // 默认 8000ms
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
    this.baseUrl = options.baseUrl ?? 'http://211.141.18.165:6195/v1/';
    this.apiKey = options.apiKey;
    this.model = options.model ?? 'qwen38_27b';
    this.protocol = options.protocol ?? 'chat';
    this.responseFormat = options.responseFormat ?? 'json_object';
    this.reasoningEffort = options.reasoningEffort ?? 'default';
    this.timeoutMs = options.timeoutMs ?? 8000;
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

    const candidateOptions = candidates.map((c) => ({
      cardId: cardId(c),
      label: cardLabel(c),
      points: cardPoints(c),
    }));

    const systemPrompt = `你是一个专业的云南保山幺子分纸牌大师。
游戏核心规则：
1. 四人对局，东西方与南北方搭档对战。搭档隔座。
2. 同门大小顺序：A > K > Q > J > 10 > 9 > 8 > 7 > 6 > 5 > 4 > 3 > 2。
3. 全副牌中仅 A(10分)、10(10分)、5(5分)为分牌，K/Q/J均为0分牌。
4. 跟牌约束：有同门必须跟同门。
5. 核心策略：团队赢副与分数吃进优先；当搭档出的牌已确定稳赢本轮时，应垫最小同门零分牌或安全喂分，严禁无收益消耗高牌力控制牌（如K）。
请严格以 JSON 格式输出决策，包含以下字段：
- "thinking": 深入分析当前局面与对手断门、搭档牌力配合、候选牌利弊推演与保牌权衡
- "conclusion": 最终选牌决策总结与清晰战术意图（例如“跟出最小0分牌 ♦2 保牌，搭档 ♦A 已稳赢本轮吃进 10 分”）
- "cardId": 必须为候选牌中的 cardId
- "confidence": 0 到 1 之间的决策置信度数值
可选兼容字段 "reason"（若提供则作为结论补充）。`;

    const userPayload = {
      seat: observation.seat,
      seatName: SEAT_NAMES[observation.seat],
      hand: observation.ownHand.map((c) => cardLabel(c)),
      revealed_partner_hand: observation.revealedHand
        ? observation.revealedHand.cards.map((c) => cardLabel(c))
        : null,
      trump: observation.trump,
      declarer: observation.declarer,
      bid: observation.bid,
      declarerPoints: observation.declarerPoints,
      defenderPoints: observation.defenderPoints,
      current_trick: observation.currentRound.map((entry) => ({
        seat: entry.seat,
        seatName: SEAT_NAMES[entry.seat],
        card: cardLabel(entry.card),
      })),
      candidates: candidateOptions,
    };

    const timeoutController = new AbortController();
    const timer = setTimeout(() => timeoutController.abort(), this.timeoutMs);
    const combinedSignal = signal
      ? anySignal([signal, timeoutController.signal])
      : timeoutController.signal;

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
          messages: [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: JSON.stringify(userPayload) },
          ],
        };
        if (this.reasoningEffort && this.reasoningEffort !== 'default') {
          req.reasoning_effort = this.reasoningEffort;
        } else {
          req.temperature = 0.1;
        }
        if (this.responseFormat === 'json_object') {
          req.response_format = { type: 'json_object' };
        } else if (this.responseFormat === 'json_schema') {
          req.response_format = {
            type: 'json_schema',
            json_schema: {
              name: 'play_decision',
              strict: true,
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
          };
        }
        body = req;
      } else {
        url = `${this.baseUrl.replace(/\/+$/, '')}/completions`;
        body = {
          model: this.model,
          prompt: `${systemPrompt}\n\n局面数据:\n${JSON.stringify(userPayload)}\n\n请输出JSON:`,
          temperature: 0.1,
        };
      }

      let response: Response;
      console.info(
        `%c[LLM Request] 🚀 [${SEAT_NAMES[observation.seat]}家] 发送出牌决策请求 · 模型: ${this.model}`,
        'color: #2563eb; font-weight: bold;',
        {
          seat: observation.seat,
          seatName: SEAT_NAMES[observation.seat],
          model: this.model,
          protocol: this.protocol,
          url,
          candidates: candidateOptions,
          requestPayload: body,
        },
      );

      try {
        response = await this.fetchFn(url, {
          method: 'POST',
          headers,
          body: JSON.stringify(body),
          signal: combinedSignal,
        });
      } catch (networkError: any) {
        console.error(
          `%c[LLM Error] ❌ [${SEAT_NAMES[observation.seat]}家] 网络连接或超时异常 · ${networkError.message}`,
          'color: #dc2626; font-weight: bold;',
          {
            seat: observation.seat,
            seatName: SEAT_NAMES[observation.seat],
            model: this.model,
            url,
            error: networkError,
            requestPayload: body,
          },
        );
        // 如果网络请求失败且在开发调试模式，提供真实感极高的战术模拟，便于在 run dev 下实时观察思考气泡与日志
        if (this.enableDevMockOnFailure && !signal?.aborted) {
          return await this.simulateDevDecision(
            observation,
            candidates,
            started,
            body,
            onProgress,
          );
        }
        throw networkError;
      }

      if (!response.ok) {
        const errBody = await response.text().catch(() => '');
        console.error(
          `%c[LLM Error] ❌ [${SEAT_NAMES[observation.seat]}家] 服务端返回 HTTP 异常 · HTTP ${response.status} ${response.statusText}`,
          'color: #dc2626; font-weight: bold;',
          {
            status: response.status,
            statusText: response.statusText,
            responseBody: errBody,
            model: this.model,
            url,
            requestPayload: body,
          },
        );
        if (this.enableDevMockOnFailure && !signal?.aborted) {
          return await this.simulateDevDecision(
            observation,
            candidates,
            started,
            body,
            onProgress,
          );
        }
        throw new Error(`LLM 请求失败 (${response.status} ${response.statusText}): ${errBody.slice(0, 200)}`);
      }

      const resJson = await response.json();
      const choice = resJson.choices?.[0];
      const reasoningContent = choice?.message?.reasoning_content;
      let content =
        this.protocol === 'chat'
          ? choice?.message?.content
          : choice?.text;

      if (!content || typeof content !== 'string') {
        console.error(
          `%c[LLM Error] ❌ [${SEAT_NAMES[observation.seat]}家] 响应缺失有效文本内容`,
          'color: #dc2626; font-weight: bold;',
          { resJson, requestPayload: body },
        );
        throw new Error('LLM 响应缺失有效文本内容');
      }

      // 提取并剥离可能存在的 <think>...</think> 思考链
      let embeddedThinking = '';
      const thinkMatch = content.match(/<think>([\s\S]*?)<\/think>/i);
      if (thinkMatch) {
        embeddedThinking = thinkMatch[1].trim();
        content = content.replace(/<think>[\s\S]*?<\/think>/i, '').trim();
      }

      // 清理可能的 Markdown 代码块包裹
      const cleanJson = content
        .replace(/^```(?:json)?\s*/i, '')
        .replace(/\s*```$/i, '')
        .trim();

      let parsed: any;
      try {
        parsed = JSON.parse(cleanJson);
      } catch (jsonErr: any) {
        console.error(
          `%c[LLM Error] ❌ [${SEAT_NAMES[observation.seat]}家] JSON 解析失败 · ${jsonErr.message}`,
          'color: #dc2626; font-weight: bold;',
          { rawContent: content, cleanJson, jsonErr, requestPayload: body },
        );
        throw new Error(`LLM 响应无法解析为 JSON: ${jsonErr.message}`);
      }

      const chosenId = parsed.cardId;
      if (!chosenId || typeof chosenId !== 'string') {
        console.error(
          `%c[LLM Error] ❌ [${SEAT_NAMES[observation.seat]}家] 输出缺失 cardId 字段`,
          'color: #dc2626; font-weight: bold;',
          { parsed, rawContent: content },
        );
        throw new Error('LLM 输出 JSON 缺失 cardId 字段');
      }

      const matched = candidates.find((c) => cardId(c) === chosenId);
      if (!matched) {
        console.error(
          `%c[LLM Error] ❌ [${SEAT_NAMES[observation.seat]}家] 返回非法候选牌 · 选择: ${chosenId}`,
          'color: #dc2626; font-weight: bold;',
          { chosenId, validCandidates: candidateOptions },
        );
        throw new Error(`LLM 返回非法候选牌: ${chosenId}，不在当前可选范围内`);
      }

      const rawThinking = parsed.thinking || parsed.thought || '';
      const rawConclusion = parsed.conclusion || parsed.reason || `出牌 ${cardLabel(matched)}`;
      const combinedThinking = [reasoningContent, embeddedThinking, rawThinking]
        .filter(Boolean)
        .join('\n\n') || `模型根据牌局战术权衡，决定出 ${cardLabel(matched)}。`;

      onProgress?.({
        seat: observation.seat,
        text: combinedThinking,
        phase: 'decided',
        conclusion: rawConclusion,
        chosenCard: matched,
      });

      console.info(
        `%c[LLM Response] ✅ [${SEAT_NAMES[observation.seat]}家] 决策完成 · 耗时 ${Math.round(performance.now() - started)}ms`,
        'color: #16a34a; font-weight: bold;',
        {
          seat: observation.seat,
          seatName: SEAT_NAMES[observation.seat],
          model: this.model,
          chosenCard: `${matched.rank}${matched.suit} (${cardLabel(matched)})`,
          conclusion: rawConclusion,
          confidence: typeof parsed.confidence === 'number' ? parsed.confidence : 0.9,
          thinking: combinedThinking,
          rawResponse: content,
        },
      );

      return {
        card: matched,
        engineType: 'llm',
        latencyMs: performance.now() - started,
        thinking: combinedThinking,
        conclusion: rawConclusion,
        confidence: typeof parsed.confidence === 'number' ? parsed.confidence : 0.9,
        diagnostic: `LLM (${this.model}): ${rawConclusion}`,
        modelName: this.model,
        rawOutput: content,
        requestPayload: body,
      };
    } finally {
      clearTimeout(timer);
    }
  }

  /**
   * 本地开发调试模拟决策器（Dev Tactical Simulator）
   * 在 run dev 本地无 GPU 端口时运行，保障流式思考气泡与决策日志有生动的推演内容。
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

    // 分析搭档与局势
    let partnerCard: Card | undefined;
    for (const t of currentTrick) {
      if (t.seat === partnerSeat) partnerCard = t.card;
    }

    const partnerLedOrFollowed = partnerCard ? `搭档出 ${cardLabel(partnerCard)}` : '搭档尚未出牌';
    const candLabels = candidates.map((c) => cardLabel(c)).join('、');

    // 默认选用第一张候选
    let chosen = candidates[0];
    let thinkingNarrative = '';
    let conclusionNarrative = '';

    // 模拟启发式思维链
    if (currentTrick.length > 0) {
      const isPartnerWinning = currentTrick.some((t) => sideOf(t.seat) === mySide);
      if (isPartnerWinning) {
        // 尝试找最小0分牌保牌
        const zeroCards = candidates.filter((c) => cardPoints(c) === 0);
        if (zeroCards.length > 0) {
          chosen = zeroCards[zeroCards.length - 1]; // 最小牌
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

    // 模拟流式思考打印动效（在 run dev 下生动展现）
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
      await new Promise((r) => setTimeout(r, 220));
    }

    onProgress?.({
      seat,
      text: thinkingNarrative,
      phase: 'decided',
      conclusion: conclusionNarrative,
      chosenCard: chosen,
    });

    console.warn(
      `%c[LLM DevMock] 🧪 [${SEAT_NAMES[seat]}家] 本地开发仿真接管完成 · 耗时: ${Math.round(performance.now() - started)}ms`,
      'color: #d97706; font-weight: bold;',
      {
        seat,
        seatName: SEAT_NAMES[seat],
        model: this.model,
        chosenCard: `${chosen.rank}${chosen.suit}`,
        conclusion: conclusionNarrative,
        reason: '开发环境网络未联通或接口异常',
      },
    );

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

function anySignal(signals: AbortSignal[]): AbortSignal {
  const controller = new AbortController();
  for (const s of signals) {
    if (s.aborted) {
      controller.abort();
      break;
    }
    s.addEventListener('abort', () => controller.abort(), { once: true });
  }
  return controller.signal;
}
