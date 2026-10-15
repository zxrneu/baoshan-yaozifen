/**
 * 验证 LLM 请求体的 max_tokens 透传：思考模型需要足够预算才会结束 reasoning 并输出 content。
 * 同时验证 reasoningEffort 的取值语义，其中 none 用于关闭思维链的消融对照。
 * 采用接口隔离原则，直接断言两种传输实现发出的请求体。
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { FetchLlmClient, OpenAiSdkClient } from '@yaozifen/ai-core/engines/llm/llmClient';

const okResponse = () => new Response(JSON.stringify({
  id: 'cmpl', object: 'chat.completion', created: 0, model: 'fixture',
  choices: [{ index: 0, message: { role: 'assistant', content: '{"ok":true}' }, finish_reason: 'stop' }],
  usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
}), { headers: { 'Content-Type': 'application/json' } });

type CapturedBody = { max_tokens?: number; reasoning_effort?: string };
type CapturingFetch = ReturnType<typeof vi.fn<typeof fetch>>;

async function captureBody(
  transport: 'fetch' | 'sdk',
  request: { maxTokens?: number; reasoningEffort?: 'default' | 'none' | 'low' | 'medium' | 'high' },
): Promise<CapturedBody> {
  const fetchFn: CapturingFetch = vi.fn<typeof fetch>(async () => okResponse());
  vi.stubGlobal('fetch', fetchFn);
  const client = transport === 'fetch'
    ? new FetchLlmClient({ fetchFn })
    : new OpenAiSdkClient({ fetchFn, maxRetries: 0 });
  await client.complete({ model: 'fixture', messages: [{ role: 'user', content: 'hi' }], ...request });
  // SDK 与原生 fetch 都通过注入的 fetchFn 发出请求。
  const init = fetchFn.mock.calls.at(-1)?.[1] as RequestInit | undefined;
  return JSON.parse(String(init?.body ?? '{}')) as CapturedBody;
}

afterEach(() => { vi.unstubAllGlobals(); });

describe('LLM max_tokens 透传', () => {
  it.each(['fetch', 'sdk'] as const)('%s 传输在显式指定 maxTokens 时写入请求体', async transport => {
    const body = await captureBody(transport, { maxTokens: 8192 });
    expect(body.max_tokens).toBe(8192);
  });

  it.each(['fetch', 'sdk'] as const)('%s 传输未指定 maxTokens 时不写入该字段（交由服务端默认）', async transport => {
    const body = await captureBody(transport, {});
    expect(body.max_tokens).toBeUndefined();
  });
});

describe('LLM reasoning_effort 透传', () => {
  it.each(['fetch', 'sdk'] as const)('%s 传输在 reasoningEffort=none 时下发 none 以关闭思维链', async transport => {
    const body = await captureBody(transport, { reasoningEffort: 'none' });
    expect(body.reasoning_effort).toBe('none');
  });

  it.each(['fetch', 'sdk'] as const)('%s 传输在 reasoningEffort=default 时不写入该字段', async transport => {
    const body = await captureBody(transport, { reasoningEffort: 'default' });
    expect(body.reasoning_effort).toBeUndefined();
  });
});
