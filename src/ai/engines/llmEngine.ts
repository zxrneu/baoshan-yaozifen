/**
 * LLM 决策引擎（OpenAI 兼容 Chat Completions / Completions 协议适配）。
 * 适配 vLLM 与 DeepSeek；支持 JSON Mode 与结构化输出；默认超时 8 秒。
 */
import { Card, cardId, cardLabel } from '../../cards';
import { PlayerObservation } from '../optimized/contracts';
import { DecisionEngine, EngineDecision } from './engineTypes';

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

  constructor(options: LlmEngineOptions = {}) {
    this.baseUrl = options.baseUrl ?? 'http://211.141.18.165:6195/v1/';
    this.apiKey = options.apiKey;
    this.model = options.model ?? 'qwen38_27b';
    this.protocol = options.protocol ?? 'chat';
    this.responseFormat = options.responseFormat ?? 'json_object';
    this.reasoningEffort = options.reasoningEffort ?? 'default';
    this.timeoutMs = options.timeoutMs ?? 8000;
    this.fetchFn = options.fetchFn ?? globalThis.fetch;
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
    if (options.fetchFn !== undefined) this.fetchFn = options.fetchFn;
  }

  async chooseCard(
    observation: PlayerObservation,
    candidates: readonly Card[],
    signal?: AbortSignal,
  ): Promise<EngineDecision> {
    const started = performance.now();
    if (candidates.length === 0) throw new Error('候选牌集不能为空');
    if (candidates.length === 1) {
      return {
        card: candidates[0],
        engineType: 'llm',
        latencyMs: performance.now() - started,
        diagnostic: '唯一候选直接出牌',
      };
    }

    const candidateOptions = candidates.map((c) => ({
      cardId: cardId(c),
      label: cardLabel(c),
    }));

    const systemPrompt = `你是一个专业的云南保山幺子分纸牌大师。
游戏核心规则：
1. 四人对局，东西方与南北方搭档对战。搭档隔座。
2. 同门大小顺序：A > K > Q > J > 10 > 9 > 8 > 7 > 6 > 5 > 4 > 3 > 2。
3. 全副牌中仅 A(10分)、10(10分)、5(5分)为分牌，K/Q/J均为0分牌。
4. 跟牌约束：有同门必须跟同门。
5. 核心策略：团队赢副与分数吃进优先；当搭档出的牌已确定稳赢本轮时，应垫最小同门零分牌或安全喂分，严禁无收益消耗高牌力控制牌（如K）。
请严格以 JSON 格式输出决策，包含字段 "cardId"（必须为候选牌中的 cardId）和可选的 "reason"。`;

    const userPayload = {
      seat: observation.seat,
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
                  cardId: {
                    type: 'string',
                    enum: candidates.map((c) => cardId(c)),
                  },
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

      const response = await this.fetchFn(url, {
        method: 'POST',
        headers,
        body: JSON.stringify(body),
        signal: combinedSignal,
      });

      if (!response.ok) {
        throw new Error(`LLM 请求失败 (${response.status} ${response.statusText})`);
      }

      const resJson = await response.json();
      const content =
        this.protocol === 'chat'
          ? resJson.choices?.[0]?.message?.content
          : resJson.choices?.[0]?.text;

      if (!content || typeof content !== 'string') {
        throw new Error('LLM 响应缺失有效文本内容');
      }

      // 清理可能的 Markdown 代码块包裹
      const cleanJson = content
        .replace(/^```(?:json)?\s*/i, '')
        .replace(/\s*```$/i, '')
        .trim();

      const parsed = JSON.parse(cleanJson);
      const chosenId = parsed.cardId;

      if (!chosenId || typeof chosenId !== 'string') {
        throw new Error('LLM 输出 JSON 缺失 cardId 字段');
      }

      const matched = candidates.find((c) => cardId(c) === chosenId);
      if (!matched) {
        throw new Error(`LLM 返回非法候选牌: ${chosenId}，不在当前可选范围内`);
      }

      return {
        card: matched,
        engineType: 'llm',
        latencyMs: performance.now() - started,
        diagnostic: `LLM (${this.model}): ${parsed.reason ?? cardLabel(matched)}`,
      };
    } finally {
      clearTimeout(timer);
    }
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
