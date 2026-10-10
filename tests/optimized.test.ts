import { describe, expect, it, vi } from 'vitest';
import { Card, cardId, cardPoints, freshDeck, makeCard, makeRng } from '../src/cards';
import { bid, bury, createGame, currentSeat, declareTrump, GameState, legalMoves, playCard, sideOf } from '../src/engine';
import { applyAiAction, smartBury } from '../src/ai';
import { createOptimizedAgent } from '../src/ai/optimizedAgent';
import {
  advanceSimulation, BasicWorldEvaluator, BudgetExceededError, CompletionAllocator,
  createBeliefSource, createOptimizedSelector, createSimulation, EnumerableWorldSource,
  FAST_OPTIMIZED_BUDGET, HiddenWorld, inferVoidSuits, legalObservationCards, observationKey, observationPolicy,
  observePlayer, PairedCardSelector, PairedStatistics, PlayerObservation,
  seededSearchRandom, unlimitedGuard,
} from '../src/ai/optimized';
import { WorkerCardSelector } from '../src/ai/optimized/workerClient';
import { SearchWorkerPort, SearchWorkerRequest, SearchWorkerResponse } from '../src/ai/optimized/workerProtocol';

function playing(seed = 7) {
  let state = createGame(seed, { targetWins: 1 });
  const first = currentSeat(state);
  for (let i = 0; i < 4; i++) state = bid(state, currentSeat(state), currentSeat(state) === first ? 70 : null);
  state = declareTrump(state, first, 'S');
  return bury(state, first, smartBury(state, first));
}

function coverFixture() {
  const c = makeCard;
  const hands: Card[][] = [[c('D', '10')], [c('D', 'A')], [c('H', 'A'), c('H', '3')], [c('H', 'K'), c('D', 'K')]];
  const kitty = [c('S', '2'), c('S', '3'), c('S', '6'), c('S', '7')];
  const currentRound = [{ seat: 0, card: c('H', 'Q') }, { seat: 1, card: c('H', '2') }];
  const reserved = new Set([...hands.flat(), ...kitty, ...currentRound.map((entry) => entry.card)].map(cardId));
  const played = freshDeck().filter((card) => !reserved.has(cardId(card)));
  const observation: PlayerObservation = {
    seat: 2, ownHand: hands[2], handCounts: hands.map((hand) => hand.length), declarer: 2,
    bid: 70, trump: 'S', leader: 0, roundNumber: 11, currentRound,
    completedRounds: Array.from({ length: 10 }, (_, i) => ({
      trickNumber: i + 1, winner: 0, points: 0,
      cards: played.slice(i * 4, i * 4 + 4).map((card, seat) => ({ seat, card })),
    })),
    voidSuits: [[], [], [], []], declarerPoints: 60, defenderPoints: 10,
    kittySize: 4, knownBuriedCards: kitty, ruleId: 'basic-v1',
  };
  const source: EnumerableWorldSource = {
    count: 1n, sample: () => ({ hands, kitty }), enumerate: () => [{ hands, kitty }],
  };
  return { observation, source };
}

describe('优化 AI 的信息边界', () => {
  it('只投影自己的牌和合法已知底牌，不读取其余牌张或发牌 seed', () => {
    let state = playing();
    state = playCard(state, currentSeat(state), legalMoves(state, currentSeat(state))[0]);
    const seat = currentSeat(state);
    const expected = observePlayer(state, seat);
    const hands = state.hands.map((hand, index) => index === seat ? hand : new Proxy(hand, {
      get(target, key) { if (key === 'length') return target.length; throw new Error('读取了暗牌'); },
    }));
    const kitty = new Proxy(state.kitty, { get() { throw new Error('读取了未知底牌'); } });
    const secretSeed = Object.defineProperty({ ...state, hands, kitty }, 'seed', {
      get() { throw new Error('读取了发牌 seed'); },
    });
    expect(observePlayer(secretSeed, seat)).toEqual(expected);
    expect(expected.knownBuriedCards).toBeUndefined();
    expect(observePlayer(state, state.declarer!).knownBuriedCards).toEqual(state.kitty);
  });

  it('改变隐藏牌归属和未知底牌，固定观察与搜索随机源时决策完全相同', () => {
    let original = playing(17);
    original = playCard(original, currentSeat(original), legalMoves(original, currentSeat(original))[0]);
    const seat = currentSeat(original);
    const hiddenSeats = [0, 1, 2, 3].filter((s) => s !== seat);
    const changed = { ...original, hands: original.hands.map((hand) => [...hand]), kitty: [...original.kitty], seed: 99881 };
    const [a, b] = hiddenSeats;
    [changed.hands[a][0], changed.hands[b][0]] = [changed.hands[b][0], changed.hands[a][0]];
    const zero = changed.hands[b].findIndex((card) => cardPoints(card) === 0);
    [changed.hands[b][zero], changed.kitty[0]] = [changed.kitty[0], changed.hands[b][zero]];
    const observation = observePlayer(original, seat);
    expect(observePlayer(changed, seat)).toEqual(observation);
    const selector = createOptimizedSelector({
      budget: { minWorlds: 8, maxWorlds: 8, timeLimitMs: Infinity, endgameNodeLimit: 0 },
      dependencies: { random: () => seededSearchRandom(142), now: () => 0 },
    });
    expect(selector.choose(observePlayer(changed, seat))).toEqual(selector.choose(observation));
  });

  it('垫牌确定缺领出花色；不杀不能推断缺主', () => {
    const voids = inferVoidSuits([], [
      { seat: 0, card: makeCard('H', 'A') }, { seat: 1, card: makeCard('D', '2') },
    ]);
    expect(voids[1]).toEqual(['H']);
    expect(voids[1]).not.toContain('S');
  });
});

describe('按合法完成数量采样', () => {
  it('小牌组穷举有 22 种分配，采样不偏向某个合法分配', () => {
    const cards = [makeCard('H', 'A'), makeCard('H', '2'), makeCard('D', '10'), makeCard('D', '3'), makeCard('S', '4'), makeCard('C', '6')];
    const allocator = new CompletionAllocator({
      cards, capacities: [2, 1, 1, 2], allowedSlots: cards.map((card) => [0, 1, 2, 3].filter((slot) =>
        slot === 3 ? cardPoints(card) === 0 : (slot !== 0 || card.suit !== 'H') && (slot !== 1 || card.suit !== 'S'))),
    });
    const allocations = allocator.enumerate(22)!;
    const key = (slots: Card[][]) => slots.map((slot) => slot.map(cardId).sort().join(',')).join('/');
    expect(allocator.count).toBe(22n);
    expect(allocations).toHaveLength(22);
    expect(new Set(allocations.map(key)).size).toBe(22);
    const frequencies = new Map(allocations.map((allocation) => [key(allocation), 0]));
    const random = seededSearchRandom(20261011);
    for (let i = 0; i < 4400; i++) {
      const sampled = key(allocator.sample(random));
      expect(frequencies.has(sampled)).toBe(true);
      frequencies.set(sampled, frequencies.get(sampled)! + 1);
    }
    for (const frequency of frequencies.values()) expect(frequency).toBeGreaterThan(130);
    for (const frequency of frequencies.values()) expect(frequency).toBeLessThan(270);
  });

  it('缺门较多的真实中盘仍满足张数、牌张守恒和零分底牌', () => {
    let state = playing(23);
    for (let i = 0; i < 28; i++) {
      const seat = currentSeat(state);
      state = playCard(state, seat, observationPolicy.chooseCard(observePlayer(state, seat)));
    }
    const observation = observePlayer(state, currentSeat(state));
    const source = createBeliefSource(observation);
    const random = seededSearchRandom(80);
    for (let i = 0; i < 30; i++) {
      const world = source.sample(random, unlimitedGuard);
      expect(world.hands.map((hand) => hand.length)).toEqual(observation.handCounts);
      expect(world.hands[observation.seat].map(cardId).sort()).toEqual(observation.ownHand.map(cardId).sort());
      for (let seat = 0; seat < 4; seat++) for (const card of world.hands[seat]) {
        expect(observation.voidSuits[seat]).not.toContain(card.suit);
      }
      expect(world.kitty.every((card) => cardPoints(card) === 0)).toBe(true);
      const all = [...world.hands.flat(), ...world.kitty,
        ...observation.completedRounds.flatMap((round) => round.cards.map((entry) => entry.card)),
        ...observation.currentRound.map((entry) => entry.card)];
      expect(all).toHaveLength(52);
      expect(new Set(all.map(cardId)).size).toBe(52);
    }
  });

  it('矛盾约束返回诊断和合法兜底牌，不悄悄放宽缺门', () => {
    const state = playing(2);
    const observation = observePlayer(state, currentSeat(state));
    const impossible = { ...observation, voidSuits: [['S', 'H', 'D', 'C'], ['S', 'H', 'D', 'C'], ['S', 'H', 'D', 'C'], ['S', 'H', 'D', 'C']] as const };
    const decision = createOptimizedSelector({ budget: { timeLimitMs: Infinity } }).choose(impossible);
    expect(decision.status).toBe('inconsistent');
    expect(legalObservationCards(observation).map(cardId)).toContain(cardId(decision.card));
    expect(decision.worlds).toBe(0);
  });
});

describe('模拟、胜负目标与残局', () => {
  it('轻量模拟器逐张与规则引擎一致，原状态不被修改', () => {
    const random = makeRng(93);
    for (let seed = 1; seed <= 8; seed++) {
      let engine = playing(seed);
      const original = JSON.stringify(engine);
      const initial = engine;
      const simulation = createSimulation(observePlayer(engine, currentSeat(engine)), { hands: engine.hands, kitty: engine.kitty });
      while (engine.phase === 'playing') {
        const seat = currentSeat(engine);
        const legal = legalMoves(engine, seat);
        const card = legal[Math.floor(random() * legal.length)];
        advanceSimulation(simulation, card);
        engine = playCard(engine, seat, card);
        expect(simulation.hands).toEqual(engine.hands);
        expect(simulation.currentRound).toEqual(engine.trick);
        expect(simulation.leader).toBe(engine.leader);
        expect(simulation.declarerPoints).toBe(engine.declarerTrickPoints);
        expect(simulation.defenderPoints).toBe(engine.defenderTrickPoints);
      }
      expect(simulation.declarerPoints + simulation.defenderPoints).toBe(100);
      expect(JSON.stringify(initial)).toBe(original);
    }
  });

  it('两轮反例：盖过搭档赢副，不超车则输副；残局返回同一结论', () => {
    const { observation, source } = coverFixture();
    const evaluator = new BasicWorldEvaluator(observationPolicy);
    const world = source.sample(seededSearchRandom(1), unlimitedGuard);
    expect(evaluator.evaluate(observation, world, makeCard('H', 'A'), unlimitedGuard)).toBe(1);
    expect(evaluator.evaluate(observation, world, makeCard('H', '3'), unlimitedGuard)).toBe(0);
    const decision = createOptimizedSelector({
      budget: { timeLimitMs: Infinity }, dependencies: { worlds: { create: () => source }, now: () => 0 },
    }).choose(observation);
    expect(decision.status).toBe('exact');
    expect(decision.card).toEqual(makeCard('H', 'A'));
    expect(decision.moves.map((move) => move.winRate).sort()).toEqual([0, 1]);
  });

  it('多暗牌残局与独立规则引擎穷举一致，未来决策按玩家观察合并', () => {
    let initial: GameState | undefined;
    let worlds: HiddenWorld[] = [];
    // 找一副尚未锁定胜负、还有两轮且存在多个合法暗牌分配的真实局面。
    for (let seed = 1; seed <= 100 && !initial; seed++) {
      let state = playing(seed);
      for (let i = 0; i < 40; i++) {
        const seat = currentSeat(state);
        state = playCard(state, seat, observationPolicy.chooseCard(observePlayer(state, seat)));
      }
      if (state.declarerTrickPoints >= 70 || state.defenderTrickPoints >= 35) continue;
      const source = createBeliefSource(observePlayer(state, currentSeat(state)));
      const distinct = new Map<string, HiddenWorld>();
      const random = seededSearchRandom(717);
      for (let i = 0; i < 20 && distinct.size < 3; i++) {
        const world = source.sample(random, unlimitedGuard);
        const key = world.hands.map((hand) => hand.map(cardId).sort().join(',')).join('/')
          + ':' + world.kitty.map(cardId).sort().join(',');
        distinct.set(key, world);
      }
      if (distinct.size >= 2) { initial = state; worlds = [...distinct.values()]; }
    }
    expect(initial).toBeDefined();
    const state = initial!;
    const root = currentSeat(state);
    const observation = observePlayer(state, root);
    // 参考求解器用正式引擎推进，不复用轻量模拟器或残局实现。
    const split = (belief: GameState[]): number => {
      const groups = new Map<string, GameState[]>();
      for (const possible of belief) {
        const key = possible.phase !== 'playing' ? `end:${possible.result!.winnerSide}`
          : observationKey(observePlayer(possible, root));
        groups.set(key, [...(groups.get(key) ?? []), possible]);
      }
      return [...groups.values()].reduce((sum, group) => sum + group.length / belief.length * value(group), 0);
    };
    const value = (belief: GameState[]): number => {
      const first = belief[0];
      if (first.phase !== 'playing') return Number(first.result!.winnerSide === sideOf(root));
      const actor = currentSeat(first);
      if (actor === root) return Math.max(...legalMoves(first, root).map((card) =>
        split(belief.map((possible) => playCard(possible, root, card)))));
      return split(belief.map((possible) => playCard(possible, actor,
        observationPolicy.chooseCard(observePlayer(possible, actor)))));
    };
    const belief = worlds.map((world) => ({ ...state, hands: world.hands.map((hand) => [...hand]), kitty: [...world.kitty] }));
    const expected = new Map(legalMoves(state, root).map((card) =>
      [cardId(card), split(belief.map((possible) => playCard(possible, root, card)))]));
    const source: EnumerableWorldSource = {
      count: BigInt(worlds.length), sample: () => worlds[0], enumerate: () => worlds,
    };
    const decision = createOptimizedSelector({
      budget: { timeLimitMs: Infinity }, dependencies: { worlds: { create: () => source }, now: () => 0 },
    }).choose(observation);
    expect(decision.status).toBe('exact');
    for (const move of decision.moves) expect(move.winRate).toBeCloseTo(expected.get(cardId(move.card))!, 12);
  });

  it('胜负已锁定或只有一张合法牌时不构造未知牌局', () => {
    const state = playing();
    const observation = observePlayer(state, currentSeat(state));
    const create = vi.fn(() => { throw new Error('不应该采样'); });
    const selector = createOptimizedSelector({ dependencies: { worlds: { create } } });
    expect(selector.choose({ ...observation, declarerPoints: 70 }).status).toBe('locked');
    expect(selector.choose({ ...observation, ownHand: [observation.ownHand[0]] }).status).toBe('only-move');
    expect(create).not.toHaveBeenCalled();
  });

  it('优化 Agent 可完成多副不同牌局，每次出牌合法且分数守恒', () => {
    for (const seed of [4, 16, 35]) {
      let state = playing(seed);
      const agent = createOptimizedAgent({
        budget: { ...FAST_OPTIMIZED_BUDGET, minWorlds: 4, maxWorlds: 4, timeLimitMs: Infinity },
        dependencies: { random: () => seededSearchRandom(619) },
      });
      while (state.phase === 'playing') {
        const action = agent.nextAction(state)!;
        expect(action.kind).toBe('play');
        state = applyAiAction(state, action);
      }
      expect(state.result!.declarerPoints + state.result!.defenderPoints).toBe(100);
    }
  }, 15000);
});

describe('共同样本和统计淘汰', () => {
  it('全部合法牌共用每个样本，明确较差的候选可以淘汰', () => {
    const state = playing();
    const observation = observePlayer(state, currentSeat(state));
    const legal = legalObservationCards(observation);
    const best = cardId(legal[legal.length - 1]);
    const worlds: object[] = [];
    const evaluations: object[] = [];
    const selector = new PairedCardSelector({
      worlds: { create: () => ({ sample: () => {
        const world = { hands: state.hands, kitty: state.kitty };
        worlds.push(world);
        return world;
      } }) },
      evaluator: { evaluate: (_observation, world, card) => {
        evaluations.push(world);
        return cardId(card) === best ? 1 : 0;
      } },
      fallback: { chooseCard: () => legal[0] }, now: () => 0,
    }, { minWorlds: 8, maxWorlds: 64, timeLimitMs: Infinity });
    const decision = selector.choose(observation);
    expect(cardId(decision.card)).toBe(best);
    expect(decision.status).toBe('separated');
    expect(decision.moves.every((move) => move.samples >= 8)).toBe(true);
    for (const world of worlds) expect(evaluations.filter((entry) => entry === world)).toHaveLength(legal.length);
  });

  it('超时丢弃未完成检查点，保留上次完整配对结果', () => {
    const state = playing();
    const observation = observePlayer(state, currentSeat(state));
    const legal = legalObservationCards(observation);
    let evaluations = 0;
    const selector = new PairedCardSelector({
      worlds: { create: () => ({ sample: () => ({ hands: state.hands, kitty: state.kitty }) }) },
      evaluator: { evaluate: () => { if (++evaluations > legal.length * 2 + 1) throw new BudgetExceededError(); return 0; } },
      fallback: observationPolicy, now: () => 0,
    }, { minWorlds: 2, maxWorlds: 4, timeLimitMs: Infinity });
    const decision = selector.choose(observation);
    expect(decision.worlds).toBe(2);
    expect(decision.moves.every((move) => move.samples === 2)).toBe(true);
    expect(decision.comparisons.every((pair) => pair.samples === 2)).toBe(true);
  });

  it('保守模式不会因没有统计证据的小幅领先切换牌', () => {
    const state = playing();
    const observation = observePlayer(state, currentSeat(state));
    const legal = legalObservationCards(observation);
    const selector = new PairedCardSelector({
      worlds: { create: () => ({ sample: () => ({ hands: state.hands, kitty: state.kitty }) }) },
      evaluator: { evaluate: (_o, _w, card) => cardId(card) === cardId(legal[1]) ? 1 : 0 },
      fallback: { chooseCard: () => legal[0] }, now: () => 0,
    }, { minWorlds: 1, maxWorlds: 1, timeLimitMs: Infinity, conservative: true });
    expect(selector.choose(observation).card).toEqual(legal[0]);
  });

  it('配对区间覆盖全部候选对，正反方向一致', () => {
    const cards = [makeCard('S', '2'), makeCard('H', '3')];
    const stats = new PairedStatistics(cards);
    stats.record(new Map([[cardId(cards[0]), 1], [cardId(cards[1]), 0]]));
    const pair = stats.comparisons(7, 0.05)[0];
    expect(pair.samples).toBe(1);
    expect(pair.lower).toBeGreaterThanOrEqual(-1);
    expect(pair.upper).toBeLessThanOrEqual(1);
  });
});

class FakeWorker implements SearchWorkerPort {
  onmessage: ((event: MessageEvent<SearchWorkerResponse>) => void) | null = null;
  onerror: ((event: ErrorEvent) => void) | null = null;
  onmessageerror: ((event: MessageEvent) => void) | null = null;
  request?: SearchWorkerRequest;
  terminate = vi.fn();
  postMessage(request: SearchWorkerRequest) { this.request = request; }
  reply(id: number, card: Card) {
    this.onmessage?.(new MessageEvent('message', { data: {
      id, decision: { card, status: 'budget', worlds: 8, moves: [], comparisons: [], elapsedMs: 1 },
    } }));
  }
}

describe('异步搜索生命周期', () => {
  it('只向 Worker 发送观察，忽略其他请求的回复并释放 Worker', async () => {
    const state = playing();
    const observation = observePlayer(state, currentSeat(state));
    const worker = new FakeWorker();
    const client = new WorkerCardSelector({ createWorker: () => worker });
    const promise = client.choose(observation);
    expect(worker.request).not.toHaveProperty('hands');
    expect(worker.request).not.toHaveProperty('seed');
    expect(worker.request?.observation).toEqual(observation);
    const card = legalObservationCards(observation)[0];
    worker.reply(worker.request!.id + 1, card);
    expect(worker.terminate).not.toHaveBeenCalled();
    worker.reply(worker.request!.id, card);
    expect((await promise).card).toEqual(card);
    expect(worker.terminate).toHaveBeenCalledOnce();
  });

  it('取消时终止搜索并拒绝 Promise，晚到结果不能生效', async () => {
    const state = playing();
    const worker = new FakeWorker();
    const controller = new AbortController();
    const client = new WorkerCardSelector({ createWorker: () => worker });
    const promise = client.choose(observePlayer(state, currentSeat(state)), controller.signal);
    controller.abort();
    await expect(promise).rejects.toHaveProperty('name', 'AbortError');
    expect(worker.terminate).toHaveBeenCalledOnce();
    expect(worker.onmessage).toBeNull();
  });

  it('Worker 无法启动或超时返回合法兜底牌', async () => {
    vi.useFakeTimers();
    try {
      const state = playing();
      const observation = observePlayer(state, currentSeat(state));
      const failed = new WorkerCardSelector({ createWorker: () => { throw new Error('不可用'); } });
      expect((await failed.choose(observation)).status).toBe('fallback');
      const worker = new FakeWorker();
      const pending = new WorkerCardSelector({ createWorker: () => worker, timeoutMs: 20 }).choose(observation);
      await vi.advanceTimersByTimeAsync(20);
      expect(legalObservationCards(observation).map(cardId)).toContain(cardId((await pending).card));
      expect(worker.terminate).toHaveBeenCalledOnce();
    } finally { vi.useRealTimers(); }
  });
});
