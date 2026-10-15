import { describe, expect, it } from 'vitest';
import { BridgeEngine } from '@yaozifen/ai-core/bridge/bridgeEngine';
import { LlmEngine } from '@yaozifen/ai-core/engines/llmEngine';
import { BenchmarkRunner } from '@yaozifen/ai-eval/benchmarkRunner';
import { createPlayingObservation } from '@yaozifen/ai-eval/deckHelper';
import { ALL_BENCHMARK_SCENARIOS, PLAYING_SCENARIOS } from '@yaozifen/ai-eval/scenarios';
import { compatibleSummary, contentHash, evaluationConfig } from '@yaozifen/ai-eval/fingerprint';
import { pairedWinRateInterval, scoreDuplicateBoard } from '@yaozifen/ai-core/statistics/duplicateBattle';
import { makeCard, cardId } from '@yaozifen/game-core/cards';
import { trickWinner, sideOf } from '@yaozifen/game-core';

describe('评测结果完整性回归', () => {
  it('按真实赢副判胜，即使失败方吃分更多也不能算赢', () => {
    const result = scoreDuplicateBoard(
      { winnerSide: 1, team0Points: 40, team1Points: 5 },
      { winnerSide: 0, team0Points: 10, team1Points: 40 },
    );
    expect(result.engineAScore).toBeGreaterThan(result.engineBScore);
    expect(result.engineAWins).toBe(0);
    expect(result.engineBWins).toBe(2);
    expect(result.winner).toBe('B');
  });

  it('同组交换座位的两局一胜一负为平组，不按分差改变判定', () => {
    const result = scoreDuplicateBoard(
      { winnerSide: 0, team0Points: 70, team1Points: 20 },
      { winnerSide: 0, team0Points: 10, team1Points: 5 },
    );
    expect(result.winner).toBe('TIE');
    const interval = pairedWinRateInterval(Array.from({ length: 10 }, () => result));
    expect(interval.difference).toBe(0);
    expect(interval.lower).toBeLessThan(0);
    expect(interval.upper).toBeGreaterThan(0);
    expect(interval.groups).toBe(10);
  });

  it('所有出牌样本的双方得分与重新计算的赢家一致', () => {
    for (const scenario of PLAYING_SCENARIOS) {
      const o = scenario.setup().observation!;
      const points = [0, 0];
      for (const round of o.completedRounds) {
        const winner = trickWinner([...round.cards], o.trump).seat;
        expect(round.winner).toBe(winner);
        points[sideOf(winner) === sideOf(o.declarer) ? 0 : 1] += round.points;
      }
      expect(points).toEqual([o.declarerPoints, o.defenderPoints]);
    }
  });

  it('总分守恒但阵营记错的场景必须拒绝', () => {
    const o = PLAYING_SCENARIOS.find(s => s.id === 'play-overruff-opponent')!.setup().observation!;
    expect(() => createPlayingObservation({ ...o, ownHand: [...o.ownHand], currentRound: [...o.currentRound],
      completedRounds: o.completedRounds.map(r => ({ ...r, cards: [...r.cards] })), voidSuits: o.voidSuits.map(v => [...v]),
      knownBuriedCards: o.knownBuriedCards ? [...o.knownBuriedCards] : undefined,
      declarerPoints: 0, defenderPoints: 10 })).toThrow('双方得分归属');
  });

  it('兑现已经升高的方块 K 也可通过，避免把合理动作硬判为失败', () => {
    const scenario = PLAYING_SCENARIOS.find(s => s.id === 'play-feed-partner-void')!;
    expect(scenario.expectedCriteria({ isLegal: true, score: 90, tacticalRating: 'good', details: '', cardId: 'KD' } as any)).toBe(true);
  });

  it('缓存身份检测数据、裁判、阶段、配置和源码的变化', async () => {
    const runner = new BenchmarkRunner();
    const engine = new BridgeEngine({ config: { mode: 'fast', maxWorlds: 0, minWorlds: 0, timeLimitMs: 0, endgameCardLimit: 0 } });
    const scenarios = ALL_BENCHMARK_SCENARIOS.slice(0, 1);
    const options = { codeHash: 'source-a' };
    const summary = await runner.runSuite(engine, scenarios, options);
    expect(compatibleSummary(summary, await runner.describeRun(engine, scenarios, options))).toBe(true);
    expect(compatibleSummary(summary, await runner.describeRun(engine, scenarios, { codeHash: 'source-b' }))).toBe(false);
    expect(compatibleSummary(summary, await runner.describeRun(engine, scenarios, { ...options, concurrency: 2 }))).toBe(false);
    expect(compatibleSummary(summary, await runner.describeRun(engine, ALL_BENCHMARK_SCENARIOS.slice(0, 2), options))).toBe(false);
    expect(compatibleSummary(summary, await runner.describeRun(engine, [{ ...scenarios[0], expectedCriteria: () => false }], options))).toBe(false);
    expect(compatibleSummary(summary, await runner.describeRun(engine, [{ ...scenarios[0], setup: () => {
      const result = scenarios[0].setup();
      result.state!.hands[result.seat][0] = makeCard('S', 'A');
      return result;
    } }], options))).toBe(false);
    expect(await contentHash({ a: 1, b: 2 })).toBe(await contentHash({ b: 2, a: 1 }));
  });

  it('实际执行、哈希和日志共用一次构造的冻结输入', async () => {
    let calls = 0;
    const base = ALL_BENCHMARK_SCENARIOS[0];
    const scenario = { ...base, setup: () => {
      calls++;
      return base.setup();
    } };
    const engine = new BridgeEngine({ config: { mode: 'fast', maxWorlds: 0, minWorlds: 0, timeLimitMs: 0, endgameCardLimit: 0 } });
    const summary = await new BenchmarkRunner().runSuite(engine, [scenario]);
    expect(calls).toBe(1);
    expect(summary.scenarioResults[0].inputObservation!.phase).toBe('bidding');
  });

  it('日志记录实际可见观察、合法叫分和消融设置，同时排除密钥及暗牌', async () => {
    const engine = new LlmEngine({ apiKey: 'DO_NOT_SAVE', disableBidAdvice: true, maxConcurrency: 1,
      fetchFn: async () => new Response(JSON.stringify({ choices: [{ message: { content: '{"bid":null}' } }] }), { headers: { 'Content-Type': 'application/json' } }),
    });
    expect(evaluationConfig(engine).disableBidAdvice).toBe(true);
    engine.updateOptions({ disableBidAdvice: false });
    expect(evaluationConfig(engine).disableBidAdvice).toBe(false);
    const runner = new BenchmarkRunner();
    const summary = await runner.runSuite(engine, ALL_BENCHMARK_SCENARIOS.slice(0, 1));
    const input = summary.scenarioResults[0].inputObservation!;
    expect(input.legalBids).toBeDefined();
    expect(input.bidHistory).toBeDefined();
    expect(input.hands).toBeUndefined();
    expect(summary.engineConfigSnapshot.maxConcurrency).toBe(1);
    expect(runner.generateReportFiles(summary).summaryJson).not.toContain('DO_NOT_SAVE');
    const playing = await runner.runSuite(new BridgeEngine({ config: { mode: 'fast', maxWorlds: 0, minWorlds: 0, timeLimitMs: 0, endgameCardLimit: 0 } }),
      [PLAYING_SCENARIOS.find(s => s.id === 'play-feed-partner-void')!]);
    expect(playing.scenarioResults[0].inputObservation!.completedRounds).toHaveLength(2);
    expect(playing.scenarioResults[0].inputObservation!.voidSuits).toEqual([[], [], [], ['C']]);
    expect((playing.scenarioResults[0].inputObservation!.ownHand as ReturnType<typeof makeCard>[]).map(cardId)).toContain('KD');
  });
});
