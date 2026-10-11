import { describe, expect, it, vi } from 'vitest';
import { createGame, currentSeat, bid, declareTrump, bury, legalMoves, GameState } from '../src/engine';
import { cardId } from '../src/cards';
import { AiAction, AsyncPlayerAgent } from '../src/ai/types';
import { smartAgent, smartBury } from '../src/ai/smart';
import { GameSession } from '../src/workbench/session';
import { exportSnapshot, importSnapshot, validateState } from '../src/workbench/snapshot';
import { DecisionLogger } from '../src/ai/engines/decisionLogger';
import { ThinkingService } from '../src/ai/engines/thinkingService';
import { EnginePlayerAgent } from '../src/ai/engines/engineAdapter';
import { LlmEngine } from '../src/ai/engines/llmEngine';
import { ILlmClient } from '../src/ai/engines/llm/llmClient';
import { DecisionEngineManager } from '../src/ai/engines';
import { RemoteDecisionEngine } from '../src/ai/engines/remoteEngine';
import { DecisionService } from '../server/services/decisionService';
import { ServerEngineRegistry } from '../server/engines/serverEngineRegistry';

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(r => { resolve = r; });
  return { promise, resolve };
}
function playing(seed = 42, declarer = 2): GameState {
  let game = createGame(seed, { targetWins: 1 });
  for (const seat of [1, 2, 3, 0]) game = bid(game, seat, seat === declarer ? 70 : null);
  game = declareTrump(game, declarer, 'S');
  return bury(game, declarer, smartBury(game, declarer));
}

describe('God mode session commit boundary', () => {
  it('Pause cancels a hint even when the session was already paused', async () => {
    const session = new GameSession(createGame(42));
    const response = deferred<AiAction>();
    let signal: AbortSignal | undefined;
    const agent: AsyncPlayerAgent = { nextAction: () => null, nextActionAsync: (_game, abort) => { signal = abort; return response.promise; } };
    const task = session.evaluate(agent, 'hint');
    await Promise.resolve();
    session.setMode('paused');
    expect(signal?.aborted).toBe(true);
    response.resolve({ kind: 'bid', seat: 1, bid: 70 });
    expect(await task).toBeNull();
    expect(session.getSnapshot()).toMatchObject({ mode: 'paused', isThinking: false, hint: null });
    expect(session.getSnapshot().game.bidding).toHaveLength(0);
  });
  it('coalesces consecutive Next presses into one request and one committed move', async () => {
    const session = new GameSession(createGame(42));
    const response = deferred<AiAction>();
    const next = vi.fn(() => response.promise);
    const agent: AsyncPlayerAgent = { nextAction: () => null, nextActionAsync: next };
    const first = session.step(agent);
    const second = session.step(agent);
    expect(first).toBe(second);
    await Promise.resolve();
    expect(next).toHaveBeenCalledTimes(1);
    response.resolve({ kind: 'bid', seat: 1, bid: 70 });
    expect(await first).toBe(true);
    expect(session.getSnapshot().game.bidding).toHaveLength(1);
    expect(session.getSnapshot().canUndo).toBe(true);
    expect(session.undo()).toBe(true);
    expect(session.getSnapshot().game.bidding).toHaveLength(0);
    expect(session.redo()).toBe(true);
    expect(session.getSnapshot().game.bidding).toHaveLength(1);
  });
  it.each(['replace', 'undo', 'configuration', 'mode'] as const)('rejects a late response after %s even when transport ignores cancellation', async change => {
    const session = new GameSession(createGame(42));
    session.commit({ kind: 'bid', seat: 1, bid: 70 }, session.getSnapshot().cursor);
    const response = deferred<AiAction>();
    let signal: AbortSignal | undefined;
    const agent: AsyncPlayerAgent = {
      nextAction: () => null, nextActionAsync: (_state, abort) => { signal = abort; return response.promise; },
    };
    const task = session.step(agent);
    await Promise.resolve();
    if (change === 'replace') session.replace(createGame(9));
    if (change === 'undo') session.undo();
    if (change === 'configuration') session.configurationChanged();
    if (change === 'mode') session.setMode('auto');
    const expected = session.getSnapshot().game;
    expect(signal?.aborted).toBe(true);
    response.resolve({ kind: 'bid', seat: 2, bid: 75 });
    expect(await task).toBe(false);
    expect(session.getSnapshot().game).toBe(expected);
    expect(session.getSnapshot().pending).toBe(null);
    expect(session.getSnapshot().isThinking).toBe(false);
  });
  it('undo/redo never revives an old cursor and a manual branch drops redo', () => {
    const session = new GameSession(createGame(42));
    const old = session.getSnapshot().cursor;
    session.commit({ kind: 'bid', seat: 1, bid: 70 }, old);
    session.undo();
    expect(session.isCurrent(old)).toBe(false);
    expect(session.commit({ kind: 'bid', seat: 1, bid: 75 }, old)).toBe(false);
    session.commit({ kind: 'bid', seat: 1, bid: 75 }, session.getSnapshot().cursor);
    expect(session.getSnapshot().canRedo).toBe(false);
  });
  it('evaluates once, commits explicitly, and keeps an illegal command atomic', async () => {
    const logger = new DecisionLogger();
    const session = new GameSession(createGame(42));
    session.onInvalidate = () => logger.invalidate(session.getSnapshot().cursor.sessionId);
    session.onCommit = event => logger.recordCommit(event);
    const client: ILlmClient = { complete: async () => ({ rawText: '{"bid":70}', requestBody: { model: 'fixture' }, latencyMs: 2 }) };
    const agent = new EnginePlayerAgent({ engine: new LlmEngine({ client, model: 'fixture' }), logger, thinkingService: new ThinkingService() });
    const result = await session.evaluate(agent, 'hint');
    expect(session.getSnapshot().game.bidding).toHaveLength(0);
    expect(logger.getRecords()[0].status).toBe('evaluated');
    expect(logger.getRecords()[0].chosenCard).toBeUndefined();
    const cursor = session.getSnapshot().cursor;
    expect(() => session.commit({ kind: 'bid', seat: 3, bid: 70 }, cursor)).toThrow();
    expect(session.getSnapshot().cursor).toEqual(cursor);
    expect(session.commit(result!.action, cursor, 'hint', result!)).toBe(true);
    expect(logger.getRecords()[0].status).toBe('applied');
    expect(logger.getCommits()[0].requestId).toBe(result!.context.requestId);
  });
  it('switching engine settings changes the request instance and notifies the session', () => {
    const manager = new DecisionEngineManager({ useServerDecision: false, defaultType: 'llm' });
    const session = new GameSession(createGame(42));
    const unsubscribe = manager.subscribe(() => session.configurationChanged());
    const previous = manager.getAgent().getEngine();
    const cursor = session.getSnapshot().cursor;
    manager.updateLlmOptions({ model: 'new-model' });
    expect(manager.getAgent().getEngine()).not.toBe(previous);
    expect(session.isCurrent(cursor)).toBe(false);
    expect((previous as LlmEngine).getOptions().model).not.toBe('new-model');
    unsubscribe();
  });
});

describe('Full snapshots and action replay', () => {
  it('roundtrips bidding, trump, bury (kitty alias), playing, and early end with basic scoring restored', () => {
    const session = new GameSession(createGame(101, { targetWins: 1 }));
    let guard = 0;
    const phases = new Set<string>();
    while (guard++ < 100) {
      const game = session.getSnapshot().game;
      phases.add(game.phase);
      const restored = importSnapshot(exportSnapshot(game, { activeEngine: 'llm' }, session.getReplay()));
      expect(restored.state).toEqual(game);
      expect(restored.state.rules.scoring).toBe(game.rules.scoring);
      if (game.phase === 'matchEnd') break;
      const seat = currentSeat(game);
      const action: AiAction = game.phase === 'bidding'
        ? { kind: 'bid', seat, bid: game.bidding.length === 0 ? 70 : null }
        : game.phase === 'trump' ? { kind: 'trump', seat, trump: 'S' }
        : game.phase === 'bury' ? { kind: 'bury', seat, cards: smartBury(game, seat) }
        : { kind: 'play', seat, card: legalMoves(game, seat)[0] };
      session.commit(action, session.getSnapshot().cursor, 'ai');
    }
    expect([...phases]).toEqual(['bidding', 'trump', 'bury', 'playing', 'matchEnd']);
    expect(session.getSnapshot().game.result?.earlyFinish).toBe(true);
    expect(session.getSnapshot().game.hands.flat().length).toBeGreaterThan(0);
    const replay = importSnapshot(exportSnapshot(session.getSnapshot().game, { activeEngine: 'llm' }, session.getReplay())).replay!;
    const restoredSession = new GameSession(createGame());
    restoredSession.restore(replay.initialState, replay.commands);
    expect(restoredSession.getSnapshot().game).toEqual(session.getSnapshot().game);
    restoredSession.rewind();
    for (let i = 0; i < replay.commands.length; i++) expect(restoredSession.redo()).toBe(true);
    expect(restoredSession.getSnapshot().game).toEqual(session.getSnapshot().game);
  });
  it.each(['duplicate', 'missing-history', 'score', 'winner', 'version', 'rule', 'replay'] as const)('rejects malformed %s before replacing a session', mutation => {
    const game = playing();
    // Complete a trick via the same session path.
    const session = new GameSession(game);
    for (let i = 0; i < 4; i++) {
      const s = session.getSnapshot();
      session.commit({ kind: 'play', seat: currentSeat(s.game), card: legalMoves(s.game, currentSeat(s.game))[0] }, s.cursor);
    }
    const input = JSON.parse(exportSnapshot(session.getSnapshot().game, { activeEngine: 'llm' }, session.getReplay()));
    if (mutation === 'duplicate') input.state.hands[0][0] = input.state.hands[1][0];
    if (mutation === 'missing-history') input.state.completedTricks = [];
    if (mutation === 'score') input.state.declarerTrickPoints += 5;
    if (mutation === 'winner') input.state.completedTricks[0].winner = (input.state.completedTricks[0].winner + 1) % 4;
    if (mutation === 'version') input.schemaVersion = 99;
    if (mutation === 'rule') input.ruleSetId = 'unknown';
    if (mutation === 'replay') input.replay.commands = [];
    expect(() => importSnapshot(JSON.stringify(input))).toThrow(/快照无效/);
  });
  it('preserves scores, dealer, next hand, and history across a multi-hand replay', async () => {
    const session = new GameSession(createGame(5, { targetWins: 2 }));
    for (let i = 0; i < 300 && session.getSnapshot().game.phase !== 'matchEnd'; i++) {
      const s = session.getSnapshot();
      if (s.game.phase === 'handEnd') session.commit({ kind: 'nextHand' }, s.cursor);
      else await session.step(smartAgent);
    }
    expect(session.getSnapshot().game.phase).toBe('matchEnd');
    const restored = importSnapshot(exportSnapshot(session.getSnapshot().game, { activeEngine: 'bridge' }, session.getReplay()));
    expect(restored.state).toEqual(session.getSnapshot().game);
  });
});

describe('LLM + God mode complete pipeline', () => {
  const client: ILlmClient = {
    complete: async request => {
      const payload = JSON.parse(request.messages![1].content);
      const response = payload.phase === 'bidding' ? { bid: payload.bidHistory.length === 0 ? 70 : null }
        : payload.phase === 'trump' ? { trump: payload.options[0] }
        : payload.phase === 'bury' ? { cards: payload.candidates.slice(0, 4).map((c: { cardId: string }) => c.cardId) }
        : { cardId: payload.candidates[0].cardId, confidence: 0.5 };
      return { rawText: JSON.stringify(response), requestBody: { model: request.model, messages: request.messages }, latencyMs: 1 };
    },
  };
  it('all four seats complete a hand through prompts, JSON parser, service, remote engine, session, and replay', async () => {
    const registry = new ServerEngineRegistry();
    registry.register('llm', new LlmEngine({ client, model: 'scripted-fixture' }));
    const service = new DecisionService(registry);
    const fetchFn: typeof fetch = async (_url, init) => {
      const result = await service.processDecision(JSON.parse(init!.body as string), init!.signal ?? undefined);
      return new Response(JSON.stringify(result), { status: 200, headers: { 'Content-Type': 'application/json' } });
    };
    const logger = new DecisionLogger();
    const session = new GameSession(createGame(101, { targetWins: 1 }));
    session.onInvalidate = () => logger.invalidate(session.getSnapshot().cursor.sessionId);
    session.onCommit = event => logger.recordCommit(event);
    const agent = new EnginePlayerAgent({ engine: new RemoteDecisionEngine({ targetEngineType: 'llm', fetchFn }), logger, thinkingService: new ThinkingService() });
    for (let i = 0; i < 100 && session.getSnapshot().game.phase !== 'matchEnd'; i++) {
      expect(await session.step(agent)).toBe(true);
      validateState(session.getSnapshot().game);
    }
    expect(session.getSnapshot().game.phase).toBe('matchEnd');
    expect(new Set(logger.getRecords().map(record => record.seat)).size).toBe(4);
    expect(new Set(logger.getRecords().map(record => record.phase))).toEqual(new Set(['bidding', 'trump', 'bury', 'playing']));
    expect(logger.getRecords().every(record => record.status === 'applied' && !record.fallbackReason)).toBe(true);
    const modelRecords = logger.getRecords().filter(record => record.modelName);
    expect(modelRecords.length).toBeGreaterThan(6);
    expect(modelRecords.every(record => record.rawResponse && record.requestPayload)).toBe(true);
    const restored = importSnapshot(exportSnapshot(session.getSnapshot().game, { activeEngine: 'llm' }, session.getReplay()));
    expect(restored.state).toEqual(session.getSnapshot().game);
  });
  it.each(['bidding', 'trump', 'bury'] as const)('cancellation in %s never becomes a fallback decision', async phase => {
    let state = createGame(101);
    if (phase !== 'bidding') {
      state = bid(state, 1, 70); state = bid(state, 2, null); state = bid(state, 3, null); state = bid(state, 0, null);
      if (phase === 'bury') state = declareTrump(state, 1, 'S');
    }
    const controller = new AbortController();
    const engine = new LlmEngine({ client: { complete: async () => { controller.abort(); throw new Error('cancelled'); } } });
    await expect(engine.chooseAction(state, 1, controller.signal)).rejects.toThrow();
  });
  it('invalid model JSON records a real bridge fallback, not a model success', async () => {
    const logger = new DecisionLogger();
    const engine = new LlmEngine({ client: { complete: async () => ({ rawText: '{"bid":71}', requestBody: {}, latencyMs: 1 }) } });
    const agent = new EnginePlayerAgent({ engine, logger, thinkingService: new ThinkingService() });
    const state = createGame(101);
    const action = await agent.nextActionAsync(state);
    expect(action?.kind).toBe('bid');
    expect(logger.getRecords()[0]).toMatchObject({ requestedEngine: 'llm', engineType: 'bridge', phase: 'bidding' });
    expect(logger.getRecords()[0].fallbackReason).toBeTruthy();
    expect(logger.getRecords()[0].modelName).toBeUndefined();
  });
  it('LLM inference sees no other hidden hands or kitty, even with God mode peeking', async () => {
    const game = playing();
    const logger = new DecisionLogger();
    const inspect: ILlmClient = { complete: async request => {
      const payload = JSON.parse(request.messages![1].content);
      expect(payload.hands).toBeUndefined();
      expect(payload.kitty).toBeUndefined();
      const visible = new Set(game.hands[currentSeat(game)].map(cardId));
      const text = request.messages![1].content;
      for (const hand of game.hands) for (const card of hand) {
        if (!visible.has(cardId(card))) expect(text).not.toContain('"cardId":"' + cardId(card) + '"');
      }
      return client.complete(request);
    } };
    const agent = new EnginePlayerAgent({ engine: new LlmEngine({ client: inspect }), logger,
      thinkingService: new ThinkingService(), getGodModeState: () => ({ enabled: true, peekedSeats: [0, 1, 2, 3] }) });
    expect(await agent.nextActionAsync(game)).toBeTruthy();
  });
});

describe('Request configuration and transport diagnostics', () => {
  it('leaves confidence unavailable when the model only returns an action', async () => {
    const { LlmResponseParser } = await import('../src/ai/engines/llm/llmParser');
    const parsed = LlmResponseParser.parsePlay('{"cardId":"2S"}', [{ suit: 'S', rank: '2' }]);
    expect(parsed.confidence).toBeUndefined();
  });
  it.each(['bidding', 'trump', 'bury'] as const)('provides a stage-specific JSON schema for %s through the actual transport', async phase => {
    let state = createGame(42);
    if (phase !== 'bidding') for (const seat of [1, 2, 3, 0]) state = bid(state, seat, seat === 1 ? 70 : null);
    if (phase === 'bury') state = declareTrump(state, 1, 'S');
    let body: any;
    const payload = phase === 'bidding' ? { bid: 70 } : phase === 'trump' ? { trump: 'S' }
      : { cards: smartBury(state, 1).map(cardId) };
    const engine = new LlmEngine({ responseFormat: 'json_schema', reasoningEffort: 'none', fetchFn: async (_url, init) => {
      body = JSON.parse(init!.body as string);
      return new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify(payload) } }] }));
    } });
    const decision = await engine.chooseAction(state, 1);
    expect(decision.engineType).toBe('llm');
    expect(body.response_format.type).toBe('json_schema');
    const schema = body.response_format.json_schema.schema;
    const field = phase === 'bidding' ? 'bid' : phase === 'trump' ? 'trump' : 'cards';
    expect(schema.required).toContain(field);
    expect(schema.additionalProperties).toBe(false);
    if (phase === 'bury') {
      expect(schema.properties.cards).toMatchObject({ minItems: 4, maxItems: 4 });
      expect(schema.properties.cards.items.enum).toEqual(expect.arrayContaining(smartBury(state, 1).map(cardId)));
      expect(body.messages[0].content).toContain('不要复述输入局面');
    }
  });
  it('remote non-playing requests carry the selected model and preserve raw response metadata', async () => {
    let sent: any;
    const fetchFn: typeof fetch = async (_url, init) => {
      sent = JSON.parse(init!.body as string);
      return new Response(JSON.stringify({ success: true, action: { kind: 'bid', seat: 1, bid: 70 },
        engineType: 'llm', modelName: 'selected', latencyMs: 2, rawOutput: '{"bid":70}', requestPayload: { model: 'selected' } }));
    };
    const engine = new RemoteDecisionEngine({ targetEngineType: 'llm', fetchFn,
      decisionOptions: { model: 'selected', timeoutMs: 60000, reasoningEffort: 'none' } });
    const result = await engine.chooseBid(createGame(42), 1);
    expect(sent.options).toEqual({ model: 'selected', timeoutMs: 60000, reasoningEffort: 'none' });
    expect(result).toMatchObject({ modelName: 'selected', rawOutput: '{"bid":70}', requestPayload: { model: 'selected' } });
  });
  it('server overrides create isolated LLM instances and retain server-controlled endpoint credentials', () => {
    const registry = new ServerEngineRegistry({ llm: { baseUrl: 'http://localhost:8123/v1', model: 'original' } });
    const original = registry.get('llm') as LlmEngine;
    const selected = registry.forRequest('llm', { model: 'selected', timeoutMs: 60000, reasoningEffort: 'low',
      baseUrl: 'http://unexpected.invalid/v1', apiKey: 'unexpected-test-key', enableDevMockOnFailure: true } as any) as LlmEngine;
    expect(selected).not.toBe(original);
    expect(selected.getOptions()).toMatchObject({ model: 'selected', timeoutMs: 60000, reasoningEffort: 'low', baseUrl: 'http://localhost:8123/v1' });
    expect(original.getOptions().model).toBe('original');
    expect(selected.getOptions().apiKey).toBeUndefined();
    expect(selected.getOptions().enableDevMockOnFailure).toBe(false);
  });
  it('Fetch transport sends none rather than silently dropping it, and supports the reasoning field', async () => {
    const { FetchLlmClient } = await import('../src/ai/engines/llm/llmClient');
    let body: any;
    const client = new FetchLlmClient({ fetchFn: async (_url, init) => {
      body = JSON.parse(init!.body as string);
      return new Response(JSON.stringify({ choices: [{ message: { content: '{"bid":70}', reasoning: 'diagnostic' } }] }));
    } });
    const result = await client.complete({ model: 'fixture', messages: [], reasoningEffort: 'none' });
    expect(body.reasoning_effort).toBe('none');
    expect(result.reasoningContent).toBe('diagnostic');
  });
  it('client disconnect cancels the service without emitting a fallback response', async () => {
    const { DecisionController } = await import('../server/controllers/decisionController');
    const started = deferred<AbortSignal>();
    const registry = new ServerEngineRegistry();
    registry.register('llm', {
      type: 'llm',
      chooseCard: async () => { throw new Error('unused'); },
      chooseBid: async (_game, _seat, signal) => {
        started.resolve(signal!);
        await new Promise<void>((_resolve, reject) => signal!.addEventListener('abort', () => reject(signal!.reason), { once: true }));
        throw new Error('unreachable');
      },
    });
    const callbacks = new Map<string, () => void>();
    const response = { writeHead: vi.fn(), end: vi.fn(), on: (key: string, fn: () => void) => callbacks.set(key, fn), off: (key: string) => callbacks.delete(key) };
    const task = new DecisionController(new DecisionService(registry)).handleDecision({ method: 'POST' }, response,
      JSON.stringify({ seat: 1, phase: 'bidding', engineType: 'llm', gameStateSnapshot: createGame(42) }));
    const signal = await started.promise;
    callbacks.get('close')!();
    await task;
    expect(signal.aborted).toBe(true);
    expect(response.end).not.toHaveBeenCalled();
    expect(callbacks.size).toBe(0);
  });
});
