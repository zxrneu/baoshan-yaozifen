/** 搭档配合改动离线评测；复用统一裁判与复式计分，隔离策略变量并保存公开决策轨迹。 */
import fs from 'node:fs/promises';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { gzipSync } from 'node:zlib';
import assert from 'node:assert/strict';
import { Card, cardId, makeRng } from '@yaozifen/game-core/cards';
import { createGame, currentSeat, bid, declareTrump, bury, playCard, GameState, revealedPartnerSeat } from '@yaozifen/game-core';
import { observeBidding, observeTrump, observeBury } from '@yaozifen/game-view/decisionObservation';
import { observePlayer } from '@yaozifen/game-view/observation';
import { PlayerObservation } from '@yaozifen/ai-core/optimized/contracts';
import { aiPlay } from '@yaozifen/ai-core/heuristic';
import { searchBestCard, DEFAULT_BUDGET } from '@yaozifen/ai-core/search';
import { BridgeEngine } from '@yaozifen/ai-core/bridge/bridgeEngine';
import { BenchmarkRunner } from '@yaozifen/ai-eval/benchmarkRunner';
import { ALL_BENCHMARK_SCENARIOS } from '@yaozifen/ai-eval/scenarios';
import { ALL_HOLDOUT_SCENARIOS } from '@yaozifen/ai-eval/holdoutScenarios';
import { scoreDuplicateBoard, pairedWinRateInterval } from '@yaozifen/ai-core/statistics/duplicateBattle';
import { contentHash } from '@yaozifen/ai-eval/fingerprint';
import { evaluationSourceHash, saveEvaluationRun } from '../../scripts/eval-artifacts';

const args = process.argv.slice(2);
const arg = (name: string, fallback: string) => {
  const i = args.indexOf(`--${name}`);
  return i < 0 ? fallback : args[i + 1];
};
const baselineRef = arg('baseline-ref', '95e7fae');
const heuristicBoards = Number(arg('heuristic-boards', '512'));
const searchBoards = Number(arg('search-boards', '64'));
const searchBudget = { ...DEFAULT_BUDGET, worldsPerMove: Number(arg('worlds', '24')) };
const out = path.resolve(arg('output', `experiments/partner-cooperation-20261015/run-${Date.now()}`));
assert(Number.isInteger(heuristicBoards) && heuristicBoards > 0);
assert(Number.isInteger(searchBoards) && searchBoards > 0);
assert(Number.isInteger(searchBudget.worldsPerMove) && searchBudget.worldsPerMove > 0);
const root = process.cwd();
await fs.mkdir(path.join(root, '.tmp'), { recursive: true });
const temp = await fs.mkdtemp(path.join(root, '.tmp/partner-eval-'));
await fs.mkdir(out, { recursive: true });

// 仅替换两个目标模块；导入路径重定位到当前依赖，保留规则函数身份和同一裁判。
const baselineSources: Record<string, string> = {};
for (const name of ['heuristic', 'search']) {
  const relative = `src/ai/${name}.ts`;
  const original = execFileSync('git', ['show', `${baselineRef}:${relative}`], { encoding: 'utf8' });
  baselineSources[relative] = original;
  const relocated = original.replace(/from (['"])(\.[^'"]+)\1/g,
    (_match, _quote, specifier: string) => `from ${JSON.stringify(path.resolve(root, 'src/ai', specifier))}`);
  await fs.writeFile(path.join(temp, `${name}.ts`), relocated);
}
const bridgeSource = execFileSync('git', ['show', `${baselineRef}:src/ai/bridge/bridgeEngine.ts`], { encoding: 'utf8' });
await fs.writeFile(path.join(temp, 'bridgeEngine.ts'), bridgeSource.replace(/from (['"])(\.[^'"]+)\1/g,
  (_match, _quote, specifier: string) => `from ${JSON.stringify(path.resolve(root, 'src/ai/bridge', specifier))}`));
const oldBridge: typeof import('@yaozifen/ai-core/bridge/bridgeEngine') = await import(path.join(temp, 'bridgeEngine.ts'));
const oldHeuristic: typeof import('@yaozifen/ai-core/heuristic') = await import(path.join(temp, 'heuristic.ts'));
const oldSearch: typeof import('@yaozifen/ai-core/search') = await import(path.join(temp, 'search.ts'));
const sourceHash = await evaluationSourceHash();
const candidateSources = Object.fromEntries(await Promise.all(Object.keys(baselineSources)
  .map(async name => [name, await fs.readFile(name, 'utf8')])));
const control = new BridgeEngine({ config: { mode: 'fast', maxWorlds: 0, minWorlds: 0, timeLimitMs: 0, endgameCardLimit: 0 } });
const baselineControl = new oldBridge.BridgeEngine({ config: { mode: 'fast', maxWorlds: 0, minWorlds: 0, timeLimitMs: 0, endgameCardLimit: 0 } });
const trace: unknown[] = [];

/** 旧接口虽接受状态，实验仍禁止访问别家暗牌、未知底牌、发牌 seed。 */
function guardedState(state: GameState, seat: number): GameState {
  const revealed = revealedPartnerSeat(state);
  const hiddenCards = (cards: Card[]) => new Proxy(cards, {
    get(target, key) { if (key === 'length') return target.length; throw new Error(`读取隐藏牌字段 ${String(key)}`); },
  });
  return Object.defineProperty({ ...state,
    hands: state.hands.map((hand, s) => s === seat || s === revealed ? hand : hiddenCards(hand)),
    kitty: seat === state.declarer ? state.kitty : hiddenCards(state.kitty),
  }, 'seed', { get() { throw new Error('读取发牌 seed'); } });
}

/** 对两版原有熵入口注入相同种子；每个候选使用同一随机世界序列，不改策略或采样器。 */
function fixedEntropy<T>(seed: number, choose: () => T): T {
  const descriptor = Object.getOwnPropertyDescriptor(globalThis.crypto, 'getRandomValues');
  Object.defineProperty(globalThis.crypto, 'getRandomValues', { configurable: true, value: (array: Uint32Array) => {
    assert(array instanceof Uint32Array && array.length === 1);
    array[0] = seed >>> 0;
    return array;
  } });
  try { return choose(); }
  finally {
    if (descriptor) Object.defineProperty(globalThis.crypto, 'getRandomValues', descriptor);
    else Reflect.deleteProperty(globalThis.crypto, 'getRandomValues');
  }
}

type Kind = 'heuristic' | 'search';
type Version = 'baseline' | 'candidate';
function choose(kind: Kind, version: Version, state: GameState, seat: number, entropy: number): Card {
  const safe = guardedState(state, seat);
  if (kind === 'heuristic') return (version === 'candidate' ? aiPlay : oldHeuristic.aiPlay)(safe, seat);
  return fixedEntropy(entropy, () => (version === 'candidate' ? searchBestCard : oldSearch.searchBestCard)(safe, seat, undefined, searchBudget));
}

async function game(kind: Kind, seed: number, candidateSide: number, index: number) {
  let state = createGame(seed);
  let moves = 0, redeals = 0;
  const latencies: Record<Version, number[]> = { baseline: [], candidate: [] };
  while (state.phase !== 'handEnd' && state.phase !== 'matchEnd') {
    assert(++moves < 300, '单副动作数超限');
    const seat = currentSeat(state);
    const beforePhase = state.phase;
    if (state.phase === 'bidding') {
      const obs = observeBidding(state, seat);
      const result = await control.chooseBid(obs);
      assert(result.action.kind === 'bid');
      state = bid(state, seat, result.action.bid);
      trace.push({ kind, index, seed, candidateSide, step: moves, observation: obs, action: result.action });
      if (state.phase === 'bidding' && state.bidding.length === 0) redeals++;
      assert(redeals <= 10, '超过重发预算，保留故障并中止，不强制叫分');
    } else if (state.phase === 'trump') {
      const obs = observeTrump(state, seat);
      const result = await control.chooseTrump(obs);
      assert(result.action.kind === 'trump');
      state = declareTrump(state, seat, result.action.trump);
      trace.push({ kind, index, seed, candidateSide, step: moves, observation: obs, action: result.action });
    } else if (state.phase === 'bury') {
      const obs = observeBury(state, seat);
      const result = await control.chooseBury(obs);
      assert(result.action.kind === 'bury');
      state = bury(state, seat, result.action.cards);
      trace.push({ kind, index, seed, candidateSide, step: moves, observation: obs, action: result.action });
    } else if (state.phase === 'playing') {
      const version: Version = seat % 2 === candidateSide ? 'candidate' : 'baseline';
      const obs: PlayerObservation = observePlayer(state, seat);
      // 搜索随机协议与发牌种子独立，只由预声明主种子、组号和公开动作序号确定。
      const entropy = (0x1bc52a71 + index * 104729 + moves * 8191) >>> 0;
      const started = performance.now();
      const card = choose(kind, version, state, seat, entropy);
      const latencyMs = performance.now() - started;
      latencies[version].push(latencyMs);
      state = playCard(state, seat, card); // 引擎校验所有实际动作；无非法动作回退。
      trace.push({ kind, index, seed, candidateSide, version, step: moves, entropy, observation: obs, cardId: cardId(card), latencyMs });
    } else throw new Error(`未知阶段 ${beforePhase}`);
  }
  assert(state.result);
  const result = state.result;
  const declarerSide = state.declarer! % 2;
  return { winnerSide: result.winnerSide, team0Points: declarerSide === 0 ? result.declarerPoints : result.defenderPoints,
    team1Points: declarerSide === 1 ? result.declarerPoints : result.defenderPoints,
    contract: state.highestBid, declarer: state.declarer, redeals, moves, latencies, result };
}

try {
  const runner = new BenchmarkRunner();
  const controls = [];
  for (const [dataset, scenarios] of [['dev', ALL_BENCHMARK_SCENARIOS], ['holdout', ALL_HOLDOUT_SCENARIOS]] as const) {
    const summary = await runner.runSuite(control, [...scenarios], {
      runId: `control-bridge-fast-${dataset}`, dataset, concurrency: 1, codeHash: sourceHash,
      engineConfig: { mode: 'fast', maxWorlds: 0, minWorlds: 0, timeLimitMs: 0, endgameCardLimit: 0 },
    });
    await saveEvaluationRun(runner, summary, out);
    const before = await runner.runSuite(baselineControl, [...scenarios], {
      runId: `baseline-control-bridge-fast-${dataset}`, dataset, concurrency: 1,
      codeHash: await contentHash({ bridgeSource, baselineSources }),
    });
    await saveEvaluationRun(runner, before, out);
    assert.deepEqual(summary.scenarioResults.map(row => [row.scenarioId, row.actionTaken, row.passed]),
      before.scenarioResults.map(row => [row.scenarioId, row.actionTaken, row.passed]), 'Bridge Fast 在固定题面上出现行为变化');
    controls.push({ dataset, passed: summary.passedCount, total: summary.totalScenarios,
      playing: summary.phaseSummaries.playing, legalRate: summary.legalRate, p95LatencyMs: summary.p95LatencyMs, dataHash: summary.dataHash });
    assert.equal(summary.legalRate, 1);
    console.log(`control ${dataset}: ${summary.passedCount}/${summary.totalScenarios}`);
  }
  const results = [];
  for (const [kind, count, master] of [['heuristic', heuristicBoards, 0x65ac7139], ['search', searchBoards, 0x347c81af]] as const) {
    const rng = makeRng(master);
    const boards: Array<{ index: number; seed: number; game1: Awaited<ReturnType<typeof game>>;
      game2: Awaited<ReturnType<typeof game>> } & ReturnType<typeof scoreDuplicateBoard>> = [];
    for (let index = 0; index < count; index++) {
      const seed = Math.floor(rng() * 0x100000000);
      const game1 = await game(kind, seed, 0, index);
      const game2 = await game(kind, seed, 1, index);
      boards.push({ index, seed, game1, game2, ...scoreDuplicateBoard(game1, game2) });
      if ((index + 1) % 8 === 0 || index + 1 === count) console.log(`${kind}: ${index + 1}/${count}`);
    }
    const interval = pairedWinRateInterval(boards);
    const aWins = boards.reduce((sum, b) => sum + b.engineAWins, 0);
    const bWins = boards.reduce((sum, b) => sum + b.engineBWins, 0);
    const latency = (version: Version) => {
      const sorted = boards.flatMap(b => [...b.game1.latencies[version], ...b.game2.latencies[version]]).sort((a, b) => a - b);
      return { decisions: sorted.length, p50: sorted[Math.floor(sorted.length * .5)], p95: sorted[Math.floor(sorted.length * .95)] };
    };
    const summary = { kind, count, candidateWins: aWins, baselineWins: bWins, candidateWinRate: aWins / (2 * count),
      interval, pointsDifference: boards.reduce((sum, b) => sum + b.netScoreA, 0),
      latency: { baseline: latency('baseline'), candidate: latency('candidate') } };
    results.push(summary);
    await fs.writeFile(path.join(out, `${kind}-boards.json`), JSON.stringify(boards, null, 2) + '\n');
    console.log(JSON.stringify(summary));
  }
  const manifest = { timestamp: new Date().toISOString(), baselineRef,
    changedModules: Object.keys(baselineSources), sourceHash,
    baselineModulesHash: await contentHash(baselineSources), candidateModulesHash: await contentHash(candidateSources),
    baselineSources, candidateSources,
    protocol: { heuristicBoards, searchBoards, searchBudget, heuristicDealMaster: 0x65ac7139,
      searchDealMaster: 0x347c81af, searchEntropyMaster: 0x1bc52a71, concurrency: 1, frontPhases: '相同 Bridge Fast 公开观察策略',
      interval: '既有 pairedWinRateInterval，按独立发牌组计算 Hoeffding 95% 区间',
      isolation: '两版共同依赖当前规则、采样器与裁判；旧源码仅重定位导入。Proxy 禁止暗牌、未知底牌和发牌 seed 读取。',
      modelRequests: 0, fallbackCount: 0, mockCount: 0, forcedContracts: 0 },
    controls, results };
  await fs.writeFile(path.join(out, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n');
  await fs.writeFile(path.join(out, 'decisions.ndjson.gz'), gzipSync(trace.map(row => JSON.stringify(row)).join('\n') + '\n'));
  await fs.writeFile(path.join(out, 'summary.json'), JSON.stringify({ controls, results }, null, 2) + '\n');
} catch (error) {
  await fs.writeFile(path.join(out, 'failure.json'), JSON.stringify({ error: String(error), trace }, null, 2));
  throw error;
} finally { await fs.rm(temp, { recursive: true, force: true }); }
