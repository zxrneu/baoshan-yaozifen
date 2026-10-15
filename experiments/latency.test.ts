/** AI 内核延迟基准；不包含 Worker 启动、消息传输及牌桌显示等待。 */
import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { setImmediate } from 'node:timers/promises';
import { expect, it } from 'vitest';
import { cardId } from '@yaozifen/game-core/cards';
import { bid, bury, createGame, currentSeat, declareTrump, playCard } from '@yaozifen/game-core';
import { smartBury, smartTrump } from '@yaozifen/ai-core/smart';
import {
  BasicWorldEvaluator, BeliefEndgameSolver, constrainedWorldFactory,
  createOptimizedSelector, DEFAULT_OPTIMIZED_BUDGET, FAST_OPTIMIZED_BUDGET,
  legalObservationCards, observationPolicy, observePlayer, seededSearchRandom,
} from '@yaozifen/ai-core/optimized/index';
import type {
  ObservationPolicy, OptimizedBudget, PlayerObservation, SearchDecision,
} from '@yaozifen/ai-core/optimized/index';

const groups = Number(process.env.AI_LATENCY_GROUPS ?? 8);
const seedStart = Number(process.env.AI_LATENCY_SEED_START ?? 61001);
const round = (value: number): number => Number(value.toFixed(3));

function corpus(): PlayerObservation[] {
  const observations: PlayerObservation[] = [];
  for (let i = 0; i < groups; i++) {
    let state = createGame(seedStart + i);
    const declarer = (seedStart + i) % 4;
    for (let n = 0; n < 4; n++) {
      const actor = currentSeat(state);
      state = bid(state, actor, actor === declarer ? 70 : null);
    }
    state = declareTrump(state, declarer, smartTrump(state, declarer));
    state = bury(state, declarer, smartBury(state, declarer));
    while (state.phase === 'playing') {
      const actor = currentSeat(state);
      const observation = observePlayer(state, actor);
      observations.push(observation);
      state = playCard(state, actor, observationPolicy.chooseCard(observation));
    }
  }
  return observations;
}

function distribution(values: readonly number[]) {
  const sorted = [...values].sort((a, b) => a - b);
  const percentile = (p: number) => round(sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * p))]);
  return {
    count: sorted.length,
    mean: round(sorted.reduce((sum, n) => sum + n, 0) / sorted.length),
    p50: percentile(0.5), p95: percentile(0.95), maximum: round(sorted[sorted.length - 1]),
  };
}

it('同一观察语料比较搜索预算，并分解内核热点', async () => {
  expect(Number.isInteger(groups) && groups > 0).toBe(true);
  const observations = corpus();
  // 预热 JIT；预热数据不进入计时结果。
  const warmup = createOptimizedSelector({
    budget: FAST_OPTIMIZED_BUDGET,
    dependencies: { random: () => seededSearchRandom(0x167ac23) },
  });
  for (const observation of observations.slice(0, 24)) warmup.choose(observation);
  const configurations: [string, OptimizedBudget][] = [
    ['default', DEFAULT_OPTIMIZED_BUDGET],
    ['existing-fast', FAST_OPTIMIZED_BUDGET],
    ['proposed-interactive', {
      ...FAST_OPTIMIZED_BUDGET, minWorlds: 8, maxWorlds: 64, timeLimitMs: 80,
    }],
  ];
  const timings = configurations.map(() => [] as number[]);
  const searchingTimings = configurations.map(() => [] as number[]);
  const statuses = configurations.map(() => ({} as Record<string, number>));
  const completedWorlds = configurations.map(() => [] as number[]);
  const fallbackEarlyRounds = configurations.map(() => 0);
  const cards = configurations.map(() => [] as string[]);
  const selectors = configurations.map(([, budget]) => createOptimizedSelector({
    budget, dependencies: { random: () => seededSearchRandom(0x167ac23) },
  }));
  for (let i = 0; i < observations.length; i++) {
    const observation = observations[i];
    // 交错并轮换执行顺序，降低进程负载及热身顺序的影响。
    for (let offset = 0; offset < selectors.length; offset++) {
      const index = (i + offset) % selectors.length;
      const started = performance.now();
      const decision = selectors[index].choose(observation);
      const elapsed = performance.now() - started;
      timings[index].push(elapsed);
      cards[index].push(cardId(decision.card));
      statuses[index][decision.status] = (statuses[index][decision.status] ?? 0) + 1;
      if (decision.status !== 'only-move' && decision.status !== 'locked') {
        searchingTimings[index].push(elapsed);
        completedWorlds[index].push(decision.worlds);
      }
      if (decision.status === 'fallback' && observation.roundNumber <= 4) fallbackEarlyRounds[index]++;
      expect(legalObservationCards(observation).map(cardId)).toContain(cardId(decision.card));
      expect(decision.status).not.toBe('inconsistent');
    }
    if (i % 24 === 23) await setImmediate();
  }

  // 单独的插桩轮次，避免把 profiler 开销混入上面的延迟基准。
  const profile: Record<string, number> = {
    totalMs: 0, beliefBuildMs: 0, samplingMs: 0, rolloutMs: 0, endgameMs: 0,
    policyMs: 0, policyCalls: 0, evaluatedCandidates: 0, sampledWorlds: 0,
  };
  function measure<T>(key: string, run: () => T): T {
    const started = performance.now();
    try { return run(); } finally { profile[key] += performance.now() - started; }
  }
  const policy: ObservationPolicy = {
    chooseCard(observation) {
      profile.policyCalls++;
      return measure('policyMs', () => observationPolicy.chooseCard(observation));
    },
  };
  const evaluator = new BasicWorldEvaluator(policy);
  const endgame = new BeliefEndgameSolver(policy, 256, 12, 5000);
  const profiled = createOptimizedSelector({
    policy,
    dependencies: {
      random: () => seededSearchRandom(0x167ac23),
      worlds: {
        create(observation, guard) {
          const source = measure('beliefBuildMs', () => constrainedWorldFactory.create(observation, guard));
          return {
            ...source,
            sample(random, samplingGuard) {
              profile.sampledWorlds++;
              return measure('samplingMs', () => source.sample(random, samplingGuard));
            },
          };
        },
      },
      evaluator: {
        evaluate(observation, world, card, guard) {
          profile.evaluatedCandidates++;
          return measure('rolloutMs', () => evaluator.evaluate(observation, world, card, guard));
        },
      },
      endgame: {
        solve(observation, source, guard): SearchDecision | undefined {
          return measure('endgameMs', () => endgame.solve(observation, source, guard));
        },
      },
    },
  });
  for (const observation of observations.slice(0, 48)) {
    measure('totalMs', () => profiled.choose(observation));
  }
  const result = {
    generatedAt: new Date().toISOString(), runtime: process.version, platform: process.platform,
    arch: process.arch, groups, seedStart, observations: observations.length,
    corpusPolicy: 'observationPolicy, fixed bid 70, smartTrump/smartBury',
    scope: 'Node search kernel only; excludes Worker startup, transport and UI display delay',
    variants: configurations.map(([name, budget], i) => ({
      name, budget, timingsMs: distribution(timings[i]),
      searchingTimingsMs: distribution(searchingTimings[i]), statuses: statuses[i],
      completedWorlds: distribution(completedWorlds[i]), fallbackEarlyRounds: fallbackEarlyRounds[i],
      cardAgreementWithDefault: round(cards[i].filter((card, n) => card === cards[0][n]).length / cards[i].length),
    })),
    profile: Object.fromEntries(Object.entries(profile).map(([key, value]) => [key, round(value)])),
    profileNote: 'First deal only; rollout/endgame include policyMs, so policyMs must not be added again',
    qualityNote: 'Card agreement is diagnostic, not a win-rate or strength estimate',
  };
  writeFileSync(fileURLToPath(new URL('./results/ai_latency.json', import.meta.url)), JSON.stringify(result, null, 2) + '\n');
  console.log(JSON.stringify(result, null, 2));
}, 600_000);
