/**
 * 数据化评估样本回归；按单一职责原则验证数据边界、声明式裁判及运行隔离。
 */
import { describe, expect, it } from 'vitest';
import biddingData from '../data/evaluation/bidding.json';
import trumpData from '../data/evaluation/trump.json';
import buryData from '../data/evaluation/bury.json';
import playingData from '../data/evaluation/playing.json';
import { ALL_BENCHMARK_SCENARIOS, loadScenarios } from '@yaozifen/ai-eval/scenarios';
import { BenchmarkRunner } from '@yaozifen/ai-eval/benchmarkRunner';
import { BridgeEngine } from '@yaozifen/ai-core/bridge/bridgeEngine';
import { compatibleSummary, SUITE_VERSION } from '@yaozifen/ai-eval/fingerprint';
import { c } from '@yaozifen/ai-eval/deckHelper';
import { BaseEvaluationReport } from '@yaozifen/ai-core/engines/llm/llmEvaluator';

const allData = [...biddingData, ...trumpData, ...buryData, ...playingData];
const legal: BaseEvaluationReport = { isLegal: true, score: 90, tacticalRating: 'good', details: '' };
const scenario = (id: string) => ALL_BENCHMARK_SCENARIOS.find(s => s.id === id)!;
const evaluation = <T extends object>(fields: T) => Object.assign({}, legal, fields);
const buryReport = evaluation({ zeroPointsBuried: true, trumpsPreserved: true, voidsCreated: 2 });
const buried = (...cards: string[]) => ({ action: { cards: cards.map(c) } });

describe('JSON 评估样本加载与隔离', () => {
  it('样本元信息和顺序直接来自四阶段数据文件', () => {
    expect(ALL_BENCHMARK_SCENARIOS.map(({ setup: _setup, expectedCriteria: _criteria, definition: _definition, ...metadata }) => metadata))
      .toEqual(allData.map(({ setup: _setup, expected: _expected, ...metadata }) => metadata));
    expect(ALL_BENCHMARK_SCENARIOS.every(s => s.definition)).toBe(true);
    expect(SUITE_VERSION).toBe('1.4.0');
  });

  it.each([
    ['座位越界', { ...biddingData[0], setup: { ...biddingData[0].setup, seat: 4 } }],
    ['座位缺失', { ...biddingData[0], setup: { hand: biddingData[0].setup.hand } }],
    ['非法牌记法', { ...biddingData[0], setup: { ...biddingData[0].setup, hand: ['SA', ...biddingData[0].setup.hand.slice(1)] } }],
    ['缺少主牌', { ...buryData[0], setup: { seat: 1, hand16: buryData[0].setup.hand16 } }],
    ['未知阶段', { ...biddingData[0], phase: 'unknown' }],
    ['缺少通过条件', { ...biddingData[0], expected: {} }],
    ['叫分区间颠倒', { ...biddingData[0], expected: { minBid: 90, maxBid: 80 } }],
    ['叫分条件冲突', { ...biddingData[0], expected: { bids: [null], minBid: 70, maxBid: 80 } }],
    ['通过条件字段拼错', { ...buryData[0], expected: { zeroPointsBuried: true, preserveTrumps: true } }],
    ['无出牌条件', { ...playingData[0], expected: {} }],
    ['手牌张数错误', { ...trumpData[0], setup: { ...trumpData[0].setup, hand: trumpData[0].setup.hand.slice(1) } }],
    ['历史座位越界', { ...playingData[2], setup: { ...playingData[2].setup, currentRound: [{ seat: -1, card: '3D' }] } }],
  ])('%s 的错误包含样本 ID', (_name, data) => {
    expect(() => loadScenarios([data])).toThrow(data.id);
  });

  it('拒绝不同阶段重复的 ID', () => {
    expect(() => loadScenarios([biddingData[0], { ...trumpData[0], id: biddingData[0].id }]))
      .toThrow(`评估样本 ${biddingData[0].id}：id 重复`);
  });

  it('牌张冲突和历史得分矛盾仍由构造器拒绝并注明 ID', () => {
    const duplicate = structuredClone(biddingData[0]);
    duplicate.setup.hand[1] = duplicate.setup.hand[0];
    expect(() => loadScenarios([duplicate])).toThrow(duplicate.id);
    const invalidPoints = structuredClone(playingData[1]);
    invalidPoints.setup.declarerPoints = 0;
    expect(() => loadScenarios([invalidPoints])).toThrow('双方得分归属');
    expect(() => loadScenarios([invalidPoints])).toThrow(invalidPoints.id);
  });

  it('重复构造隔离手牌、历史、绝门数组和原始 JSON', () => {
    const jsonBefore = structuredClone(allData);
    for (const s of ALL_BENCHMARK_SCENARIOS) {
      const definitionBefore = structuredClone(s.definition);
      // GameState 的规则对象包含函数，只对可变局面数据做序列化快照。
      const before = JSON.stringify(s.setup());
      const result = s.setup();
      if (result.state) {
        result.state.hands[result.seat].splice(0, 1);
        result.state.kitty.splice(0, 1);
        result.state.bidding.push({ seat: 0, bid: null });
      } else if (result.observation) {
        // 模拟消费方在运行时修改只读观察，检查嵌套引用也已隔离。
        Reflect.set(result.observation.ownHand[0], 'rank', 'Q');
        Reflect.set(result.observation.voidSuits[0], '0', 'H');
        for (const entry of result.observation.currentRound) Reflect.set(entry, 'seat', 0);
        for (const round of result.observation.completedRounds) {
          Reflect.set(round, 'points', 100);
          Reflect.set(round.cards[0].card, 'rank', 'Q');
        }
      }
      expect(JSON.stringify(s.setup()), s.id).toBe(before);
      expect(s.definition, s.id).toEqual(definitionBefore);
    }
    expect(allData).toEqual(jsonBefore);
  });
});

describe('声明式通过条件保留判定边界', () => {
  it('不叫使用 null，原始动作与报告的读取语义保持一致', () => {
    const check = scenario('bid-garbage-pass').expectedCriteria;
    expect(check(evaluation({ bid: null }))).toBe(true);
    expect(check(evaluation({ bid: 70 }))).toBe(false);
    expect(check(evaluation({ bid: null }), { action: { bid: 70 } })).toBe(false);
    expect(check(evaluation({ bid: 70 }), { action: { bid: null } })).toBe(false);
    expect(check(evaluation({ bid: null, isLegal: false }))).toBe(false);
  });

  it('叫分允许列表和区间含两端，不接受区间外或不叫', () => {
    const listed = scenario('bid-standard-open').expectedCriteria;
    for (const bid of [70, 75]) expect(listed(evaluation({ bid }))).toBe(true);
    expect(listed(evaluation({ bid: 80 }))).toBe(false);
    const ranged = scenario('bid-strong-high-bid').expectedCriteria;
    for (const bid of [85, 90, 95, 100]) expect(ranged(evaluation({ bid }))).toBe(true);
    for (const bid of [80, 105, null]) expect(ranged(evaluation({ bid }))).toBe(false);
  });

  it('定主允许多种花色且可从原始动作读取', () => {
    const check = scenario('trump-4-4-choice-void-threat').expectedCriteria;
    for (const trump of ['S', 'H']) expect(check(evaluation({ trump }))).toBe(true);
    expect(check(evaluation({ trump: 'D' }))).toBe(false);
    expect(check(evaluation({ trump: 'D' }), { action: { trump: 'H' } })).toBe(true);
    expect(check(evaluation({ trump: 'S', isLegal: false }))).toBe(false);
  });

  it('扣底必须扣入指定牌、保持零分和主牌', () => {
    const check = scenario('bury-create-single-void').expectedCriteria;
    const raw = buried('3D', '2D', '8C', '2C');
    expect(check(buryReport, raw)).toBe(true);
    expect(check(buryReport, buried('3D', '8H', '8C', '2C'))).toBe(false);
    expect(check(buryReport)).toBe(false);
    expect(check(evaluation({ ...buryReport, trumpsPreserved: false }), raw)).toBe(false);
    expect(check(evaluation({ ...buryReport, zeroPointsBuried: false }), raw)).toBe(false);
    expect(check(evaluation({ ...buryReport, isLegal: false }), raw)).toBe(false);
  });

  it('扣底禁选约束和绝门数量保留原有通过条件', () => {
    const forbidden = scenario('bury-keep-tenace').expectedCriteria;
    expect(forbidden(buryReport, buried('JD', '8D', '6D', '2D'))).toBe(true);
    for (const card of ['3H', 'QH']) expect(forbidden(buryReport, buried(card, '8D', '6D', '2D'))).toBe(false);
    expect(forbidden(buryReport)).toBe(true);
    const voids = scenario('bury-double-voids').expectedCriteria;
    expect(voids(buryReport)).toBe(true);
    expect(voids(evaluation({ ...buryReport, voidsCreated: 1 }))).toBe(false);
  });

  it('允许多个合理出牌，安全脱手只排除原先禁止的牌', () => {
    const feed = scenario('play-feed-partner-void').expectedCriteria;
    for (const cardId of ['3C', 'KD']) expect(feed(evaluation({ cardId }))).toBe(true);
    expect(feed(evaluation({ cardId: '2D' }))).toBe(false);
    expect(feed(evaluation({ cardId: 'KD', isLegal: false }))).toBe(false);
    const exit = scenario('play-safe-exit').expectedCriteria;
    expect(exit(evaluation({ cardId: '10D' }))).toBe(false);
    expect(exit(evaluation({ cardId: '4D' }))).toBe(true);
  });
});

describe('JSON 评估样本运行指纹', () => {
  it('只修改输入或通过条件即可使缓存失效，函数文本相同也能识别', async () => {
    const engine = new BridgeEngine({ config: { mode: 'fast', maxWorlds: 0, minWorlds: 0, timeLimitMs: 0, endgameCardLimit: 0 } });
    const runner = new BenchmarkRunner();
    const base = loadScenarios([biddingData[0]]);
    const summary = await runner.runSuite(engine, base, { codeHash: 'same-code' });
    const changedExpected = loadScenarios([{ ...biddingData[0], expected: { bids: [70] } }]);
    expect(changedExpected[0].expectedCriteria.toString()).toBe(base[0].expectedCriteria.toString());
    expect(compatibleSummary(summary, await runner.describeRun(engine, changedExpected, { codeHash: 'same-code' }))).toBe(false);
    const input = structuredClone(biddingData[0]);
    input.setup.hand[0] = '9S';
    expect(compatibleSummary(summary, await runner.describeRun(engine, loadScenarios([input]), { codeHash: 'same-code' }))).toBe(false);
    expect(compatibleSummary(summary, await runner.describeRun(engine, loadScenarios([biddingData[0]]), { codeHash: 'same-code' }))).toBe(true);
    expect(compatibleSummary({ ...summary, suiteVersion: '1.2.0' }, await runner.describeRun(engine, base, { codeHash: 'same-code' }))).toBe(false);
  });

  it('相同输入下替换自定义构造或裁判函数也改变指纹', async () => {
    const runner = new BenchmarkRunner();
    const engine = new BridgeEngine({ config: { mode: 'fast', maxWorlds: 0, minWorlds: 0, timeLimitMs: 0, endgameCardLimit: 0 } });
    const base = loadScenarios([biddingData[0]]);
    const identity = await runner.describeRun(engine, base);
    const replacedSetup = [{ ...base[0], setup: () => base[0].setup() }];
    const replacedCriteria = [{ ...base[0], expectedCriteria: () => false }];
    expect((await runner.describeRun(engine, replacedSetup)).dataHash).not.toBe(identity.dataHash);
    expect((await runner.describeRun(engine, replacedCriteria)).dataHash).not.toBe(identity.dataHash);
  });
});
