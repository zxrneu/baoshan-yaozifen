import { observeDecision } from '../src/ai/decisionObservation';
import { afterEach, describe, expect, it, vi } from 'vitest';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { FetchLlmClient, OpenAiSdkClient } from '../src/ai/engines/llm/llmClient';
import { streamDisplay } from '../src/ai/engines/llm/llmStream';
import { readEventStream } from '../src/ai/engines/eventStream';
import { LlmEngine } from '../src/ai/engines/llmEngine';
import { RemoteDecisionEngine } from '../src/ai/engines/remoteEngine';
import { EnginePlayerAgent } from '../src/ai/engines/engineAdapter';
import { ThinkingService, thinkingService } from '../src/ai/engines/thinkingService';
import { DecisionLogger, decisionLogger } from '../src/ai/engines/decisionLogger';
import { DecisionController } from '../server/controllers/decisionController';
import { DecisionService } from '../server/services/decisionService';
import { ServerEngineRegistry } from '../server/engines/serverEngineRegistry';
import { createApiHandler } from '../server/apiHandler';
import { bid, bury, createGame, currentSeat, declareTrump } from '../src/engine';
import { cardId } from '../src/cards';
import { smartBury } from '../src/ai/smart';
import DebugSidePanel from '../src/components/DebugSidePanel';
import { GameSession } from '../src/workbench/session';

const encoder = new TextEncoder();
function controlledStream() {
  let writer!: ReadableStreamDefaultController<Uint8Array>;
  const cancel = vi.fn();
  const body = new ReadableStream<Uint8Array>({ start(controller) { writer = controller; }, cancel });
  return {
    response: new Response(body, { headers: { 'Content-Type': 'text/event-stream' } }),
    send(data: unknown) { writer.enqueue(encoder.encode(`data: ${typeof data === 'string' ? data : JSON.stringify(data)}\n\n`)); },
    close() { writer.close(); }, cancel,
  };
}
const chunk = (delta: unknown, finish_reason: string | null = null) => ({ choices: [{ index: 0, delta, finish_reason }] });

afterEach(() => { vi.unstubAllGlobals(); thinkingService.clear(); decisionLogger.clear(); });

describe('LLM token streaming', () => {
  it('decodes UTF-8, CRLF, comments and multiline SSE events across every byte boundary', async () => {
    const bytes = encoder.encode(': keepalive\r\ndata: 中文\r\ndata: 第二行\r\n\r\ndata: [DONE]\r\n\r\n');
    const body = new ReadableStream<Uint8Array>({ start(controller) {
      for (const byte of bytes) controller.enqueue(new Uint8Array([byte]));
      controller.close();
    } });
    const events: string[] = [];
    for await (const event of readEventStream(new Response(body))) events.push(event);
    expect(events).toEqual(['中文\n第二行', '[DONE]']);
  });

  it.each(['fetch', 'sdk'] as const)('%s sends stream:true and exposes reasoning and content before completion', async transport => {
    const upstream = controlledStream();
    const fetchFn = vi.fn<typeof fetch>(async () => upstream.response);
    vi.stubGlobal('fetch', fetchFn);
    const client = transport === 'fetch' ? new FetchLlmClient({ fetchFn }) : new OpenAiSdkClient({ maxRetries: 0 });
    const progress = vi.fn();
    let completed = false;
    const task = client.complete({ model: 'fixture', messages: [], onStream: progress }).then(result => { completed = true; return result; });
    upstream.send(chunk({ reasoning_content: '先看长套' }));
    await vi.waitFor(() => expect(progress).toHaveBeenCalledWith({ rawText: '', reasoningContent: '先看长套' }));
    expect(completed).toBe(false);
    upstream.send(chunk({ content: '{"thinking":"保留主牌","conclusion":"叫70分","bid":70}' }));
    await vi.waitFor(() => expect(progress.mock.lastCall?.[0].rawText).toContain('叫70分'));
    expect(completed).toBe(false);
    upstream.send(chunk({}, 'stop')); upstream.send('[DONE]'); upstream.close();
    const result = await task;
    expect(result.reasoningContent).toBe('先看长套');
    expect(result.requestBody).toMatchObject({ stream: true });
    const body = JSON.parse(fetchFn.mock.calls[0][1]!.body as string);
    expect(body.stream).toBe(true);
  });

  it.each(['fetch', 'sdk'] as const)('%s streams the legacy completion protocol', async transport => {
    const upstream = controlledStream();
    const fetchFn = vi.fn<typeof fetch>(async () => upstream.response);
    vi.stubGlobal('fetch', fetchFn);
    const client = transport === 'fetch' ? new FetchLlmClient({ fetchFn }) : new OpenAiSdkClient({ maxRetries: 0 });
    const progress = vi.fn();
    const task = client.complete({ model: 'fixture', protocol: 'completion', prompt: 'decision', onStream: progress });
    upstream.send({ choices: [{ index: 0, text: '<think>保牌</think>{"bid":70}', finish_reason: 'stop' }] });
    upstream.send('[DONE]'); upstream.close();
    expect((await task).rawText).toContain('保牌');
    expect(progress).toHaveBeenCalled();
    expect(fetchFn.mock.calls[0][0]).toContain('/completions');
  });

  it('separates unfinished think tags and partial JSON fields, including split escape sequences', () => {
    expect(streamDisplay({ rawText: '<think>保留主牌</thi' })).toEqual({ text: '保留主牌', conclusion: undefined });
    expect(streamDisplay({ rawText: '<think>保留主牌</think>{"thinking":"长套\\n控场","conclusion":"叫\\u4e03' }))
      .toEqual({ text: '保留主牌\n\n长套\n控场', conclusion: '叫七' });
    expect(streamDisplay({ rawText: '{"conclusion":"主牌\\u4e' }).conclusion).toBe('主牌');
  });

  it('rejects premature EOF and releases the reader on cancellation', async () => {
    const upstream = controlledStream();
    const client = new FetchLlmClient({ fetchFn: async () => upstream.response });
    const task = client.complete({ model: 'fixture', onStream: () => {} });
    upstream.send(chunk({ content: '{"bid":70}' })); upstream.close();
    await expect(task).rejects.toThrow('未完整结束');
    const pending = controlledStream();
    const abort = new AbortController();
    const cancelled = new FetchLlmClient({ fetchFn: async () => pending.response }).complete({ model: 'fixture', signal: abort.signal, onStream: () => {} });
    await vi.waitFor(() => expect(pending.response.body?.locked).toBe(true));
    abort.abort(new DOMException('测试取消', 'AbortError'));
    await expect(cancelled).rejects.toThrow('测试取消');
    expect(pending.cancel).toHaveBeenCalled();
    expect(pending.response.body?.locked).toBe(false);
  });

  it('keeps the total timeout active while waiting for the next token', async () => {
    const upstream = controlledStream();
    const client = new FetchLlmClient({ timeoutMs: 50, fetchFn: async () => upstream.response });
    await expect(client.complete({ model: 'fixture', onStream: () => {} })).rejects.toThrow();
    expect(upstream.cancel).toHaveBeenCalled();
  });

  it.each(['bidding', 'trump', 'bury', 'playing'] as const)('streams %s through LlmEngine.chooseAction', async phase => {
    let state = createGame(42);
    const seat = currentSeat(state);
    if (phase !== 'bidding') {
      state = bid(state, seat, 70);
      for (let i = 1; i < 4; i++) state = bid(state, (seat + i) % 4, null);
    }
    if (phase === 'bury' || phase === 'playing') state = declareTrump(state, seat, 'S');
    if (phase === 'playing') state = bury(state, seat, smartBury(state, seat));
    const answer = phase === 'bidding' ? { bid: 70 } : phase === 'trump' ? { trump: 'S' }
      : phase === 'bury' ? { cards: smartBury(state, seat).map(cardId) } : { cardId: cardId(state.hands[seat][0]) };
    const upstream = controlledStream();
    const engine = new LlmEngine({ fetchFn: async () => upstream.response });
    const progress = vi.fn();
    const task = engine.chooseAction(observeDecision(state, seat), undefined, { onThinkingProgress: progress });
    upstream.send(chunk({ reasoning: '保留控制张' }));
    await vi.waitFor(() => expect(progress.mock.lastCall?.[0].text).toBe('保留控制张'));
    upstream.send(chunk({ content: JSON.stringify({ ...answer, thinking: '长套控制', conclusion: '执行合法动作' }) }, 'stop'));
    upstream.send('[DONE]'); upstream.close();
    const result = await task;
    expect(result.engineType).toBe('llm');
    expect(result.thinking).toContain('保留控制张');
    expect(result.conclusion).toBe('执行合法动作');
  });
});

describe('end-to-end decision progress', () => {
  it('forwards live output via controller, remote engine and agent, then logs only the final decision', async () => {
    const upstream = controlledStream();
    const registry = new ServerEngineRegistry();
    registry.register('llm', new LlmEngine({ fetchFn: async () => upstream.response }));
    const controller = new DecisionController(new DecisionService(registry));
    const response = controlledStream();
    const headers = vi.fn();
    let serverTask!: Promise<void>;
    const remote = new RemoteDecisionEngine({ targetEngineType: 'llm', fetchFn: async (_url, init) => {
      expect(JSON.parse(init!.body as string).stream).toBe(true);
      serverTask = controller.handleDecision({ method: 'POST' }, {
        writeHead: headers,
        write(data) {
          // Preserve exactly the controller's wire format.
          const event = JSON.parse(String(data).slice(6)); response.send(event);
        }, end() { response.close(); },
      }, init!.body as string);
      return response.response;
    } });
    const thinking = new ThinkingService();
    const logger = new DecisionLogger();
    const agent = new EnginePlayerAgent({ engine: remote, thinkingService: thinking, logger,
      getGodModeState: () => ({ enabled: true, peekedSeats: [] }) });
    const task = agent.nextActionAsync(createGame(42));
    upstream.send(chunk({ reasoning_content: '评估牌力' }));
    await vi.waitFor(() => expect(thinking.getState().text).toBe('评估牌力'));
    expect(logger.getRecords()).toHaveLength(0);
    upstream.send(chunk({ content: '{"bid":70,"thinking":"长套控制","conclusion":"叫70' }));
    await vi.waitFor(() => expect(thinking.getState().conclusion).toBe('叫70'));
    expect(thinking.getState().phase).toBe('thinking');
    upstream.send(chunk({ content: '分"}' }, 'stop')); upstream.send('[DONE]'); upstream.close();
    expect(await task).toMatchObject({ kind: 'bid', bid: 70 });
    await serverTask;
    expect(headers).toHaveBeenCalledWith(200, expect.objectContaining({ 'Content-Type': 'text/event-stream; charset=utf-8' }));
    expect(thinking.getState()).toMatchObject({ phase: 'decided', conclusion: '叫70分', text: '评估牌力\n\n长套控制' });
    expect(logger.getRecords()).toHaveLength(1);
    thinking.clear();
  });

  it('does not accept an unfinished remote stream as a decision', async () => {
    const upstream = controlledStream();
    upstream.send({ type: 'progress', progress: { seat: 1, text: '半截结果', phase: 'thinking' } }); upstream.close();
    const progress = vi.fn();
    const engine = new RemoteDecisionEngine({ targetEngineType: 'llm', fetchFn: async () => upstream.response });
    const result = await engine.chooseAction(observeDecision(createGame(42), 1), undefined, { onThinkingProgress: progress });
    expect(progress).toHaveBeenCalled();
    expect(result.engineType).toBe('bridge');
    expect(result.fallbackReason).toContain('缺失完整结果');
  });

  it('streams the raw LLM proxy without waiting for the complete upstream body', async () => {
    const upstream = controlledStream();
    vi.stubGlobal('fetch', vi.fn<typeof fetch>(async () => upstream.response));
    const api = createApiHandler();
    const write = vi.fn();
    const end = vi.fn();
    const task = api.handleApiRequest({ method: 'POST' }, { writeHead() {}, write, end }, '/api/llm/chat/completions');
    upstream.send(chunk({ reasoning_content: '实时进度' }));
    await vi.waitFor(() => expect(write).toHaveBeenCalled());
    expect(end).not.toHaveBeenCalled();
    upstream.send('[DONE]'); upstream.close();
    await task;
    expect(end).toHaveBeenCalled();
  });

  it('keeps the applied decision visible after the session advances and clears live state', async () => {
    const session = new GameSession(createGame(42));
    session.onInvalidate = () => { decisionLogger.invalidate(session.getSnapshot().cursor.sessionId); thinkingService.clear(); };
    session.onCommit = commit => decisionLogger.recordCommit(commit);
    const agent = new EnginePlayerAgent({ logger: decisionLogger, thinkingService,
      engine: { type: 'llm', chooseCard: async () => { throw new Error('unused'); },
        chooseAction: async (observation) => ({ action: { kind: 'bid', seat: observation.seat, bid: 70 }, engineType: 'llm', latencyMs: 1,
          thinking: '本次实时思考', conclusion: '本次最终结论' }) } });
    expect(await session.step(agent)).toBe(true);
    expect(thinkingService.getState().phase).toBe('idle');
    const { game, cursor } = session.getSnapshot();
    const html = renderToStaticMarkup(React.createElement(DebugSidePanel, {
      game, sessionCursor: cursor, seat: currentSeat(game), engineType: 'llm', setEngineType() {}, isStepMode: true,
      setIsStepMode() {}, isThinking: false, pendingAiAction: null, aiHintAction: null, stepNext: async () => {},
      triggerAiHint: async () => {}, manualPlaySeat() {}, undo: () => true, canUndo: true, restart() {}, soundMuted: false,
      toggleSoundMute() {}, onOpenEngineSettings() {}, onOpenDecisionLog() {},
    }));
    expect(html).toContain('本次实时思考');
    expect(html).toContain('本次最终结论');
    expect(html).toContain('决策完成');
  });

  it('shows current streaming reasoning and conclusion without leaking a previous conclusion', () => {
    decisionLogger.record({ seat: 1, engineType: 'llm', roundNumber: 1, trickNumber: 1, ownHand: [], currentRound: [], candidates: [],
      latencyMs: 100, thinking: '旧思考', conclusion: '旧结论' });
    thinkingService.startThinking(1, '当前思考');
    const props = { game: createGame(42), seat: 1, engineType: 'llm' as const, setEngineType() {}, isStepMode: true,
      setIsStepMode() {}, isThinking: true, pendingAiAction: null, aiHintAction: null, stepNext: async () => {},
      triggerAiHint: async () => {}, manualPlaySeat() {}, undo: () => true, canUndo: true, restart() {}, soundMuted: false,
      toggleSoundMute() {}, onOpenEngineSettings() {}, onOpenDecisionLog() {} };
    const render = () => renderToStaticMarkup(React.createElement(DebugSidePanel, props));
    expect(render()).toContain('当前思考');
    expect(render()).toContain('流式生成中');
    expect(render()).not.toContain('旧结论');
    thinkingService.updateThinking(1, '当前思考', '新结论');
    expect(render()).toContain('新结论');
  });
});
