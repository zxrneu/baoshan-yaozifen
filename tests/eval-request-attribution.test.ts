/** 请求统计与失败归因回归；以可观察的传输次数验证职责隔离和并发安全。 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { BenchmarkRunner } from '../src/ai/eval/benchmarkRunner';
import { BIDDING_SCENARIOS, PLAYING_SCENARIOS } from '../src/ai/eval/scenarios';
import { LlmEngine } from '../src/ai/engines/llmEngine';
import { LayaEngine } from '../src/ai/engines/layaEngine';
import { FetchLlmClient, OpenAiSdkClient } from '../src/ai/engines/llm/llmClient';
import { observeBidding } from '../src/ai/decisionObservation';

const answer = (content: string) => new Response(JSON.stringify({ choices: [{ message: { content } }] }),
  { headers: { 'Content-Type': 'application/json' } });
const runner = new BenchmarkRunner();
afterEach(() => vi.unstubAllGlobals());

describe('评测请求级计数与无动作失败', () => {
  it('SDK 的真实 HTTP 重试按两次请求、一次重试记录', async () => {
    const fetchFn = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(new Response('{}', { status: 500, headers: { 'retry-after-ms': '1' } }))
      .mockResolvedValueOnce(answer('{"bid":null}'));
    vi.stubGlobal('fetch', fetchFn);
    const report = await runner.runSuite(new LlmEngine({ maxRetries: 1 }), [BIDDING_SCENARIOS[0]], { runId: 'retry' });
    expect(fetchFn).toHaveBeenCalledTimes(2);
    expect(report.actualModelCalls).toBe(2);
    expect(report.actualModelRetries).toBe(1);
    expect(report.nativeCallCount).toBe(1);
    expect(report.scenarioResults[0]).toMatchObject({ logicalDecisionId: 'retry:0', modelRequestCount: 2,
      modelRetryCount: 1, decisionSource: 'model', isNative: true });
    expect(runner.generateReportFiles(report).decisionsNdjson).toContain('"modelRequestCount":2');
  });

  it('出牌连接失败保留请求次数，单列无动作失败且不算回退', async () => {
    const fetchFn = vi.fn<typeof fetch>(async () => { throw new Error('Connection error.'); });
    const report = await runner.runSuite(new LlmEngine({ fetchFn }), [PLAYING_SCENARIOS[0]]);
    expect(report.actualModelCalls).toBe(1);
    expect(report.fallbackCount).toBe(0);
    expect(report.executionFailureCount).toBe(1);
    expect(report.nativeSuccessCount).toBe(0);
    expect(report.scenarioResults[0]).toMatchObject({ decisionSource: 'execution-failure', errorCode: 'NETWORK_ERROR',
      modelRequestCount: 1, isNative: false, isLegal: false });
    expect(report.scenarioResults[0].fallbackReason).toBeUndefined();
    expect(runner.formatMarkdownReport(report)).toContain('无动作执行失败');
  });

  it('真实返回启发式动作才计回退，HTTP 失败仍保留请求计数', async () => {
    const report = await runner.runSuite(new LlmEngine({ fetchFn: async () => new Response('{}', { status: 503 }) }),
      [BIDDING_SCENARIOS[0]]);
    expect(report.actualModelCalls).toBe(1);
    expect(report.fallbackCount).toBe(1);
    expect(report.executionFailureCount).toBe(0);
    expect(report.scenarioResults[0]).toMatchObject({ decisionSource: 'fallback', isLegal: true, errorCode: 'HTTP_ERROR' });
  });

  it('唯一候选直接返回不算模型调用或原生成功', async () => {
    const fetchFn = vi.fn<typeof fetch>(async () => { throw new Error('不应联网'); });
    const base = PLAYING_SCENARIOS[0];
    const scenario = { ...base, setup: () => { const setup = base.setup(); return { ...setup, candidates: setup.candidates!.slice(0, 1) }; } };
    const report = await runner.runSuite(new LlmEngine({ fetchFn }), [scenario]);
    expect(fetchFn).not.toHaveBeenCalled();
    expect(report.actualModelCalls).toBe(0);
    expect(report.nativeSuccessCount).toBe(0);
    expect(report.nativeSuccessRate).toBeNull();
    expect(report.scenarioResults[0]).toMatchObject({ decisionSource: 'deterministic', modelRequestCount: 0, isNative: false });
  });

  it('未联网的开发模拟计零请求', async () => {
    const report = await runner.runSuite(new LlmEngine({ enableDevMockOnFailure: true }), [BIDDING_SCENARIOS[0]]);
    expect(report.mockCount).toBe(1);
    expect(report.actualModelCalls).toBe(0);
    expect(report.nativeCallCount).toBe(0);
    expect(report.nativeSuccessRate).toBeNull();
  });

  it('并发 SDK 决策的重试次数不会串到另一题', async () => {
    let attempts = 0;
    const fetchFn = vi.fn<typeof fetch>(async () => {
      attempts++;
      // 仅第一次 HTTP 请求失败，其余请求成功。
      return attempts === 1 ? new Response('{}', { status: 500, headers: { 'retry-after-ms': '1' } }) : answer('{"bid":null}');
    });
    vi.stubGlobal('fetch', fetchFn);
    const report = await runner.runSuite(new LlmEngine({ maxRetries: 1, maxConcurrency: 2 }), BIDDING_SCENARIOS.slice(0, 2), { concurrency: 2 });
    expect(fetchFn).toHaveBeenCalledTimes(3);
    expect(report.actualModelCalls).toBe(3);
    expect(report.scenarioResults.map(r => r.modelRequestCount)).toEqual([2, 1]);
  });

  it('注入但未提供 HTTP 统计的客户端明确标记未采集', async () => {
    const report = await runner.runSuite(new LlmEngine({ client: { complete: async () => ({ rawText: '{"bid":null}', requestBody: {}, latencyMs: 0 }) } }),
      [BIDDING_SCENARIOS[0]]);
    expect(report.actualModelCalls).toBeNull();
    expect(report.scenarioResults[0].modelRequestCount).toBeNull();
    expect(runner.formatMarkdownReport(report)).toContain('未采集');
  });

  it('System One 连接失败计一次请求且不冒充回退', async () => {
    const report = await runner.runSuite(new LayaEngine({ fetchFn: async () => { throw new Error('fetch failed'); } }), [BIDDING_SCENARIOS[0]]);
    expect(report.actualModelCalls).toBe(1);
    expect(report.executionFailureCount).toBe(1);
    expect(report.fallbackCount).toBe(0);
  });

  it('无动作失败即使自定义战术裁判返回通过也不能记为成功', async () => {
    const scenario = { ...PLAYING_SCENARIOS[0], expectedCriteria: () => true };
    const report = await runner.runSuite(new LlmEngine({ fetchFn: async () => { throw new Error('fetch failed'); } }), [scenario]);
    expect(report.passedCount).toBe(0);
    expect(report.scenarioResults[0].passed).toBe(false);
  });

  it('请求之前取消时 SDK 不发起 HTTP 请求', async () => {
    const onModelRequest = vi.fn();
    const controller = new AbortController(); controller.abort(new DOMException('测试取消', 'AbortError'));
    await expect(new OpenAiSdkClient().complete({ model: 'fixture', signal: controller.signal, onModelRequest })).rejects.toThrow('测试取消');
    expect(onModelRequest).not.toHaveBeenCalled();
  });

  it('SDK 重试耗尽仍保留全部尝试，失败不计已执行回退', async () => {
    const fetchFn = vi.fn<typeof fetch>(async () => new Response('{}', { status: 500, headers: { 'retry-after-ms': '1' } }));
    vi.stubGlobal('fetch', fetchFn);
    const report = await runner.runSuite(new LlmEngine({ maxRetries: 2 }), [PLAYING_SCENARIOS[0]]);
    expect(fetchFn).toHaveBeenCalledTimes(3);
    expect(report).toMatchObject({ actualModelCalls: 3, actualModelRetries: 2, nativeCallCount: 1,
      nativeSuccessCount: 0, nativeSuccessRate: 0, fallbackCount: 0, executionFailureCount: 1 });
    expect(report.scenarioResults[0].modelRequests).toEqual([{ attempt: 1 }, { attempt: 2 }, { attempt: 3 }]);
  });

  it('在并发队列里取消的决策不会增加 HTTP 请求数', async () => {
    const fetchFn = vi.fn<typeof fetch>(() => new Promise(() => {}));
    const engine = new LlmEngine({ fetchFn, timeoutMs: 1000, maxConcurrency: 1 });
    const setup = BIDDING_SCENARIOS[0].setup();
    const observation = observeBidding(setup.state!, setup.seat);
    const firstAbort = new AbortController();
    const secondAbort = new AbortController();
    const firstObserver = vi.fn(); const secondObserver = vi.fn();
    const first = engine.chooseBid(observation, firstAbort.signal, { onModelRequest: firstObserver }).catch(error => error);
    await vi.waitFor(() => expect(fetchFn).toHaveBeenCalledTimes(1));
    const second = engine.chooseBid(observation, secondAbort.signal, { onModelRequest: secondObserver }).catch(error => error);
    secondAbort.abort(new DOMException('队列取消', 'AbortError'));
    expect((await second).message).toBe('队列取消');
    expect(secondObserver).not.toHaveBeenCalled();
    firstAbort.abort(new DOMException('结束首个请求', 'AbortError'));
    await first;
    expect(firstObserver).toHaveBeenCalledTimes(1);
    expect(fetchFn).toHaveBeenCalledTimes(1);
  });

  it.each(['fetch', 'sdk'] as const)('%s 流式分块与两种协议均按一次 HTTP 请求计数', async transport => {
    for (const protocol of ['chat', 'completion'] as const) {
      const chunks = protocol === 'chat'
        ? [{ choices: [{ delta: { content: '{"bid":' } }] }, { choices: [{ delta: { content: 'null}' }, finish_reason: 'stop' }] }]
        : [{ choices: [{ text: '{"bid":' }] }, { choices: [{ text: 'null}', finish_reason: 'stop' }] }];
      const body = chunks.map(chunk => `data: ${JSON.stringify(chunk)}\n\n`).join('') + 'data: [DONE]\n\n';
      const fetchFn = vi.fn<typeof fetch>(async () => new Response(body, { headers: { 'Content-Type': 'text/event-stream' } }));
      const client = transport === 'fetch' ? new FetchLlmClient({ fetchFn }) : new OpenAiSdkClient({ fetchFn, maxRetries: 0 });
      const onModelRequest = vi.fn(); const onStream = vi.fn();
      await client.complete({ model: 'fixture', protocol, messages: [], prompt: '', onStream, onModelRequest });
      expect(onStream.mock.calls.length).toBeGreaterThan(1);
      expect(fetchFn).toHaveBeenCalledTimes(1);
      expect(onModelRequest).toHaveBeenCalledExactlyOnceWith({ attempt: 1 });
    }
  });
});
