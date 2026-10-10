/**
 * 固定叫分、定主、扣底的实际对打。每个发牌种子交换双方，按种子组统计区间。
 * 单独运行：OPTIMIZED_EVAL_GROUPS=2000 pnpm vitest run -c experiments/vitest.config.ts experiments/optimized.test.ts
 */
import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { setImmediate } from 'node:timers/promises';
import { describe, expect, it } from 'vitest';
import { Card } from '../src/cards';
import { bid, bury, createGame, currentSeat, declareTrump, GameState, playCard, sideOf } from '../src/engine';
import { fastChooseCard, FAST_BUDGET, smartBury, smartPlay, smartTrump } from '../src/ai';
import { createOptimizedSelector, observePlayer, observationPolicy, seededSearchRandom } from '../src/ai/optimized';

type Play = (state: GameState, seat: number) => Card;
const groups = Number(process.env.OPTIMIZED_EVAL_GROUPS ?? 256);
const worlds = Number(process.env.OPTIMIZED_EVAL_WORLDS ?? 32);
const seedStart = Number(process.env.OPTIMIZED_EVAL_SEED_START ?? 50001);
const selectedBaseline = process.env.OPTIMIZED_EVAL_BASELINE ?? 'fast';

function setup(seed: number): GameState {
  let state = createGame(seed);
  const declarer = seed % 4;
  for (let i = 0; i < 4; i++) state = bid(state, currentSeat(state), currentSeat(state) === declarer ? 70 : null);
  state = declareTrump(state, declarer, smartTrump(state, declarer));
  return bury(state, declarer, smartBury(state, declarer));
}

function play(state: GameState, optimizedSide: number, optimized: Play, baseline: Play): number {
  let guard = 0;
  while (state.phase === 'playing') {
    if (++guard > 48) throw new Error('超出一副牌的动作数');
    const seat = currentSeat(state);
    state = playCard(state, seat, (sideOf(seat) === optimizedSide ? optimized : baseline)(state, seat));
  }
  expect(state.result!.declarerPoints + state.result!.defenderPoints).toBe(100);
  return Number(state.result!.winnerSide === optimizedSide);
}

describe('优化 AI 实际对打', () => {
  it('交换双方，按独立发牌组评估赢副率和出牌耗时', async () => {
    const timings: number[] = [];
    const statuses: Record<string, number> = {};
    const selector = createOptimizedSelector({
      budget: { minWorlds: Math.min(8, worlds), maxWorlds: worlds, timeLimitMs: Infinity },
      // 与发牌随机源无关；固定策略便于复现对比。
      dependencies: { random: () => seededSearchRandom(0x7163a42) },
    });
    const optimized: Play = (state, seat) => {
      const started = performance.now();
      const decision = selector.choose(observePlayer(state, seat));
      timings.push(performance.now() - started);
      statuses[decision.status] = (statuses[decision.status] ?? 0) + 1;
      return decision.card;
    };
    const baseline: Play = selectedBaseline === 'legacy-search'
      ? (state, seat) => smartPlay(state, seat, FAST_BUDGET)
      : selectedBaseline === 'observation-policy'
        ? (state, seat) => observationPolicy.chooseCard(observePlayer(state, seat)) : fastChooseCard;
    const groupRates: number[] = [];
    for (let i = 0; i < groups; i++) {
      const initial = setup(seedStart + i);
      groupRates.push((play(initial, 0, optimized, baseline) + play(initial, 1, optimized, baseline)) / 2);
      // 长时间实验让出事件循环，避免阻塞测试进程的心跳与结果上报。
      if (i % 8 === 7) await setImmediate();
    }
    const mean = groupRates.reduce((a, b) => a + b, 0) / groups;
    const variance = groupRates.reduce((a, x) => a + (x - mean) ** 2, 0) / Math.max(1, groups - 1);
    const radius = 1.96 * Math.sqrt(variance / groups);
    timings.sort((a, b) => a - b);
    const percentile = (p: number) => timings[Math.min(timings.length - 1, Math.floor(timings.length * p))];
    const result = {
      groups, games: groups * 2, seedStart, worlds, baseline: selectedBaseline,
      scoring: 'basic-v1', bid: 70, setup: 'smartTrump/smartBury, fixed before comparing play',
      information: selectedBaseline === 'legacy-search' ? 'legacy search knows hidden kitty; optimized does not' : 'both strategies use permitted information',
      winRate: mean, winRateCI95: [Math.max(0, mean - radius), Math.min(1, mean + radius)],
      intervalMethod: 'normal approximation over independent deal groups; two side swaps per group',
      timingsMs: { p50: percentile(0.5), p95: percentile(0.95), maximum: timings[timings.length - 1] },
      statuses,
    };
    console.log(JSON.stringify(result, null, 2));
    writeFileSync(fileURLToPath(new URL(`./results/optimized_vs_${selectedBaseline}.json`, import.meta.url)), JSON.stringify(result, null, 2) + '\n');
    expect(groupRates).toHaveLength(groups);
    expect(statuses.inconsistent ?? 0).toBe(0);
  }, 1_800_000);
});
