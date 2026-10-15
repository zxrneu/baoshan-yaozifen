/**
 * LLM 客户端抽象与官方 SDK 适配器 (SOLID - DIP / OCP 原则)。
 * - 抽象 ILlmClient 传输接口，解耦大模型决策逻辑与底层网络传输库。
 * - OpenAiSdkClient: 基于官方成熟的 'openai' SDK 实现，支持全兼容端点 (vLLM, DeepSeek, Qwen, Ollama, SiliconFlow)，
 *   提供连接池复用、指数退避重试 (maxRetries)、精准超时控制与 reasoning_content 提取。
 * - FetchLlmClient: 基于原生 Fetch API 实现，提供无依赖轻量传输与单元测试 Mock 完全兼容能力。
 */
import type OpenAI from 'openai';
import { DecisionExecutionOptions } from '../engineTypes';
import { ChatMessage } from './llmPrompts';
import { readEventStream } from '../eventStream';
import { appendLlmChunk, LlmStreamSnapshot } from './llmStream';

export type LlmProtocol = 'chat' | 'completion';
export type LlmResponseFormat = 'json_object' | 'json_schema' | 'text';
export type ReasoningEffort = 'default' | 'none' | 'low' | 'medium' | 'high';

export interface LlmCompletionRequest extends Pick<DecisionExecutionOptions, 'onModelRequest'> {
  model: string;
  protocol?: LlmProtocol;
  messages?: ChatMessage[];
  prompt?: string;
  temperature?: number;
  reasoningEffort?: ReasoningEffort;
  responseFormat?: LlmResponseFormat;
  /** 单次回复 token 上限；缺省时不发送，交由服务端默认值决定。 */
  maxTokens?: number;
  schemaConfig?: {
    name: string;
    schema: Record<string, unknown>;
  };
  signal?: AbortSignal;
  /** Enables genuine token streaming when a consumer is subscribed. */
  onStream?: (snapshot: LlmStreamSnapshot) => void;
}

export interface LlmCompletionResponse {
  rawText: string;
  reasoningContent?: string;
  requestBody: unknown;
  latencyMs: number;
}

/**
 * LLM 传输客户端抽象接口 (DIP)
 */
export interface ILlmClient {
  readonly supportsModelRequestTelemetry?: boolean;
  complete(request: LlmCompletionRequest): Promise<LlmCompletionResponse>;
}

export interface OpenAiSdkClientOptions {
  fetchFn?: typeof fetch;
  baseUrl?: string;
  apiKey?: string;
  timeoutMs?: number;
  maxRetries?: number;
  dangerouslyAllowBrowser?: boolean;
}

/**
 * 官方 OpenAI SDK 适配器 (基于 mature 'openai' 库)
 */
export class OpenAiSdkClient implements ILlmClient {
  readonly supportsModelRequestTelemetry = true;
  private client?: Promise<OpenAI>;
  private readonly options: OpenAiSdkClientOptions;
  private readonly timeoutMs: number;
  private readonly fetchFn: typeof fetch;

  constructor(options: OpenAiSdkClientOptions = {}) {
    const rawBaseUrl = options.baseUrl ?? 'http://127.0.0.1:8000/v1';
    // 确保以 /v1 或有效根路径结尾，并移除末尾冗余斜杠
    const normalizedBaseUrl = rawBaseUrl.replace(/\/+$/, '');
    this.timeoutMs = options.timeoutMs ?? 20000;
    this.fetchFn = options.fetchFn ?? globalThis.fetch.bind(globalThis);

    this.options = { ...options, baseUrl: normalizedBaseUrl };
  }

  private getClient(): Promise<OpenAI> {
    // SDK 仅在第一次模型请求时加载；本地牌桌和纯算法不承担其首包开销。
    return this.client ??= import('openai').then(({ default: SDK }) => new SDK({
      baseURL: this.options.baseUrl,
      fetch: this.fetchFn,
      apiKey: this.options.apiKey || 'not-needed',
      timeout: this.timeoutMs,
      maxRetries: this.options.maxRetries ?? 2,
      dangerouslyAllowBrowser: this.options.dangerouslyAllowBrowser ?? true,
    })).catch(error => { this.client = undefined; throw error; });
  }

  async complete(request: LlmCompletionRequest): Promise<LlmCompletionResponse> {
    if (request.signal?.aborted) throw request.signal.reason ?? new DOMException('已取消请求', 'AbortError');
    const started = performance.now();
    const protocol = request.protocol ?? 'chat';

    // 每个 complete 使用独立传输闭包，SDK 内部重试也经过同一计数点。
    let attempt = 0;
    const sdk = await this.getClient();
    if (request.signal?.aborted) throw request.signal.reason ?? new DOMException('已取消请求', 'AbortError');
    const client = sdk.withOptions({ fetch: (url, init) => {
      request.onModelRequest?.({ attempt: ++attempt });
      return this.fetchFn(url, init);
    } });

    if (protocol === 'chat') {
      const messages: OpenAI.ChatCompletionMessageParam[] = (request.messages ?? []).map((m) => ({
        role: m.role as 'system' | 'user' | 'assistant',
        content: m.content,
      }));

      const body: OpenAI.ChatCompletionCreateParamsNonStreaming = {
        model: request.model,
        messages,
      };

      if (request.maxTokens !== undefined) {
        body.max_tokens = request.maxTokens;
      }

      if (request.reasoningEffort && request.reasoningEffort !== 'default') {
        body.reasoning_effort = request.reasoningEffort;
      } else {
        body.temperature = request.temperature ?? 0.1;
      }

      if (request.responseFormat === 'json_object') {
        body.response_format = { type: 'json_object' };
      } else if (request.responseFormat === 'json_schema' && request.schemaConfig) {
        body.response_format = {
          type: 'json_schema',
          json_schema: {
            name: request.schemaConfig.name,
            strict: true,
            schema: request.schemaConfig.schema,
          },
        };
      }

      if (request.onStream) {
        const streamBody = { ...body, stream: true as const };
        const stream = await client.chat.completions.create(streamBody, { signal: request.signal, timeout: this.timeoutMs });
        const snapshot: LlmStreamSnapshot = { rawText: '' };
        let finished = false;
        for await (const chunk of stream) {
          finished = appendLlmChunk(snapshot, chunk) || finished;
          request.onStream({ ...snapshot });
        }
        if (request.signal?.aborted) throw request.signal.reason;
        if (!finished || !snapshot.rawText) throw new Error('LLM 流式响应未完整结束');
        return { ...snapshot, requestBody: streamBody, latencyMs: performance.now() - started };
      }

      const res = await client.chat.completions.create(body, {
        signal: request.signal,
        timeout: this.timeoutMs,
      });

      const choice = res.choices[0];
      const rawText = choice?.message?.content ?? '';
      const reasoningContent =
        (choice?.message as any)?.reasoning ||
        (choice?.message as any)?.reasoning_content ||
        (choice as any)?.reasoning_content;

      if (!rawText || typeof rawText !== 'string') {
        throw new Error('LLM 响应缺失有效文本内容 (OpenAiSdkClient)');
      }

      return {
        rawText,
        reasoningContent: typeof reasoningContent === 'string' ? reasoningContent : undefined,
        requestBody: body,
        latencyMs: performance.now() - started,
      };
    } else {
      // Legacy Completions protocol
      const prompt = request.prompt ?? request.messages?.map((m) => `${m.role}: ${m.content}`).join('\n\n') ?? '';
      const body: OpenAI.CompletionCreateParamsNonStreaming = {
        model: request.model,
        prompt,
        temperature: request.temperature ?? 0.1,
      };

      if (request.onStream) {
        const streamBody = { ...body, stream: true as const };
        const stream = await client.completions.create(streamBody, { signal: request.signal, timeout: this.timeoutMs });
        const snapshot: LlmStreamSnapshot = { rawText: '' };
        let finished = false;
        for await (const chunk of stream) {
          finished = appendLlmChunk(snapshot, chunk) || finished;
          request.onStream({ ...snapshot });
        }
        if (request.signal?.aborted) throw request.signal.reason;
        if (!finished || !snapshot.rawText) throw new Error('LLM 流式响应未完整结束');
        return { ...snapshot, requestBody: streamBody, latencyMs: performance.now() - started };
      }

      const res = await client.completions.create(body, {
        signal: request.signal,
        timeout: this.timeoutMs,
      });

      const choice = res.choices[0];
      const rawText = choice?.text ?? '';

      if (!rawText || typeof rawText !== 'string') {
        throw new Error('LLM 响应缺失有效文本内容 (OpenAiSdkClient completion)');
      }

      return {
        rawText,
        requestBody: body,
        latencyMs: performance.now() - started,
      };
    }
  }
}

export interface FetchLlmClientOptions {
  baseUrl?: string;
  apiKey?: string;
  timeoutMs?: number;
  fetchFn?: typeof fetch;
}

/**
 * 轻量 Fetch 原生适配器（兼顾零依赖环境与单元测试 Mock）
 */
export class FetchLlmClient implements ILlmClient {
  readonly supportsModelRequestTelemetry = true;
  private readonly baseUrl: string;
  private readonly apiKey?: string;
  private readonly timeoutMs: number;
  private readonly fetchFn: typeof fetch;

  constructor(options: FetchLlmClientOptions = {}) {
    this.baseUrl = (options.baseUrl ?? 'http://127.0.0.1:8000/v1').replace(/\/+$/, '');
    this.apiKey = options.apiKey;
    this.timeoutMs = options.timeoutMs ?? 20000;
    this.fetchFn = options.fetchFn ?? globalThis.fetch.bind(globalThis);
  }

  async complete(request: LlmCompletionRequest): Promise<LlmCompletionResponse> {
    if (request.signal?.aborted) throw request.signal.reason ?? new DOMException('已取消请求', 'AbortError');
    const started = performance.now();
    const protocol = request.protocol ?? 'chat';

    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    };
    if (this.apiKey) {
      headers.Authorization = `Bearer ${this.apiKey}`;
    }

    let url: string;
    let body: any;

    if (protocol === 'chat') {
      url = `${this.baseUrl}/chat/completions`;
      body = {
        model: request.model,
        messages: request.messages,
      };

      if (request.maxTokens !== undefined) {
        body.max_tokens = request.maxTokens;
      }

      if (request.reasoningEffort && request.reasoningEffort !== 'default') {
        body.reasoning_effort = request.reasoningEffort;
      } else {
        body.temperature = request.temperature ?? 0.1;
      }

      if (request.responseFormat === 'json_object') {
        body.response_format = { type: 'json_object' };
      } else if (request.responseFormat === 'json_schema' && request.schemaConfig) {
        body.response_format = {
          type: 'json_schema',
          json_schema: {
            name: request.schemaConfig.name,
            strict: true,
            schema: request.schemaConfig.schema,
          },
        };
      }
    } else {
      url = `${this.baseUrl}/completions`;
      body = {
        model: request.model,
        prompt: request.prompt ?? request.messages?.map((m) => `${m.role}: ${m.content}`).join('\n\n') ?? '',
        temperature: request.temperature ?? 0.1,
      };
    }

    if (request.onStream) body.stream = true;

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(new DOMException(`LLM 请求超时 (${this.timeoutMs}ms)`, 'TimeoutError')), this.timeoutMs);

    let abortHandler: (() => void) | undefined;
    if (request.signal) {
      abortHandler = () => controller.abort(request.signal?.reason);
      request.signal.addEventListener('abort', abortHandler, { once: true });
    }

    try {
      request.onModelRequest?.({ attempt: 1 });
      const response = await this.fetchFn(url, {
        method: 'POST',
        headers,
        body: JSON.stringify(body),
        signal: controller.signal,
      });

      if (!response.ok) {
        const errBody = await (typeof response.text === 'function' ? response.text().catch(() => '') : '');
        throw new Error(`LLM 请求失败 (${response.status} ${response.statusText}): ${String(errBody).slice(0, 200)}`);
      }

      if (request.onStream && response.headers?.get('content-type')?.includes('text/event-stream')) {
        const snapshot: LlmStreamSnapshot = { rawText: '' };
        let finished = false;
        for await (const data of readEventStream(response, controller.signal)) {
          if (data === '[DONE]') { finished = true; break; }
          finished = appendLlmChunk(snapshot, JSON.parse(data)) || finished;
          request.onStream({ ...snapshot });
        }
        if (!finished || !snapshot.rawText) throw new Error('LLM 流式响应未完整结束');
        return { ...snapshot, requestBody: body, latencyMs: performance.now() - started };
      }

      const resJson = await response.json();
      const choice = resJson.choices?.[0];
      const reasoningContent = choice?.message?.reasoning ?? choice?.message?.reasoning_content;
      const rawText = protocol === 'chat' ? choice?.message?.content : choice?.text;

      if (!rawText || typeof rawText !== 'string') {
        throw new Error('LLM 响应缺失有效文本内容');
      }

      request.onStream?.({ rawText, reasoningContent: typeof reasoningContent === 'string' ? reasoningContent : undefined });
      return {
        rawText,
        reasoningContent: typeof reasoningContent === 'string' ? reasoningContent : undefined,
        requestBody: body,
        latencyMs: performance.now() - started,
      };
    } finally {
      clearTimeout(timer);
      if (request.signal && abortHandler) {
        request.signal.removeEventListener('abort', abortHandler);
      }
    }
  }
}
