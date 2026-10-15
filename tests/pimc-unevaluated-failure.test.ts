/**
 * T0.4 复核回归测试：PIMC「未评估」必须与「评估出五五开」可区分，
 * 且跟牌局面的 DDS 搜索必须真实工作（防止按旧路线图实施 T0.4a 造成性能倒退）。
 *
 * 历史缺陷（本次复核发现）：
 * `pimc.ts` 的 `catch (e) {}` 覆盖整个采样循环，把 `worldsFactory.create()` /
 * `source.sample()` 抛出的 `InconsistentObservationError`（观察非法）与预算超时
 * 无差别吞掉，随后在零样本分支返回中性基线 winRate 0.5 / expectedPoints 50，
 * 并给出与正常结果同格式的 diagnostic。于是「输入非法导致完全没评估」与
 * 「评估了但五五开」在输出上不可区分，污染 bridgeEngine 的 searchWinRate /
 * confidence / candidateEvaluations 与决策日志。
 *
 * 修复后契约：
 * 1. 世界源头构造/采样失败 → `unevaluated: true` 显式标记 + diagnostic 标注原因，
 *    而非静默落到中性基线；
 * 2. 取消信号必须重抛，不得被 catch 吞掉（否则 bridgeEngine 的 signal.aborted
 *    分支永远不生效）；
 * 3. 预算耗尽/达界仍安全使用已有样本，**不得**被误标为 unevaluated；
 * 4. 跟牌局面（leader ≠ seat 且 currentRound 非空）DDS 必须真实求解
 *    （worldsEvaluated > 0 且候选 samples > 0）——固化 T0.4 复核结论。
 *
 * 【重要】旧路线图 T0.4 复现夹具本身不合法。
 * 其 `6C/JC/QC` 三候选夹具把跟牌时的手牌张数写成与 `currentRound` 不符的 `handCounts`，
 * 使 `constrainedWorldFactory.create()` 直接抛错，再被 `catch (e) {}` 吞掉，
 * 于是稳定产出 `samples=0、winRate=0.5、expPts=50`。也就是说：
 * 那个「跟牌退化」现象是**非法观察夹具 + 静默吞异常**的合成产物，而非 DDS 逻辑缺陷。
 * 用真实发牌（`observePlayer`）推进到跟牌局面时，DDS 正常求解（见下方第 4 组用例）。
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Card, cardValue, makeCard } from '@yaozifen/game-core/cards';
import { bid, bury, createGame, currentSeat, declareTrump, GameState, legalMoves, playCard } from '@yaozifen/game-core';
import { smartBury } from '@yaozifen/ai-core';
import { PlayerObservation } from '@yaozifen/ai-core/optimized/contracts';
import { observePlayer, legalObservationCards } from '@yaozifen/game-view/observation';
import { BridgePimcEvaluator } from '@yaozifen/ai-core/bridge/pimc';
import { BridgeEngine } from '@yaozifen/ai-core/bridge/bridgeEngine';
import { WorldSource, WorldSourceFactory } from '@yaozifen/ai-core/optimized/contracts';
import { constrainedWorldFactory } from '@yaozifen/ai-core/optimized/belief';
import { AlphaBetaDdsSolver, DdsResult, DoubleDummySolver } from '@yaozifen/ai-core/bridge/dds';
import { SUIT_INDEX } from '@yaozifen/ai-core/bridge/types';
import { EnginePlayerAgent } from '@yaozifen/ai-core/engines/engineAdapter';
import { DecisionLogger } from '@yaozifen/ai-core/engines/decisionLogger';
import { ThinkingService } from '@yaozifen/ai-core/engines/thinkingService';

/**
 * 构造**契约合法**的跟牌观察快照：seat 0 为第三家跟牌（leader 2，本轮已出 2 张）。
 *
 * 张数约定（由 `src/ai/optimized/simulator.ts:82-83` 确立，`belief.ts:31` 校验）：
 * 出牌时先从手牌移除再加入 `currentRound`，故
 *   ① `handCounts[seat] === ownHand.length`（`belief.ts:151`）；
 *   ② 可分配容量之和 = `handCounts[非本人座位] + kittySize` 必须等于
 *      `52 − ownHand.length − currentRound.length` 张未现牌。
 * 本局面：本方 12 张、本轮已出 2 张 → 未现 38 张；座位 2/3 各已出 1 张 → 各剩 11 张，
 * 座位 1 本轮未出 → 12 张，故 `handCounts = [12, 12, 11, 11]`（11+11+12+4 = 38 ✓）。
 *
 * 用错该约定（如把跟牌时手牌仍写成 12、或 `handCounts` 全填同一值）会让
 * `constrainedWorldFactory.create()` 抛 `InconsistentObservationError`，
 * 若再被 `catch (e) {}` 吞掉，就会稳定产出 `samples=0、winRate=0.5、expPts=50`
 * ——这正是旧路线图 T0.4「跟牌退化」现象的成因（非法夹具 + 静默吞异常），
 * 而非 DDS 逻辑缺陷。
 */
const PRE_ROUND_CARDS = [
  { seat: 2, card: makeCard('D', 'A') },
  { seat: 3, card: makeCard('D', 'J') },
] as const;

function makeObservation(hand: Card[]): PlayerObservation {
  return {
    seat: 0,
    ownHand: hand,
    handCounts: [hand.length, 12, 11, 11],
    declarer: 2,
    bid: 70,
    trump: 'D',
    leader: 2,
    roundNumber: 1,
    currentRound: [...PRE_ROUND_CARDS],
    completedRounds: [],
    voidSuits: [[], [], [], []],
    declarerPoints: 0,
    defenderPoints: 0,
    kittySize: 4,
    ruleId: 'basic-v1',
  };
}

/**
 * 12 张手牌，含 2 张方块（DA/DJ 已由座位 2/3 打出，故不得重复），
 * 跟随本轮首张花色（方块）时合法候选为这 2 张。
 */
const multiHand = [
  makeCard('D', '6'), makeCard('D', 'Q'),
  makeCard('C', '2'), makeCard('C', '3'), makeCard('C', '4'), makeCard('C', '5'),
  makeCard('C', '7'), makeCard('C', '8'), makeCard('C', '9'), makeCard('C', 'K'),
  makeCard('S', '2'), makeCard('S', '3'),
];

/** 跟牌时的合法候选：仅本方持有的该花色牌。 */
const multiCandidates = multiHand.filter((card) => card.suit === 'D');

/** 显式构造世界源头失败：`create` 即抛，模拟观察非法（如历史缺门矛盾）。 */
const failingWorldsFactory: WorldSourceFactory = {
  create() {
    throw new Error('历史缺门与剩余牌矛盾');
  },
};

/** 显式构造采样阶段失败：`create` 成功但 `sample` 抛出。 */
const failingSampleFactory: WorldSourceFactory = {
  create() {
    return {
      sample() {
        throw new Error('采样世界失败');
      },
    };
  },
};

/**
 * 功能测试按固定世界数结束，不依赖机器速度或进程调度。
 * 预算耗尽另用零预算和可控时钟覆盖，不能靠增加真实时间预算消除偶发失败。
 */
const testConfig = { mode: 'deep' as const, minWorlds: 1, maxWorlds: 2, timeLimitMs: Infinity, endgameCardLimit: 4 };

afterEach(() => vi.restoreAllMocks());

describe('T0.4 复核 · PIMC 未评估与取消语义', () => {
  it('世界源头构造失败：必须显式标记 unevaluated，而非静默落到中性基线', async () => {
    const evaluator = new BridgePimcEvaluator({
      worldsFactory: failingWorldsFactory,
      config: testConfig,
    });
    const decision = await evaluator.evaluate(makeObservation(multiHand), multiCandidates);

    expect(decision.worldsEvaluated).toBe(0);
    // 修复前：既无 unevaluated 也无原因，只有与正常结果同格式的诊断串。
    expect(decision.unevaluated).toBe(true);
    expect(decision.diagnostic).toContain('未评估');
    expect(decision.diagnostic).toContain('历史缺门与剩余牌矛盾');
  });

  it('采样阶段失败：同样必须显式标记 unevaluated', async () => {
    const evaluator = new BridgePimcEvaluator({
      worldsFactory: failingSampleFactory,
      config: testConfig,
    });
    const decision = await evaluator.evaluate(makeObservation(multiHand), multiCandidates);

    expect(decision.worldsEvaluated).toBe(0);
    expect(decision.unevaluated).toBe(true);
    expect(decision.diagnostic).toContain('采样世界失败');
  });

  it('已取消的信号必须重抛，不得被 catch 吞成中性基线', async () => {
    const evaluator = new BridgePimcEvaluator({ config: testConfig });
    const controller = new AbortController();
    controller.abort(new Error('用户取消'));

    await expect(
      evaluator.evaluate(makeObservation(multiHand), multiCandidates, controller.signal),
    ).rejects.toThrow('用户取消');
  });

  it('正常搜索在调度停顿后仍完成固定世界数，不误标为 unevaluated', async () => {
    // 模拟开始搜索后进程被暂停 10 秒，稳定复现真实时间预算造成的偶发零样本。
    vi.spyOn(performance, 'now').mockReturnValue(10_000).mockReturnValueOnce(0);
    const evaluator = new BridgePimcEvaluator({ config: testConfig });
    const decision = await evaluator.evaluate(makeObservation(multiHand), multiCandidates);

    expect(decision.unevaluated).toBeUndefined();
    expect(decision.worldsEvaluated).toBe(testConfig.maxWorlds);
    expect(decision.moves.every((move) => move.samples === testConfig.maxWorlds)).toBe(true);
    expect(decision.diagnostic).not.toContain('未评估');
  });

  it.each([
    ['暗牌采样', 0], ['DDS求解', 0],
    ['暗牌采样', 1], ['DDS求解', 1],
  ] as const)('%s 时预算到期：保留此前完成的 %i 个世界，排除中断世界', async (stage, completedWorlds) => {
    let now = 0;
    vi.spyOn(performance, 'now').mockImplementation(() => now);
    const config = { ...testConfig, timeLimitMs: 50 };
    const observation = makeObservation(multiHand);
    let sampled = 0;
    const sample = vi.fn<WorldSource['sample']>();
    const worldsFactory: WorldSourceFactory = {
      create(obs, guard) {
        const source = constrainedWorldFactory.create(obs, guard);
        sample.mockImplementation((random, samplingGuard) => {
          if (stage === '暗牌采样' && sampled === completedWorlds) now = config.timeLimitMs;
          sampled++;
          return source.sample(random, samplingGuard);
        });
        return { sample };
      },
    };
    let solved = 0;
    let completedResult: DdsResult | undefined;
    const solver = new AlphaBetaDdsSolver();
    const solve = vi.fn<DoubleDummySolver['solve']>((...args) => {
      if (stage === 'DDS求解' && solved === completedWorlds) now = config.timeLimitMs;
      solved++;
      const result = solver.solve(...args);
      completedResult = result;
      return result;
    });
    const evaluator = new BridgePimcEvaluator({ config, worldsFactory, ddsSolver: { solve } });
    const decision = await evaluator.evaluate(observation, multiCandidates);

    expect(sample).toHaveBeenCalledTimes(completedWorlds + 1);
    expect(solve).toHaveBeenCalledTimes(completedWorlds + Number(stage === 'DDS求解'));
    expect(decision.unevaluated).toBeUndefined();
    expect(decision.budgetExhausted).toBe(true);
    expect(decision.worldsEvaluated).toBe(completedWorlds);
    expect(decision.moves.every((move) => move.samples === completedWorlds)).toBe(true);
    expect(decision.diagnostic).not.toContain('未评估');
    if (completedWorlds === 0) {
      expect(decision.diagnostic).toContain('搜索预算不足');
      expect(decision.diagnostic).toContain('未完成任何世界评估');
      expect(decision.winRate).toBe(0.5);
      expect(decision.moves.every((move) => move.winRate === 0.5 && move.expectedPoints === 50)).toBe(true);
    } else {
      // 已完成的 DDS 结果必须保留，中断不能将其覆盖为中性基线或计为新样本。
      for (const move of decision.moves) {
        const score = completedResult?.moveScores?.find((entry) =>
          entry.suitIdx === SUIT_INDEX[move.card.suit] && entry.rankVal === cardValue(move.card));
        expect(score).toBeDefined();
        expect(move.expectedPoints).toBe(score!.score);
        expect(move.winRate).toBe(Number(score!.score >= observation.bid));
      }
    }
  });

  it('预算耗尽不得被标记为 unevaluated（预算类降级必须与非法观察区分）', async () => {
    // timeLimitMs: 0 使 deadlineGuard 立即可用尽：零世界成因是预算而非观察非法。
    const evaluator = new BridgePimcEvaluator({
      config: { ...testConfig, timeLimitMs: 0 },
    });
    const decision = await evaluator.evaluate(makeObservation(multiHand), multiCandidates);

    // 预算是合法降级，绝不能伪装成「观察非法」——否则「没算完」会与「真的五五开」不可区分。
    expect(decision.unevaluated).toBeUndefined();
    expect(decision.worldsEvaluated).toBe(0);
    expect(decision.diagnostic).toContain('预算');
    expect(decision.diagnostic).not.toContain('未评估');
    // 降级不伪装：仍须给出中性基线而非伪造胜率。
    expect(decision.winRate).toBe(0.5);
    expect(decision.moves.every((m) => m.winRate === 0.5 && m.expectedPoints === 50)).toBe(true);
  });

  it('引擎层：零样本预算降级说明原因，不输出搜索胜率或候选估值', async () => {
    const engine = new BridgeEngine({
      config: { ...testConfig, timeLimitMs: 0 },
    });
    const decision = await engine.chooseCard(makeObservation(multiHand), multiCandidates);

    expect(decision.fallbackReason).toContain('搜索预算不足');
    expect(decision.searchWinRate).toBeUndefined();
    expect(decision.confidence).toBeUndefined();
    expect(decision.worldsEvaluated).toBe(0);
    expect(decision.thinking).toContain('专家规则建议');
    expect(decision.conclusion).toContain('搜索预算不足');
    expect(decision.conclusion).not.toContain('胜率');
    expect(decision.thinking).not.toContain('50%');
    expect(decision.candidateEvaluations).toHaveLength(multiCandidates.length);
    for (const move of decision.candidateEvaluations ?? []) {
      expect(move.samples).toBe(0);
      expect(move.winRate).toBeUndefined();
      expect(move.expectedPoints).toBeUndefined();
    }
    expect(decision.diagnostic).not.toContain('未评估');
    expect(multiCandidates.some((c) => c.suit === decision.card.suit && c.rank === decision.card.rank)).toBe(true);
  });

  it.each([0.5, 1])('引擎层：预算耗尽前已有有效样本时保留真实胜率 %s', async (winRate) => {
    const evaluator = new BridgePimcEvaluator({ config: testConfig });
    vi.spyOn(evaluator, 'evaluate').mockResolvedValue({
      card: multiCandidates[0], winRate,
      moves: multiCandidates.map(card => ({ card, winRate, expectedPoints: 70, samples: 2 })),
      worldsEvaluated: 2, elapsedMs: 50, budgetExhausted: true,
      diagnostic: '搜索预算已用尽，保留 2 个世界评估',
    });
    const engine = new BridgeEngine({ config: testConfig, pimcEvaluator: evaluator });
    const decision = await engine.chooseCard(makeObservation(multiHand), multiCandidates);

    expect(decision.fallbackReason).toBeUndefined();
    expect(decision.searchWinRate).toBe(winRate);
    expect(decision.confidence).toBe(winRate);
    expect(decision.worldsEvaluated).toBe(2);
    expect(decision.candidateEvaluations?.every(move =>
      move.winRate === winRate && move.expectedPoints === 70 && move.samples === 2)).toBe(true);
  });

  it('引擎层：搜索异常回退也不得伪造搜索胜率', async () => {
    const evaluator = new BridgePimcEvaluator({ config: testConfig });
    vi.spyOn(evaluator, 'evaluate').mockRejectedValue(new Error('DDS 接口异常'));
    const engine = new BridgeEngine({ config: testConfig, pimcEvaluator: evaluator });
    const decision = await engine.chooseCard(makeObservation(multiHand), multiCandidates);

    expect(decision.fallbackReason).toContain('DDS 接口异常');
    expect(decision.searchWinRate).toBeUndefined();
    expect(decision.confidence).toBeUndefined();
    expect(multiCandidates).toContainEqual(decision.card);
  });

  it('决策日志：零样本预算降级经过统一动作接口后仍不携带伪造估值', async () => {
    const logger = new DecisionLogger();
    const engine = new BridgeEngine({ config: { ...testConfig, timeLimitMs: 0 } });
    const agent = new EnginePlayerAgent({ engine, logger, thinkingService: new ThinkingService() });
    const state = playingGame(20261011);
    const action = await agent.nextActionAsync(state);
    const record = logger.getRecords()[0];

    expect(action?.kind).toBe('play');
    expect(record.fallbackReason).toContain('搜索预算不足');
    expect(record.searchWinRate).toBeUndefined();
    expect(record.confidence).toBeUndefined();
    expect(record.candidateEvaluations?.every(move =>
      move.samples === 0 && move.winRate === undefined && move.expectedPoints === undefined)).toBe(true);
    expect(logger.exportJson()).not.toContain('"winRate"');
    expect(logger.exportJson()).not.toContain('"expectedPoints"');
  });

  it('引擎层：未评估时不得伪装成搜索结论（searchWinRate 不得为伪造胜率）', async () => {
    const engine = new BridgeEngine({
      config: testConfig,
      pimcEvaluator: new BridgePimcEvaluator({ worldsFactory: failingWorldsFactory, config: testConfig }),
    });
    const decision = await engine.chooseCard(makeObservation(multiHand), multiCandidates);

    // 修复前：searchWinRate = 0.5、confidence = 0.5，与真实深搜结论不可区分。
    expect(decision.searchWinRate).toBeUndefined();
    expect(decision.confidence).toBeUndefined();
    expect(decision.fallbackReason).toBeDefined();
    expect(decision.fallbackReason).toContain('历史缺门与剩余牌矛盾');
    expect(decision.candidateEvaluations?.every(move =>
      move.winRate === undefined && move.expectedPoints === undefined)).toBe(true);
    // 仍必须给出合法牌
    expect(multiCandidates.some((c) => c.suit === decision.card.suit && c.rank === decision.card.rank)).toBe(true);
  });

  it('引擎层：已取消信号必须向上抛出', async () => {
    const engine = new BridgeEngine({ config: testConfig });
    const controller = new AbortController();
    controller.abort(new Error('用户取消'));

    await expect(
      engine.chooseCard(makeObservation(multiHand), multiCandidates, controller.signal),
    ).rejects.toThrow('用户取消');
  });
});

/** 真实对局中推进到某个跟牌局面，取得合法观察。 */
function playingGame(seed = 101): GameState {
  let state = createGame(seed, { targetWins: 1 });
  const first = currentSeat(state);
  for (let i = 0; i < 4; i++) {
    state = bid(state, currentSeat(state), currentSeat(state) === first ? 70 : null);
  }
  state = declareTrump(state, first, 'D');
  return bury(state, first, smartBury(state, first));
}

describe('T0.4 复核 · 跟牌 DDS 不空转（防止按旧路线图实施 T0.4a 造成倒退）', () => {
  it('跟牌局面 DDS 真实求解：worldsEvaluated > 0 且候选 samples > 0', async () => {
    const engine = new BridgeEngine({ config: testConfig });
    const evaluator = new BridgePimcEvaluator({ config: testConfig });
    let state = playingGame(20261011);

    let checked = 0;
    while (state.phase === 'playing' && checked < 1) {
      const seat = currentSeat(state);
      const legal = legalMoves(state, seat);
      const obs = observePlayer(state, seat);

      if (obs.currentRound.length > 0 && legal.length > 1) {
        const decision = await evaluator.evaluate(obs, legal);
        // 旧路线图称跟牌时「三个候选 samples=0、winRate=0.5、expPts=50」。
        expect(decision.worldsEvaluated).toBe(testConfig.maxWorlds);
        for (const move of decision.moves) {
          expect(move.samples).toBe(testConfig.maxWorlds);
        }
        expect(decision.unevaluated).toBeUndefined();
        checked++;
        break;
      }

      state = playCard(state, seat, (await engine.chooseCard(obs, legal)).card);
    }

    expect(checked).toBe(1);
  });

  it('跟牌时 DDS 求解的是跟牌者而非领出者：候选集与跟牌合法集一致', async () => {
    const evaluator = new BridgePimcEvaluator({ config: testConfig });
    let state = playingGame(20261011);

    while (state.phase === 'playing') {
      const seat = currentSeat(state);
      const legal = legalMoves(state, seat);
      const obs = observePlayer(state, seat);

      if (obs.currentRound.length > 0 && legal.length > 1) {
        // 决策者必须是 (leader + currentRound.length) % 4，且与 seat 一致。
        expect((obs.leader + obs.currentRound.length) % 4).toBe(seat);
        expect(legalObservationCards(obs)).toHaveLength(legal.length);
        // 跟随首张花色：候选必须全部同花色（有该花色时）。
        const ledSuit = obs.currentRound[0].card.suit;
        const sameSuit = obs.ownHand.filter((c) => c.suit === ledSuit);
        if (sameSuit.length > 0) {
          const decision = await evaluator.evaluate(obs, legal);
          for (const move of decision.moves) {
            expect(move.card.suit).toBe(ledSuit);
          }
        }
        return;
      }

      // 用 fast 模式快速推进到跟牌局面
      const fast = new BridgeEngine({ config: { ...testConfig, mode: 'fast' } });
      state = playCard(state, seat, (await fast.chooseCard(obs, legal)).card);
    }

    throw new Error('未能在本副内推进到跟牌局面');
  });
});
