/** 评测覆盖护栏；按单一职责原则检查结构缺口与合法可见信息，不以引擎答案反推题目。 */
import { describe, expect, it } from 'vitest';
import { ALL_BENCHMARK_SCENARIOS, PLAYING_SCENARIOS, loadScenarios } from '../src/ai/eval/scenarios';
import { scenarioObservation } from '../src/ai/eval/fingerprint';
import { BenchmarkRunner } from '../src/ai/eval/benchmarkRunner';
import { BridgeEngine } from '../src/ai/bridge/bridgeEngine';
import { cardId, cardPoints, freshDeck, SUITS } from '../src/cards';
import { ScenarioDefinition } from '../src/ai/eval/types';
import { createBeliefSource, seededSearchRandom, unlimitedGuard } from '../src/ai/optimized';
import { observeDecision } from '../src/ai/decisionObservation';
import { createGame, currentSeat, GameState, legalMoves, playCard } from '../src/engine';
import { LlmDecisionEvaluator } from '../src/ai/engines/llm/llmEvaluator';
import playingData from '../data/evaluation/playing.json';

const playing = () => PLAYING_SCENARIOS.map(s => s.setup().observation!);
const openFixture = () => {
  const base = structuredClone(playingData[0]);
  const used = new Set(base.setup.ownHand);
  return { ...base, id: 'test-open-partner', setup: { ...base.setup, bid: 100,
    revealedHand: { seat: 3, cards: freshDeck().map(cardId).filter(id => !used.has(id)).slice(0, 12) } } };
};

describe('公开回归套件的覆盖下限', () => {
  it.each(['bidding', 'trump', 'bury', 'playing'])('%s 阶段完整覆盖四家(0..3)决策', phase => {
    const seats = ALL_BENCHMARK_SCENARIOS.filter(s => s.phase === phase).map(s => s.setup().seat);
    expect(seats).toContain(0);
    expect(seats).toContain(1);
    expect(seats).toContain(2);
    expect(seats).toContain(3);
  });
  it('第二手与第三手各有至少三个场景，涵盖常规与例外', () => {
    for (const position of [1, 2]) expect(playing().filter(o => o.currentRound.length === position).length).toBeGreaterThanOrEqual(3);
  });
  it('第二手包含立即赢合同的争分例外，不把走小写成无条件规则', () => {
    expect(PLAYING_SCENARIOS.find(s => s.id === 'play-second-open-defender-win')).toBeDefined();
  });
  it('出牌与扣底均覆盖四种主花色，启用非 75 合同和已知底牌', () => {
    for (const phase of ['playing', 'bury']) {
      const suits = ALL_BENCHMARK_SCENARIOS.filter(s => s.phase === phase).map(s => s.setup()).map(s => s.observation?.trump ?? s.state?.trump);
      for (const suit of ['S', 'H', 'C', 'D']) expect(suits).toContain(suit);
    }
    for (const phase of ['trump', 'bury']) expect(ALL_BENCHMARK_SCENARIOS.filter(s => s.phase === phase)
      .some(s => s.definition && 'winningBid' in s.definition.setup && s.definition.setup.winningBid !== 75)).toBe(true);
    expect(playing().some(o => o.knownBuriedCards?.length === 4)).toBe(true);
  });
  it('补足中后盘、庄闲临界分线和 100 分三种观察者', () => {
    const observations = playing();
    expect(observations.filter(o => o.roundNumber >= 10).length).toBeGreaterThanOrEqual(3);
    expect(observations.some(o => o.bid - o.declarerPoints === 5)).toBe(true);
    expect(observations.some(o => 105 - o.bid - o.defenderPoints === 5)).toBe(true);
    const open = observations.filter(o => o.bid === 100 && o.revealedHand);
    expect(open.some(o => o.seat === o.declarer)).toBe(true);
    expect(open.some(o => o.seat === (o.declarer + 2) % 4)).toBe(true);
    expect(open.some(o => o.seat % 2 !== o.declarer % 2)).toBe(true);
  });
});

describe('场景加载期的底牌与明牌边界', () => {
  it('100 分场景接受合法搭档明牌，并进入执行器与日志观察', () => {
    const fixture = openFixture();
    const scenario = loadScenarios([fixture])[0];
    const observation = scenario.setup().observation!;
    expect(observation.revealedHand?.cards.map(cardId)).toEqual(fixture.setup.revealedHand.cards);
    expect(scenarioObservation(scenario)).toMatchObject({ bid: 100, revealedHand: { seat: 3 } });
  });
  it('100 分场景缺少明牌不能静默作为暗牌局评估', () => {
    const base = playingData[0];
    expect(() => loadScenarios([{ ...base, setup: { ...base.setup, bid: 100 } }])).toThrow('明牌');
  });
  it.each([
    ['非庄家知道底牌', { declarer: 0, knownBuriedCards: ['2S', '3S', '2C', '3C'] }],
    ['扣底含分牌', { knownBuriedCards: ['5S', '3S', '2C', '3C'] }],
  ])('%s 在加载期即拒绝', (_name, overrides) => {
    const base = playingData[0];
    expect(() => loadScenarios([{ ...base, setup: { ...base.setup, ...overrides } }])).toThrow('底牌');
  });
  it('已经达到任一成局线的局面不能继续作为出牌题', () => {
    const base = playingData[1];
    // 历史庄方已得 25，95 分合同的闲方成局线为 10；交换庄闲归属后已结束。
    expect(() => loadScenarios([{ ...base, setup: { ...base.setup, declarer: 0, bid: 95,
      declarerPoints: 0, defenderPoints: 25 } }])).toThrow('成局线');
  });
});

describe('评测报告的覆盖口径', () => {
  it('只统计实际运行的场景，报告标明公开回归用途', async () => {
    const runner = new BenchmarkRunner();
    const selected = [ALL_BENCHMARK_SCENARIOS[0]];
    const summary = await runner.runSuite(new BridgeEngine({ config: { mode: 'fast', maxWorlds: 0, minWorlds: 0,
      timeLimitMs: 0, endgameCardLimit: 0 } }), selected);
    expect(summary).toMatchObject({ coverage: { total: 1, phaseSeats: { bidding: [0, 1, 0, 0] },
      playingPositions: [0, 0, 0, 0], lateGame: 0, knownBuriedCards: 0 } });
    const report = runner.formatMarkdownReport(summary);
    expect(report).toContain('公开开发回归集');
    expect(report).toContain('不代表泛化牌力');
    expect(report).toContain('座位');
    expect(JSON.parse(runner.generateReportFiles(summary).manifestJson)).toHaveProperty('coverage');
  });
});

// 对称变换仅用于回归，不增加评测分母；同一题的旋转不能当独立牌力样本。
function rotate(definition: ScenarioDefinition, offset: number): ScenarioDefinition {
  const data = structuredClone(definition);
  const seat = (s: number) => (s + offset) % 4;
  data.setup.seat = seat(data.setup.seat);
  if (data.phase === 'bidding') {
    if (data.setup.highestBidder != null) data.setup.highestBidder = seat(data.setup.highestBidder);
    data.setup.history?.forEach(note => { note.seat = seat(note.seat); });
  }
  if (data.phase === 'playing') {
    data.setup.declarer = seat(data.setup.declarer);
    data.setup.leader = seat(data.setup.leader);
    data.setup.currentRound.forEach(entry => { entry.seat = seat(entry.seat); });
    data.setup.completedRounds?.forEach(round => {
      round.winner = seat(round.winner);
      round.cards.forEach(entry => { entry.seat = seat(entry.seat); });
    });
    if (data.setup.revealedHand) data.setup.revealedHand.seat = seat(data.setup.revealedHand.seat);
    if (data.setup.voidSuits) {
      const voids = data.setup.voidSuits;
      data.setup.voidSuits = Array.from({ length: 4 }, (_, s) => voids[(s - offset + 4) % 4]);
    }
  }
  return data;
}

function permuteSuits(value: unknown, offset: number): unknown {
  if (typeof value === 'string') {
    const index = SUITS.findIndex(suit => suit === value.at(-1));
    if (index >= 0 && /^(?:[2-9]|10|[JQKA])?[SHCD]$/.test(value)) {
      return value.slice(0, -1) + SUITS[(index + offset) % 4];
    }
  }
  if (Array.isArray(value)) return value.map(item => permuteSuits(item, offset));
  if (value && typeof value === 'object') return Object.fromEntries(
    Object.entries(value).map(([key, item]) => [key, permuteSuits(item, offset)]));
  return value;
}

describe('座位参数化与可见信息隔离', () => {
  it.each([1, 2, 3])('所有场景花色轮换 %i 后仍能构造，跟牌候选随之等价变换', offset => {
    for (const base of ALL_BENCHMARK_SCENARIOS) {
      const scenario = loadScenarios([{ ...base.definition,
        setup: permuteSuits(base.definition!.setup, offset),
        expected: permuteSuits(base.definition!.expected, offset) }])[0];
      const original = base.setup(), changed = scenario.setup();
      if (original.candidates) expect(changed.candidates!.map(cardId).sort()).toEqual(
        original.candidates.map(card => permuteSuits(cardId(card), offset)).sort());
      expect(changed.seat).toBe(original.seat);
      expect(scenarioObservation(scenario, changed)).not.toHaveProperty('seed');
    }
  });
  it.each([0, 1, 2, 3])('所有场景旋转 %i 座后仍合法且无暗牌泄露', offset => {
    for (const base of ALL_BENCHMARK_SCENARIOS) {
      const scenario = loadScenarios([rotate(base.definition!, offset)])[0];
      const setup = scenario.setup();
      if (setup.state) {
        const state = setup.state;
        const expected = observeDecision(state, setup.seat);
        const hands = state.hands.map((hand, seat) => seat === setup.seat ? hand : new Proxy(hand, {
          get(target, key) { if (key === 'length') return target.length; throw new Error('读取了暗牌'); },
        }));
        const guarded = Object.defineProperty({ ...state, hands,
          kitty: new Proxy(state.kitty, { get() { throw new Error('读取了未知底牌'); } }),
        }, 'seed', { get() { throw new Error('读取了 seed'); } });
        expect(observeDecision(guarded, setup.seat), scenario.id).toEqual(expected);
        expect(expected).not.toHaveProperty('revealedHand');
      } else {
        const o = setup.observation!;
        const world = createBeliefSource(o).sample(seededSearchRandom(31), unlimitedGuard);
        expect(world.hands.map(hand => hand.length)).toEqual(o.handCounts);
        if (o.revealedHand) expect(world.hands[o.revealedHand.seat].map(cardId).sort()).toEqual(o.revealedHand.cards.map(cardId).sort());
        if (o.knownBuriedCards) expect(world.kitty.map(cardId).sort()).toEqual(o.knownBuriedCards.map(cardId).sort());
      }
      const visible = scenarioObservation(scenario, setup);
      expect(visible).not.toHaveProperty('hands');
      expect(visible).not.toHaveProperty('seed');
    }
  });

  it('100 分明牌随实际出牌减少，重新观察四家均保持隔离', () => {
    const fixture = PLAYING_SCENARIOS.find(s => s.id === 'play-open-declarer-draw-diamonds')!;
    const o = fixture.setup().observation!;
    const world = createBeliefSource(o).sample(seededSearchRandom(17), unlimitedGuard);
    let state: GameState = { ...createGame(1), phase: 'playing', hands: world.hands.map(hand => [...hand]), kitty: [...world.kitty],
      trump: o.trump, highestBid: o.bid, declarer: o.declarer, leader: o.leader };
    for (let i = 0; i < 3; i++) {
      const seat = currentSeat(state);
      state = playCard(state, seat, legalMoves(state, seat)[0]);
    }
    for (let seat = 0; seat < 4; seat++) {
      const expected = observeDecision(state, seat);
      expect(expected).toMatchObject({ revealedHand: { seat: 2, cards: state.hands[2] } });
      if (expected.phase === 'playing') {
        expect(expected.revealedHand!.cards).toHaveLength(11);
        expect(expected.knownBuriedCards).toEqual(seat === o.declarer ? world.kitty : undefined);
      }
      const guarded = Object.defineProperty({ ...state, hands: state.hands.map((hand, s) => s === seat || s === 2 ? hand
        : new Proxy(hand, { get(target, key) { if (key === 'length') return target.length; throw new Error('读取了暗牌'); } })),
        kitty: seat === o.declarer ? state.kitty : new Proxy(state.kitty, { get() { throw new Error('读取了未知底牌'); } }),
      }, 'seed', { get() { throw new Error('读取了 seed'); } });
      expect(observeDecision(guarded, seat)).toEqual(expected);
    }
  });
});

describe('新增样题的裁判与分线依据', () => {
  it('临界喂 5 分题不能在出零分牌时也已经足够成局', () => {
    const o = PLAYING_SCENARIOS.find(s => s.id === 'play-late-declarer-feed-five')!.setup().observation!;
    const pool = o.currentRound.reduce((sum, entry) => sum + cardPoints(entry.card), 0);
    expect(o.declarerPoints + pool).toBeLessThan(o.bid);
    expect(o.declarerPoints + pool + 5).toBe(o.bid);
  });

  it('第二手 A 或 K 均能立即赢副时，不把唯一大牌当作唯一答案', () => {
    const scenario = PLAYING_SCENARIOS.find(s => s.id === 'play-second-open-defender-win')!;
    const { observation: o, candidates } = scenario.setup();
    const card = candidates!.find(card => cardId(card) === 'KH')!;
    const report = new LlmDecisionEvaluator().evaluatePlay(o!, candidates!, { card, engineType: 'bridge', latencyMs: 0 });
    expect(scenario.expectedCriteria(report)).toBe(true);
  });
  it('每个允许的出牌答案都在合法候选中，非法动作始终不能通过', () => {
    const evaluator = new LlmDecisionEvaluator();
    for (const scenario of PLAYING_SCENARIOS) {
      const { observation: o, candidates } = scenario.setup();
      const data = scenario.definition!;
      if (data.phase !== 'playing') continue;
      for (const id of data.expected.cards ?? []) {
        const card = candidates!.find(card => cardId(card) === id);
        expect(card, scenario.id).toBeDefined();
        const report = evaluator.evaluatePlay(o!, candidates!, { card: card!, engineType: 'bridge', latencyMs: 0 });
        expect(scenario.expectedCriteria(report), scenario.id).toBe(true);
        expect(scenario.expectedCriteria({ ...report, isLegal: false }), scenario.id).toBe(false);
      }
    }
  });

  it('临界残局的白名单动作对合法暗牌补全均能当墩成局', () => {
    for (const scenario of PLAYING_SCENARIOS.filter(s => s.id.startsWith('play-late-'))) {
      const o = scenario.setup().observation!;
      const data = scenario.definition!;
      if (data.phase !== 'playing') continue;
      for (const id of data.expected.cards ?? []) for (let seed = 0; seed < 6; seed++) {
        const world = createBeliefSource(o).sample(seededSearchRandom(seed), unlimitedGuard);
        let state: GameState = { ...createGame(1), phase: 'playing', hands: world.hands.map(hand => [...hand]), kitty: [...world.kitty],
          trump: o.trump, declarer: o.declarer, highestBid: o.bid, leader: o.leader, trickNumber: o.roundNumber,
          trick: [...o.currentRound], completedTricks: o.completedRounds.map(round => ({ ...round, cards: [...round.cards] })),
          declarerTrickPoints: o.declarerPoints, defenderTrickPoints: o.defenderPoints };
        state = playCard(state, o.seat, state.hands[o.seat].find(card => cardId(card) === id)!);
        const finishTrick = (state: GameState): void => {
          if (state.phase !== 'playing' || state.trickNumber !== o.roundNumber) {
            expect(state.phase, scenario.id).toBe('handEnd');
            expect(state.result!.winnerSide, scenario.id).toBe(o.seat % 2);
            return;
          }
          const seat = currentSeat(state);
          for (const card of legalMoves(state, seat)) finishTrick(playCard(state, seat, card));
        };
        finishTrick(state);
      }
    }
  });

  it.each(['非100 分', '错误座位', '缺牌', '重牌', '历史重叠'])('拒绝%s明牌夹具', kind => {
    const fixture = openFixture();
    if (kind === '非100 分') fixture.setup.bid = 95;
    if (kind === '错误座位') fixture.setup.revealedHand.seat = 0;
    if (kind === '缺牌') fixture.setup.revealedHand.cards.pop();
    if (kind === '重牌') fixture.setup.revealedHand.cards[1] = fixture.setup.revealedHand.cards[0];
    if (kind === '历史重叠') fixture.setup.revealedHand.cards[0] = fixture.setup.ownHand[0];
    expect(() => loadScenarios([fixture])).toThrow();
  });
});
