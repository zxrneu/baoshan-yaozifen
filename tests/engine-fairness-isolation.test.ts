import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { DecisionEngine, EngineType } from '@yaozifen/ai-core/engines/engineTypes';
import { AlgorithmEngine } from '@yaozifen/ai-core/engines/algorithmEngine';
import { LayaEngine } from '@yaozifen/ai-core/engines/layaEngine';
import { LlmEngine } from '@yaozifen/ai-core/engines/llmEngine';
import { ILlmClient } from '@yaozifen/ai-core/engines/llm/llmClient';
import { BridgeEngine } from '@yaozifen/ai-core/bridge/bridgeEngine';
import { BridgePimcEvaluator } from '@yaozifen/ai-core/bridge/pimc';
import { WorkerCardSelector } from '@yaozifen/ai-core/optimized/workerClient';
import { SearchWorkerPort } from '@yaozifen/ai-core/optimized/workerProtocol';
import { legalObservationCards } from '@yaozifen/game-view/observation';
import { DecisionObservation, observeDecision, sanitizeDecisionObservation, inputVisibility } from '@yaozifen/game-view/decisionObservation';
import { DecisionRequest, sanitizeDecisionRequest } from '@yaozifen/ai-core/engines/decisionProtocol';
import { DecisionService } from '@yaozifen/server/services/decisionService';
import { DecisionController } from '@yaozifen/server/controllers/decisionController';
import { ServerEngineRegistry } from '@yaozifen/server/engines/serverEngineRegistry';
import { hiddenWorldSource, sampleHiddenWorld, rngFrom } from '@yaozifen/ai-core/sampling';
import { expectedUtility } from '@yaozifen/ai-core/search';
import InputVisibilityCard from '@yaozifen/web/components/InputVisibilityCard';
import { describe, expect, it, vi } from 'vitest';
import { Card, cardId, cardPoints, freshDeck } from '@yaozifen/game-core/cards';
import { bid, bury, createGame, currentSeat, declareTrump, GameState, playCard, legalMoves, revealedPartnerSeat, partnerOf } from '@yaozifen/game-core';
import { EnginePlayerAgent } from '@yaozifen/ai-core/engines/engineAdapter';
import { RemoteDecisionEngine } from '@yaozifen/ai-core/engines/remoteEngine';
import { DecisionLogger } from '@yaozifen/ai-core/engines/decisionLogger';
import { ThinkingService } from '@yaozifen/ai-core/engines/thinkingService';
import { unknownCards } from '@yaozifen/ai-core/sampling';

export function phaseState(phase: 'bidding' | 'trump' | 'bury' | 'playing', amount = 70): GameState {
  let state = createGame(42);
  if (phase === 'bidding') return state;
  const declarer = currentSeat(state);
  state = bid(state, declarer, amount);
  while (state.phase === 'bidding') state = bid(state, currentSeat(state), null);
  if (phase === 'trump') return state;
  state = declareTrump(state, declarer, 'H');
  if (phase === 'bury') return state;
  state = bury(state, declarer, state.hands[declarer].filter(card => cardPoints(card) === 0).slice(0, 4));
  return state;
}

function agent(engine: DecisionEngine) {
  return new EnginePlayerAgent({ engine, logger: new DecisionLogger(), thinkingService: new ThinkingService(),
    getGodModeState: () => ({ enabled: true, peekedSeats: [0, 1, 2, 3] }) });
}

describe('Engine fairness boundaries', () => {
  it.each(['bidding', 'trump', 'bury'] as const)('RPC %s sends no full state or hidden ownership', async phase => {
    let payload: any;
    const remote = new RemoteDecisionEngine({ fetchFn: async (_url, init) => {
      payload = JSON.parse(init!.body as string);
      throw new Error('fixture: offline');
    } });
    await agent(remote).nextActionAsync(phaseState(phase));
    expect(payload).toBeDefined();
    expect(payload.gameStateSnapshot).toBeUndefined();
    expect(payload.observation.hands).toBeUndefined();
    expect(payload.observation.kitty).toBeUndefined();
    expect(payload.observation.seed).toBeUndefined();
  });

  it('legacy sampling keeps unknown buried cards in a defender’s unknown pool', () => {
    const state = phaseState('playing');
    const defender = (state.declarer! + 1) % 4;
    const ids = new Set(unknownCards(state, defender).map(cardId));
    for (const card of state.kitty) expect(ids.has(cardId(card))).toBe(true);
  });
});

function hiddenChanged(state: GameState): GameState {
  const seat = currentSeat(state);
  const revealed = revealedPartnerSeat(state);
  const other = [0, 1, 2, 3].filter(value => value !== seat && value !== revealed);
  const changed = { ...state, hands: state.hands.map(hand => [...hand]), kitty: [...state.kitty], seed: 999999 };
  [changed.hands[other[0]][0], changed.hands[other[1]][0]] = [changed.hands[other[1]][0], changed.hands[other[0]][0]];
  if (state.phase !== 'bury' && (state.phase !== 'playing' || seat !== state.declarer)) {
    const index = changed.hands[other[0]].findIndex(card => cardPoints(card) === 0);
    [changed.hands[other[0]][index], changed.kitty[0]] = [changed.kitty[0], changed.hands[other[0]][index]];
  }
  return changed;
}

function instrumentedEngine(type: EngineType, inputs: unknown[], transport: unknown[]): DecisionEngine {
  let engine: DecisionEngine;
  if (type === 'bridge') {
    const evaluator = new BridgePimcEvaluator();
    vi.spyOn(evaluator, 'evaluate').mockImplementation(async (observation, candidates) => {
      transport.push(structuredClone(observation));
      return { card: candidates[0], winRate: 0.5, moves: [], worldsEvaluated: 1, elapsedMs: 0, diagnostic: 'fixture' };
    });
    engine = new BridgeEngine({ pimcEvaluator: evaluator });
  } else if (type === 'algorithm') {
    const worker: SearchWorkerPort = { onmessage: null, onerror: null, onmessageerror: null, terminate() {},
      postMessage(request) {
        transport.push(structuredClone(request.observation));
        worker.onmessage!({ data: { id: request.id, decision: { card: legalObservationCards(request.observation)[0],
          status: 'budget', moves: [], comparisons: [], worlds: 1, elapsedMs: 0 } } } as MessageEvent);
      } };
    engine = new AlgorithmEngine(new WorkerCardSelector({ createWorker: () => worker }));
  } else if (type === 'laya') {
    engine = new LayaEngine({ fetchFn: async (_url, init) => {
      const payload = JSON.parse(init!.body as string);
      transport.push(payload);
      const questions = payload.questions;
      const answers = questions.play ? { play: { choice: Object.keys(questions.play.criteria)[0] } }
        : questions.bid ? { bid: { choice: 'pass' } } : { trump: { choice: 'H' } };
      return new Response(JSON.stringify({ answers }), { status: 200 });
    } });
  } else {
    const client: ILlmClient = { complete: async request => {
      transport.push(structuredClone(request.messages));
      const payload = JSON.parse(request.messages![1].content);
      const answer = payload.phase === 'bidding' ? { bid: null }
        : payload.phase === 'trump' ? { trump: 'H' }
        : payload.phase === 'bury' ? { cards: payload.candidates.slice(0, 4).map((card: { cardId: string }) => card.cardId) }
        : { cardId: payload.candidates[0].cardId };
      return { rawText: JSON.stringify(answer), requestBody: { messages: request.messages }, latencyMs: 0 };
    } };
    engine = new LlmEngine({ client });
  }
  const originalAction = engine.chooseAction!.bind(engine);
  const originalCard = engine.chooseCard.bind(engine);
  engine.chooseAction = async observation => {
    inputs.push(structuredClone(observation));
    return originalAction(observation);
  };
  engine.chooseCard = async (observation, candidates) => {
    inputs.push(structuredClone(observation));
    return originalCard(observation, candidates);
  };


  return engine;
}

const phases = ['bidding', 'trump', 'bury', 'playing'] as const;
const engines = ['bridge', 'algorithm', 'laya', 'llm'] as const;
describe('Hidden information cannot affect engine inputs', () => {
  it.each(engines.flatMap(type => phases.map(phase => ({ type, phase }))))('$type / $phase: same inputs and actions after hidden swaps and God mode changes', async ({ type, phase }) => {
    let state = phaseState(phase);
    if (phase === 'playing') {
      const declarer = currentSeat(state), defender = (declarer + 1) % 4;
      const lead = state.hands[declarer].find(card => state.hands[defender].filter(other => other.suit === card.suit).length >= 2)!;
      state = playCard(state, declarer, lead);
    }
    const changed = hiddenChanged(state), seat = currentSeat(state);
    expect(observeDecision(changed, seat)).toEqual(observeDecision(state, seat));
    const inputs: unknown[] = [], transport: unknown[] = [];
    const engine = instrumentedEngine(type, inputs, transport);
    const first = await agent(engine).nextActionAsync(state);
    expect(inputs).toHaveLength(1);
    const firstInput = inputs.pop(), firstTransport = transport.splice(0);
    const disabled = new EnginePlayerAgent({ engine, logger: new DecisionLogger(), thinkingService: new ThinkingService(),
      getGodModeState: () => ({ enabled: false, peekedSeats: [] }) });
    const second = await disabled.nextActionAsync(changed);
    expect(second).toEqual(first);
    expect(inputs).toEqual([firstInput]);
    expect(transport).toEqual(firstTransport);
    if (phase === 'playing' || type === 'llm' || (type === 'laya' && phase !== 'bury')) expect(transport).toHaveLength(1);
  });

  it.each(phases)('%s projection never reads other hidden cards, unknown kitty, history or seed', phase => {
    const state = phaseState(phase), seat = currentSeat(state);
    const expected = observeDecision(state, seat);
    const hands = state.hands.map((hand, index) => index === seat ? hand : new Proxy(hand, {
      get(target, key) { if (key === 'length') return target.length; throw new Error('hidden hand read'); },
    }));
    const guarded = { ...state, hands };
    for (const key of ['seed', 'history', ...(phase === 'playing' && seat === state.declarer ? [] : ['kitty'])]) {
      Object.defineProperty(guarded, key, { get() { throw new Error('secret read: ' + key); } });
    }
    expect(observeDecision(guarded, seat)).toEqual(expected);
  });

  it('legacy sampling is unchanged by unknown ownership and seed, using a fixed search RNG', () => {
    let state = phaseState('playing');
    state = playCard(state, currentSeat(state), legalMoves(state, currentSeat(state))[0]);
    const changed = hiddenChanged(state), seat = currentSeat(state);
    const a = sampleHiddenWorld(hiddenWorldSource(state, seat), rngFrom(88, 1));
    const b = sampleHiddenWorld(hiddenWorldSource(changed, seat), rngFrom(88, 1));
    expect(b).toEqual(a);
    expect(a.hands.map(hand => hand.length)).toEqual(state.hands.map(hand => hand.length));
    expect(a.kitty.every(card => cardPoints(card) === 0)).toBe(true);
    expect(new Set([...a.hands.flat(), ...a.kitty, ...state.trick.map(entry => entry.card)].map(cardId)).size).toBe(52);
  });

  it('legacy rollout receives a sampled world without reading true kitty or dealing seed', () => {
    let state = phaseState('playing');
    state = playCard(state, currentSeat(state), legalMoves(state, currentSeat(state))[0]);
    const seat = currentSeat(state);
    const guarded = { ...state, hands: state.hands.map((hand, index) => index === seat ? hand : new Proxy(hand, {
      get(target, key) { if (key === 'length') return target.length; throw new Error('hidden hand read'); },
    })) };
    for (const key of ['seed', 'history', 'kitty']) Object.defineProperty(guarded, key, { get() { throw new Error('secret read'); } });
    let calls = 0;
    const value = expectedUtility(guarded, seat, legalMoves(state, seat)[0], { chooseCard(world, acting) {
      calls++;
      expect(world.seed).toBe(0);
      expect(world.kitty.every(card => cardPoints(card) === 0)).toBe(true);
      return legalMoves(world, acting)[0];
    } }, 1);
    expect(calls).toBeGreaterThan(0);
    expect(Number.isFinite(value)).toBe(true);
  });
});

function decisionRequest(observation: DecisionObservation): DecisionRequest {
  const base = { seat: observation.seat, engineType: 'llm' as const };
  switch (observation.phase) {
    case 'bidding': return { ...base, phase: 'bidding', observation };
    case 'trump': return { ...base, phase: 'trump', observation };
    case 'bury': return { ...base, phase: 'bury', observation };
    case 'playing': return { ...base, phase: 'playing', observation, candidates: legalObservationCards(observation) };
  }
}

describe('RPC runtime boundary and fallback', () => {
  it.each(phases)('%s request whitelist drops extra properties including nested card payloads', phase => {
    const state = phaseState(phase);
    const clean = decisionRequest(observeDecision(state, currentSeat(state)));
    const dirty = structuredClone(clean) as any;
    dirty.hands = state.hands; dirty.seed = state.seed;
    dirty.observation.hands = state.hands; dirty.observation.kitty = state.kitty;
    dirty.observation.ownHand[0].hiddenHands = state.hands;
    expect(sanitizeDecisionRequest(dirty)).toEqual(sanitizeDecisionRequest(clean));
  });

  it.each(phases)('%s service passes the same sanitized observation to primary and fallback', async phase => {
    const state = phaseState(phase), observation = observeDecision(state, currentSeat(state));
    const request = decisionRequest(observation), received: unknown[] = [];
    const registry = new ServerEngineRegistry();
    const bridge = new BridgeEngine();
    const fallback: DecisionEngine = { type: 'bridge', chooseCard: async (input, candidates) => {
      received.push(structuredClone(input)); return bridge.chooseCard(input, candidates);
    }, chooseAction: async input => { received.push(structuredClone(input)); return bridge.chooseAction(input); } };
    const primary: DecisionEngine = { type: 'llm', chooseCard: async input => {
      received.push(structuredClone(input)); (input.ownHand as Card[]).pop(); throw new Error('offline');
    }, chooseAction: async input => {
      received.push(structuredClone(input)); (input.ownHand as Card[]).pop(); throw new Error('offline');
    } };
    registry.register('llm', primary);
    const result = await new DecisionService(registry, fallback).processDecision(request);
    expect(result.fallbackReason).toContain('offline');
    expect(received).toHaveLength(2);
    expect(received[1]).toEqual(received[0]);
    expect(observation.ownHand).toHaveLength(state.hands[currentSeat(state)].length);
  });

  it.each(phases)('%s remote chooseAction sends only visible data and is invariant to hidden ownership', async phase => {
    const state = phaseState(phase), seat = currentSeat(state), sent: unknown[] = [];
    const registry = new ServerEngineRegistry();
    registry.register('bridge', new BridgeEngine({ config: {
      mode: 'fast', minWorlds: 1, maxWorlds: 1, timeLimitMs: 1, endgameCardLimit: 0,
    } }));
    const service = new DecisionService(registry);
    const remote = new RemoteDecisionEngine({ targetEngineType: 'bridge', fetchFn: async (_url, init) => {
      const payload = JSON.parse(init!.body as string);
      sent.push(payload);
      const result = await service.processDecision(payload);
      return new Response(JSON.stringify(result), { status: 200 });
    } });
    const first = await remote.chooseAction(observeDecision(state, seat));
    const second = await remote.chooseAction(observeDecision(hiddenChanged(state), seat));
    expect(first.action).toEqual(second.action);
    expect(sent).toHaveLength(2);
    expect(sent[1]).toEqual(sent[0]);
    expect(sent[0]).not.toHaveProperty('gameStateSnapshot');
    expect(sent[0]).not.toHaveProperty('observation.hands');
    expect(sent[0]).not.toHaveProperty('observation.kitty');
  });

  it('rejects old full-state HTTP requests before invoking an engine', async () => {
    const service = new DecisionService(new ServerEngineRegistry());
    const invoke = vi.spyOn(service, 'processDecision');
    const response = { writeHead: vi.fn(), end: vi.fn() };
    await new DecisionController(service).handleDecision({ method: 'POST' }, response,
      JSON.stringify({ seat: 1, phase: 'bidding', engineType: 'llm', gameStateSnapshot: createGame(42) }));
    expect(response.writeHead.mock.calls[0][0]).toBe(400);
    expect(invoke).not.toHaveBeenCalled();
  });

  it('rejects falsely revealed partner and defender buried cards', () => {
    const state = phaseState('playing'), own = observeDecision(state, currentSeat(state));
    expect(() => sanitizeDecisionObservation({ ...own, revealedHand: { seat: 3, cards: state.hands[3] } } as DecisionObservation)).toThrow();
    state.leader = (state.declarer! + 1) % 4;
    const defender = observeDecision(state, state.leader);
    expect(() => sanitizeDecisionObservation({ ...defender, knownBuriedCards: state.kitty } as DecisionObservation)).toThrow();
  });

  it('validates observation, seat and candidates even for a single candidate', () => {
    const request = decisionRequest(observeDecision(phaseState('playing'), 1));
    if (request.phase !== 'playing') throw new Error('fixture');
    expect(() => sanitizeDecisionRequest({ ...request, seat: 2 })).toThrow();
    expect(() => sanitizeDecisionRequest({ ...request, candidates: [freshDeck().find(card =>
      !request.observation.ownHand.some(own => cardId(own) === cardId(card)))!] })).toThrow();
    expect(() => sanitizeDecisionRequest({ ...request, observation: undefined } as unknown as DecisionRequest)).toThrow();
  });
});

describe('Decision input visibility', () => {
  it('counts hand, kitty and rule-revealed cards dynamically and preserves the log summary', async () => {
    const state = phaseState('playing', 100), seat = currentSeat(state);
    const visibility = inputVisibility(observeDecision(state, seat));
    expect(visibility).toMatchObject({ ownHandCount: 12, hiddenHandCount: 24,
      revealedHand: { seat: partnerOf(seat), count: 12 }, kitty: 'known-buried', kittySize: 4 });
    const next = playCard(state, seat, legalMoves(state, seat)[0]);
    const nextVisibility = inputVisibility(observeDecision(next, currentSeat(next)));
    expect(nextVisibility).toMatchObject({ hiddenHandCount: 23, kitty: 'unknown' });
    expect(inputVisibility(observeDecision(phaseState('bury'), seat))).toMatchObject({ ownHandCount: 16, kitty: 'in-hand' });
    const logger = new DecisionLogger();
    const engine = new BridgeEngine({ config: { mode: 'fast', maxWorlds: 1, minWorlds: 1, timeLimitMs: 1, endgameCardLimit: 0 } });
    const player = new EnginePlayerAgent({ engine, logger, thinkingService: new ThinkingService() });
    await player.nextActionAsync(state);
    expect(JSON.parse(logger.exportJson()).records[0].inputVisibility).toEqual(visibility);
    const html = renderToStaticMarkup(React.createElement(InputVisibilityCard, { visibility: nextVisibility }));
    expect(html).toContain('23 张未提供');
    expect(html).toContain('100 分扣底后按规则公开');
    expect(renderToStaticMarkup(React.createElement(InputVisibilityCard))).toContain('旧记录未保存输入视野摘要');
  });
});
