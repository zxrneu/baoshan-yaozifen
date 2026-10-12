/**
 * 引擎同种子交换双方对战评测脚本 (scripts/match-battle.ts)
 * 采用复式桥牌 (Duplicate Bridge) 协议：
 * 每副牌使用相同随机种子发牌，双方互换座次各打一次（Game 1: A方南北/B方东西; Game 2: B方南北/A方东西），
 * 控制起始发牌差异，以实际赢副为主指标；有限样本仍存在统计不确定性。
 */
import fs from 'node:fs';
import path from 'node:path';
import { DecisionEngine } from '../src/ai/engines/engineTypes';
import { scoreDuplicateBoard, pairedWinRateInterval } from '../src/ai/eval/duplicateBattle';
import { evaluationConfig } from '../src/ai/eval/fingerprint';
import { evaluationSourceHash, archiveCurrentReports } from './eval-artifacts';
import { BridgeEngine } from '../src/ai/bridge/bridgeEngine';
import { AlgorithmEngine } from '../src/ai/engines/algorithmEngine';
import { LayaEngine } from '../src/ai/engines/layaEngine';
import { createOptimizedSelector } from '../src/ai/optimized';
import { AsyncCardSelector } from '../src/ai/optimized/contracts';
import { observeBidding, observeTrump, observeBury } from '../src/ai/decisionObservation';
import { observePlayer } from '../src/ai/optimized/observation';
import { createGame, currentSeat, bid, declareTrump, bury, playCard, legalMoves, sideOf } from '../src/engine';

// 简单轻量加载 .env
function loadEnv() {
  const envPath = path.resolve(process.cwd(), '.env');
  if (fs.existsSync(envPath)) {
    const content = fs.readFileSync(envPath, 'utf-8');
    for (const line of content.split('\n')) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;
      const eqIdx = trimmed.indexOf('=');
      if (eqIdx > 0) {
        const key = trimmed.slice(0, eqIdx).trim();
        const val = trimmed.slice(eqIdx + 1).trim();
        if (!process.env[key]) process.env[key] = val;
      }
    }
  }
}
loadEnv();

function createEngine(id: string): { name: string; engine: DecisionEngine } {
  switch (id) {
    case 'bridge-fast':
      return {
        name: 'Bridge (Fast)',
        engine: new BridgeEngine({
          config: { mode: 'fast', maxWorlds: 0, minWorlds: 0, timeLimitMs: 0, endgameCardLimit: 0 },
        }),
      };
    case 'bridge-deep':
      return {
        name: 'Bridge (Deep PIMC)',
        engine: new BridgeEngine({
          config: { mode: 'deep', maxWorlds: 32, minWorlds: 16, timeLimitMs: 250, endgameCardLimit: 6 },
        }),
      };
    case 'algorithm-optimized':
      return {
        name: 'Algorithm (Optimized)',
        engine: new AlgorithmEngine({
          choose: async (obs) => {
            const syncSelector = createOptimizedSelector({ budget: { timeLimitMs: 250, minWorlds: 8, maxWorlds: 64 } });
            return syncSelector.choose(obs);
          },
        } as AsyncCardSelector),
      };
    case 'laya':
      return {
        name: 'Laya (Ollaya/Fallback)',
        engine: new LayaEngine({
          baseUrl: process.env.LAYA_BASE_URL ?? 'http://127.0.0.1:11435',
          model: process.env.LAYA_MODEL ?? 'laya:multilingual',
          timeoutMs: 2500,
          enableFallbackOnFailure: true,
        }),
      };
    default:
      throw new Error(`未知引擎标识: ${id}`);
  }
}

interface GameOutcome {
  seed: number;
  winnerSide: number; // 0: 东/西, 1: 南/北
  declarerSeat: number;
  declarerSide: number;
  contractBid: number;
  contractSuccess: boolean;
  declarerPoints: number;
  defenderPoints: number;
  team0Points: number; // 东西方总得分
  team1Points: number; // 南北方总得分
  movesCount: number;
  durationMs: number;
  earlyFinish: boolean;
  unplayedPoints: number;
  redealCount: number;
  forcedContract: boolean;
  decisions: Array<Record<string, unknown>>;
}

/**
 * 运行单副完整对局 (Bidding -> Trump -> Bury -> Playing)
 */
async function playSingleGame(
  seed: number,
  team0Engine: DecisionEngine, // Seats 0 (东), 2 (西)
  team1Engine: DecisionEngine, // Seats 1 (南), 3 (北)
): Promise<GameOutcome> {
  const t0 = performance.now();
  let state = createGame(seed);
  let redealCount = 0;
  let movesCount = 0;
  let forcedContract = false;
  const decisions: Array<Record<string, unknown>> = [];
  const record = (observation: unknown, result: unknown) => decisions.push({
    step: movesCount, phase: state.phase, observation, result });

  while (state.phase !== 'handEnd' && state.phase !== 'matchEnd') {
    movesCount++;
    const seat = currentSeat(state);
    const engine = (seat === 0 || seat === 2) ? team0Engine : team1Engine;

    switch (state.phase) {
      case 'bidding': {
        const obs = observeBidding(state, seat);
        const res = engine.chooseBid ? await engine.chooseBid(obs) : await engine.chooseAction?.(obs);
        record(obs, res);
        const action: any = res?.action;
        const bidAmount = action?.kind === 'bid' ? action.bid : (action?.bid ?? null);
        state = bid(state, seat, bidAmount);
        if (state.phase === 'bidding' && state.bidding.length === 0) {
          redealCount++;
          if (redealCount > 3) {
            forcedContract = true;
            decisions.push({ step: movesCount, intervention: 'forced-contract', bid: 70 });
            // 超过三次均不叫，强制当前庄家叫 70 分开启战局
            state = bid(state, (state.dealer + 1) % 4, 70);
            state = bid(state, (state.dealer + 2) % 4, null);
            state = bid(state, (state.dealer + 3) % 4, null);
            state = bid(state, state.dealer, null);
          }
        }
        break;
      }
      case 'trump': {
        const obs = observeTrump(state, seat);
        const res = engine.chooseTrump ? await engine.chooseTrump(obs) : await engine.chooseAction?.(obs);
        record(obs, res);
        const action: any = res?.action;
        const trumpSuit = action?.kind === 'trump' ? action.trump : (action?.suit ?? 'H');
        state = declareTrump(state, seat, trumpSuit);
        break;
      }
      case 'bury': {
        const obs = observeBury(state, seat);
        const res = engine.chooseBury ? await engine.chooseBury(obs) : await engine.chooseAction?.(obs);
        record(obs, res);
        const action: any = res?.action;
        const buryCards = action?.kind === 'bury' ? action.cards : (action?.cards ?? state.hands[seat].slice(0, 4));
        state = bury(state, seat, buryCards);
        break;
      }
      case 'playing': {
        const legal = legalMoves(state, seat);
        const obs = observePlayer(state, seat);
        const res = await engine.chooseCard(obs, legal);
        record(obs, res);
        state = playCard(state, seat, res.card);
        break;
      }
      default:
        throw new Error(`未知阶段: ${state.phase}`);
    }
  }

  const durationMs = Math.round(performance.now() - t0);
  const result = state.result!;
  const declarerSide = sideOf(state.declarer!);
  const team0Points = declarerSide === 0
    ? result.declarerPoints
    : result.defenderPoints;
  const team1Points = declarerSide === 1
    ? result.declarerPoints
    : result.defenderPoints;

  return {
    seed,
    winnerSide: result.winnerSide,
    declarerSeat: state.declarer!,
    declarerSide,
    contractBid: state.highestBid,
    contractSuccess: result.success,
    declarerPoints: result.declarerPoints,
    defenderPoints: result.defenderPoints,
    team0Points,
    team1Points,
    movesCount,
    durationMs,
    earlyFinish: result.earlyFinish ?? false,
    unplayedPoints: result.unplayedPoints ?? 0,
    redealCount, forcedContract, decisions,
  };
}

interface BoardDuplicateResult {
  boardIndex: number;
  seed: number;
  game1: GameOutcome; // A为东西(0/2), B为南北(1/3)
  game2: GameOutcome; // B为东西(0/2), A为南北(1/3)
  engineAScore: number; // A总得分 (Game1的team0 + Game2的team1)
  engineBScore: number; // B总得分 (Game1的team1 + Game2的team0)
  netScoreA: number;    // A净胜分 (engineAScore - engineBScore)
  winner: 'A' | 'B' | 'TIE';
  engineAWins: number;
  engineBWins: number;
  excluded: boolean;
}

async function main() {
  const args = process.argv.slice(2);
  function getArg(name: string, fallback: string): string {
    const idx = args.indexOf('--' + name);
    return idx >= 0 && args[idx + 1] ? args[idx + 1] : fallback;
  }

  const engineAId = getArg('engine-a', 'bridge-deep');
  const engineBId = getArg('engine-b', 'bridge-fast');
  const boardCount = Number(getArg('boards', '10'));
  const startSeed = Number(getArg('seed', '20261001'));
  if (!Number.isInteger(boardCount) || boardCount < 1 || !Number.isInteger(startSeed)) throw new Error('boards 必须为正整数，seed 必须为整数');
  const runId = `duplicate-${Date.now()}-${engineAId}-vs-${engineBId}`;
  const codeHash = await evaluationSourceHash();

  const entryA = createEngine(engineAId);
  const entryB = createEngine(engineBId);

  console.log(`\n=============================================================`);
  console.log(`  保山幺子分 · 跨引擎复式对战 (Duplicate Pair Battle)`);
  console.log(`=============================================================`);
  console.log(`- 战队 A (Team A): ${entryA.name}`);
  console.log(`- 战队 B (Team B): ${entryB.name}`);
  console.log(`- 对战板数: ${boardCount} 盘 (每盘同种子交换座次互打 2 局，共 ${boardCount * 2} 局)`);
  console.log(`- 起始种子: ${startSeed}`);
  console.log(`-------------------------------------------------------------\n`);

  const boardResults: BoardDuplicateResult[] = [];
  let aWins = 0;
  let bWins = 0;
  let ties = 0;
  let totalNetA = 0;

  for (let b = 0; b < boardCount; b++) {
    const seed = startSeed + b * 137;
    const tb0 = performance.now();

    // Game 1: A 方为 Team 0 (东/西)，B 方为 Team 1 (南/北)
    const game1 = await playSingleGame(seed, entryA.engine, entryB.engine);

    // Game 2: B 方为 Team 0 (东/西)，A 方为 Team 1 (南/北) (同种子交换座位)
    const game2 = await playSingleGame(seed, entryB.engine, entryA.engine);

    const { engineAScore, engineBScore, netScoreA, engineAWins, engineBWins, winner } = scoreDuplicateBoard(game1, game2);
    const excluded = game1.forcedContract || game2.forcedContract;
    if (!excluded) {
      if (winner === 'A') aWins++;
      else if (winner === 'B') bWins++;
      else ties++;
      totalNetA += netScoreA;
    }
    const boardElapsed = Math.round(performance.now() - tb0);

    console.log(`完成 (${boardElapsed}ms) | 得分: ${entryA.name} ${engineAScore} vs ${engineBScore} ${entryB.name} | 辅助吃分差: ${netScoreA > 0 ? '+' : ''}${netScoreA} [${winner === 'A' ? 'A胜' : winner === 'B' ? 'B胜' : '平'}]`);

    boardResults.push({
      boardIndex: b + 1,
      seed,
      game1,
      game2,
      engineAScore,
      engineBScore,
      netScoreA,
      winner, engineAWins, engineBWins, excluded,
    });
  }

  const validBoards = boardResults.filter(b => !b.excluded);
  const pairedInterval = pairedWinRateInterval(validBoards);
  const totalAWins = validBoards.reduce((sum, b) => sum + b.engineAWins, 0);
  const totalBWins = validBoards.reduce((sum, b) => sum + b.engineBWins, 0);
  const pct = (n: number, denominator: number) => denominator ? ((n / denominator) * 100).toFixed(1) + '%' : 'N/A';
  // 汇总报告生成
  console.log(`\n=============================================================`);
  console.log(`  复式对战最终战报汇总 (Duplicate Battle Summary)`);
  console.log(`=============================================================`);
  console.log(`- 对战板数: ${boardCount} 盘`);
  console.log(`- 战绩胜负: [${entryA.name}] ${aWins} 胜 - ${ties} 平 - ${bWins} 负 [${entryB.name}]`);
  console.log(`- 胜率统计: [${entryA.name}] 胜率 ${((aWins / Math.max(1, validBoards.length)) * 100).toFixed(1)}% | [${entryB.name}] 胜率 ${((bWins / Math.max(1, validBoards.length)) * 100).toFixed(1)}%`);
  console.log(`- 总净胜分: [${entryA.name}] 相对 [${entryB.name}] 辅助吃分差 ${totalNetA > 0 ? '+' : ''}${totalNetA} 分 (平均每板 ${((totalNetA / Math.max(1, validBoards.length))).toFixed(1)} 分)`);
  console.log(`=============================================================\n`);

  // 保存 Markdown 产物
  const reportLines: string[] = [
    `# 保山幺子分 · 跨引擎复式实战对战报告 (Duplicate Head-to-Head)`,
    ``,
    `- **对战时间**: \`${new Date().toISOString()}\``,
    `- **对战双方**: \`${entryA.name}\` vs \`${entryB.name}\``,
    `- **对战机制**: 相同起始种子、交换南北/东西各战 1 局；主指标为实际赢副数，吃分为辅助指标`,
    `- **总盘数**: ${boardCount} 板 (${boardCount * 2} 局实战)`,
    ``,
    `- **运行 ID**: \`${runId}\`；源码哈希: \`${codeHash}\``,
    `- **有效发牌组**: ${validBoards.length}；强制叫分干预排除 ${boardCount - validBoards.length} 组`,
    `- **A − B 赢副率差**: ${(pairedInterval.difference * 100).toFixed(1)} 个百分点；95% 保守区间 [${(pairedInterval.lower * 100).toFixed(1)}, ${(pairedInterval.upper * 100).toFixed(1)}]（以发牌组为独立样本）`,
    `- 区间假设独立发牌组，不能把同组两局当作独立样本；少量样本和区间包含 0 时不裁定哪个引擎更强。`,
    ``,
    `## 1. 终局战绩汇总`,
    ``,
    `| 指标 | ${entryA.name} | ${entryB.name} | 差值 / 判定 |`,
    `| --- | :---: | :---: | :---: |`,
    `| **实际赢副数** | **${totalAWins}** | **${totalBWins}** | 赢副率 ${pct(totalAWins, validBoards.length * 2)} / ${pct(totalBWins, validBoards.length * 2)} |`,
    `| **胜场板数** | **${aWins}** | ${bWins} | ${aWins > bWins ? entryA.name + ' 领先' : '持平或落后'} |`,
    `| **板胜率** | **${((aWins / Math.max(1, validBoards.length)) * 100).toFixed(1)}%** | ${((bWins / Math.max(1, validBoards.length)) * 100).toFixed(1)}% | 平局: ${ties} 盘 |`,
    `| **累计实战得分** | ${validBoards.reduce((a, b) => a + b.engineAScore, 0)} 分 | ${validBoards.reduce((a, b) => a + b.engineBScore, 0)} 分 | 净胜 **${totalNetA > 0 ? '+' : ''}${totalNetA}** 分 |`,
    `| **平均每板净胜** | **${(totalNetA / Math.max(1, validBoards.length)).toFixed(1)}** 分 | ${(-totalNetA / Math.max(1, validBoards.length)).toFixed(1)} 分 | - |`,
    ``,
    `## 2. 各板逐盘详细得失明细`,
    ``,
    `| 板号 | 发牌种子 | Game 1 (A东西/B南北) | Game 2 (B东西/A南北) | A吃分 | B吃分 | A/B赢副 | 判定 |`,
    `| :---: | :---: | :---: | :---: | :---: | :---: | :---: | :---: |`,
  ];

  for (const r of boardResults) {
    const g1Desc = `庄家座位${r.game1.declarerSeat}叫${r.game1.contractBid}分 (${r.game1.team0Points}:${r.game1.team1Points})；${r.game1.winnerSide === 0 ? 'A' : 'B'}胜；未打分${r.game1.unplayedPoints}`;
    const g2Desc = `庄家座位${r.game2.declarerSeat}叫${r.game2.contractBid}分 (${r.game2.team0Points}:${r.game2.team1Points})；${r.game2.winnerSide === 1 ? 'A' : 'B'}胜；未打分${r.game2.unplayedPoints}`;
    reportLines.push(`| 第 ${r.boardIndex} 板 | \`${r.seed}\` | ${g1Desc} | ${g2Desc} | **${r.engineAScore}** | **${r.engineBScore}** | **${r.engineAWins}/${r.engineBWins}** | ${r.excluded ? '干预排除' : r.winner === 'A' ? '🏆 A胜' : r.winner === 'B' ? '🏆 B胜' : '平局'} |`);
  }

  const outDir = path.resolve(process.cwd(), 'experiments/results/engine-model-eval');
  await fs.promises.mkdir(outDir, { recursive: true });
  const outPath = path.join(outDir, `duplicate-battle-${engineAId}-vs-${engineBId}.md`);
  await archiveCurrentReports(outDir, [`duplicate-battle-${engineAId}-vs-${engineBId}.md`]);
  await fs.promises.writeFile(outPath, reportLines.join('\n'), 'utf-8');
  const runDir = path.join(outDir, runId);
  await fs.promises.mkdir(runDir, { recursive: true });
  const manifest = { runId, timestamp: new Date().toISOString(), codeHash, startSeed, boardCount,
    engineA: { id: engineAId, config: evaluationConfig(entryA.engine) },
    engineB: { id: engineBId, config: evaluationConfig(entryB.engine) },
    validGroups: validBoards.length, totalAWins, totalBWins, pairedInterval };
  await fs.promises.writeFile(path.join(runDir, 'manifest.json'), JSON.stringify(manifest, null, 2), 'utf-8');
  await fs.promises.writeFile(path.join(runDir, 'boards.ndjson'), boardResults.map(b => JSON.stringify(b)).join('\n'), 'utf-8');
  await fs.promises.writeFile(path.join(runDir, 'report.md'), reportLines.join('\n'), 'utf-8');
  console.log(`实际赢副 A/B: ${totalAWins}/${totalBWins}；发牌组区间 ${JSON.stringify(pairedInterval)}`);
  console.log(`📁 实战战报: ${outPath}；可重放记录: ${runDir}\n`);
}

main().catch((err) => {
  console.error(`❌ 对战发生异常:`, err);
  process.exit(1);
});
