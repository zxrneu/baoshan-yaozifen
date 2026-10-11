/**
 * LLM 客户端抽象与官方 SDK 适配器 (SOLID - DIP / OCP 原则)。
 * - 抽象 ILlmClient 传输接口，解耦大模型决策逻辑与底层网络传输库。
 * - OpenAiSdkClient: 基于官方成熟的 'openai' SDK 实现，支持全兼容端点 (vLLM, DeepSeek, Qwen, Ollama, SiliconFlow)，
 *   提供连接池复用、指数退避重试 (maxRetries)、精准超时控制与 reasoning_content 提取。
 * - FetchLlmClient: 基于原生 Fetch API 实现，提供无依赖轻量传输与单元测试 Mock 完全兼容能力。
 */
import OpenAI from 'openai';
import { ChatMessage } from './llmPrompts';

export type LlmProtocol = 'chat' | 'completion';
export type LlmResponseFormat = 'json_object' | 'json_schema' | 'text';
export type ReasoningEffort = 'default' | 'none' | 'low' | 'medium' | 'high';

export interface LlmCompletionRequest {
  model: string;
  protocol?: LlmProtocol;
  messages?: ChatMessage[];
  prompt?: string;
  temperature?: number;
  reasoningEffort?: ReasoningEffort;
  responseFormat?: LlmResponseFormat;
  schemaConfig?: {
    name: string;
    schema: Record<string, unknown>;
  };
  signal?: AbortSignal;
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
  complete(request: LlmCompletionRequest): Promise<LlmCompletionResponse>;
}

export interface OpenAiSdkClientOptions {
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
  private readonly client: OpenAI;
  private readonly timeoutMs: number;

  constructor(options: OpenAiSdkClientOptions = {}) {
    const rawBaseUrl = options.baseUrl ?? 'http://127.0.0.1:8000/v1';
    // 确保以 /v1 或有效根路径结尾，并移除末尾冗余斜杠
    const normalizedBaseUrl = rawBaseUrl.replace(/\/+$/, '');
    this.timeoutMs = options.timeoutMs ?? 20000;

    this.client = new OpenAI({
      baseURL: normalizedBaseUrl,
      apiKey: options.apiKey || 'not-needed',
      timeout: this.timeoutMs,
      maxRetries: options.maxRetries ?? 2,
      dangerouslyAllowBrowser: options.dangerouslyAllowBrowser ?? true,
    });
  }

  async complete(request: LlmCompletionRequest): Promise<LlmCompletionResponse> {
    if (request.signal?.aborted) throw request.signal.reason ?? new DOMException('已取消请求', 'AbortError');
    const started = performance.now();
    const protocol = request.protocol ?? 'chat';

    if (protocol === 'chat') {
      const messages: OpenAI.ChatCompletionMessageParam[] = (request.messages ?? []).map((m) => ({
        role: m.role as 'system' | 'user' | 'assistant',
        content: m.content,
      }));

      const body: OpenAI.ChatCompletionCreateParamsNonStreaming = {
        model: request.model,
        messages,
      };

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

      const res = await this.client.chat.completions.create(body, {
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

      const res = await this.client.completions.create(body, {
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

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);

    let abortHandler: (() => void) | undefined;
    if (request.signal) {
      abortHandler = () => controller.abort(request.signal?.reason);
      request.signal.addEventListener('abort', abortHandler, { once: true });
    }

    try {
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

      const resJson = await response.json();
      const choice = resJson.choices?.[0];
      const reasoningContent = choice?.message?.reasoning ?? choice?.message?.reasoning_content;
      const rawText = protocol === 'chat' ? choice?.message?.content : choice?.text;

      if (!rawText || typeof rawText !== 'string') {
        throw new Error('LLM 响应缺失有效文本内容');
      }

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
