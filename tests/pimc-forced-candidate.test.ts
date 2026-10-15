/**
 * T0.3 回归测试：PIMC 唯一候选（被迫出牌）指标不得伪装成必胜。
 *
 * 历史缺陷：`BridgePimcEvaluator.evaluate()` 在 `candidates.length === 1` 时直接返回
 * `winRate: 1, expectedPoints: 0`，把「只能打这张」（被迫）标成「打了必胜」（100% 胜率），
 * 且与 0 期望分自相矛盾，污染决策日志、胜率统计与 candidateEvaluations 指标。
 *
 * 修复后契约：单候选分支返回中性基线 (winRate 0.5 / expectedPoints 50) + 显式 `forced: true` 标记。
 * 本套件固化该契约，并守卫多候选路径不受影响。
 */
import { describe, expect, it } from 'vitest';
import { Card, cardId, makeCard } from '@yaozifen/game-core/cards';
import { PlayerObservation } from '@yaozifen/ai-core/optimized/contracts';
import { BridgePimcEvaluator } from '@yaozifen/ai-core/bridge/pimc';
import { DEFAULT_DEEP_THINKING_CONFIG, BridgeThinkingConfig } from '@yaozifen/ai-core/bridge/types';

/** 构造与 tests/bridge-engine.test.ts 同风格的观察快照（seat 0 为第三家跟牌）。 */
function makeObservation(hand: Card[]): PlayerObservation {
  return {
    seat: 0,
    ownHand: hand,
    handCounts: [hand.length, hand.length, hand.length, hand.length],
    declarer: 2,
    bid: 70,
    trump: 'D',
    leader: 2,
    roundNumber: 1,
    currentRound: [
      { seat: 2, card: makeCard('D', 'A') },
      { seat: 3, card: makeCard('D', 'J') },
    ],
    completedRounds: [],
    voidSuits: [[], [], [], []],
    declarerPoints: 0,
    defenderPoints: 0,
    kittySize: 4,
    ruleId: 'basic-v1',
  };
}

const forcedHand = [makeCard('C', '6')];
const multiHand = [makeCard('C', '6'), makeCard('C', 'J'), makeCard('C', 'Q')];

describe('T0.3 PIMC 唯一候选（被迫出牌）指标契约', () => {
  it('被迫出牌不伪装成必胜：winRate 不得为 1', async () => {
    const evaluator = new BridgePimcEvaluator();
    const decision = await evaluator.evaluate(makeObservation(forcedHand), forcedHand);

    expect(decision.winRate).not.toBe(1);
    expect(decision.winRate).toBe(0.5);
  });

  it('被迫出牌顶层与 move 均带 forced: true 标记', async () => {
    const evaluator = new BridgePimcEvaluator();
    const decision = await evaluator.evaluate(makeObservation(forcedHand), forcedHand);

    expect(decision.forced).toBe(true);
    expect(decision.moves).toHaveLength(1);
    expect(decision.moves[0].forced).toBe(true);
  });

  it('moves 与顶层字段自洽，且期望分不再与胜率矛盾', async () => {
    const evaluator = new BridgePimcEvaluator();
    const decision = await evaluator.evaluate(makeObservation(forcedHand), forcedHand);
    const move = decision.moves[0];

    expect(cardId(decision.card)).toBe('6C');
    expect(cardId(move.card)).toBe('6C');
    expect(move.winRate).toBe(decision.winRate);
    // 旧实现为 winRate 1 但 expectedPoints 0（必胜却 0 分）；中性基线必须自洽。
    expect(move.expectedPoints).toBe(50);
    expect(move.expectedPoints).toBeGreaterThan(0);
  });

  it('如实记录未做任何搜索：零样本、零世界、零耗时', async () => {
    const evaluator = new BridgePimcEvaluator();
    const decision = await evaluator.evaluate(makeObservation(forcedHand), forcedHand);

    expect(decision.moves[0].samples).toBe(0);
    expect(decision.worldsEvaluated).toBe(0);
    expect(decision.elapsedMs).toBe(0);
  });

  it('diagnostic 显式标注被迫出牌与无搜索评估', async () => {
    const evaluator = new BridgePimcEvaluator();
    const decision = await evaluator.evaluate(makeObservation(forcedHand), forcedHand);

    expect(decision.diagnostic).toContain('被迫');
    expect(decision.diagnostic).toContain('无搜索评估');
  });

  it('多候选不受影响：仍走完整 DDS-PIMC 路径且无 forced 标记', async () => {
    const evaluator = new BridgePimcEvaluator();
    const decision = await evaluator.evaluate(makeObservation(multiHand), multiHand);

    expect(decision.forced).toBeUndefined();
    for (const move of decision.moves) {
      expect(move.forced).toBeUndefined();
    }
    expect(decision.moves.length).toBeGreaterThan(1);
    expect(decision.diagnostic).toContain('DDS-PIMC');
  });

  it('fast 与 deep 两种思考模式下单候选行为一致', async () => {
    const modes: BridgeThinkingConfig['mode'][] = ['fast', 'deep'];

    for (const mode of modes) {
      const config: BridgeThinkingConfig = { ...DEFAULT_DEEP_THINKING_CONFIG, mode };
      const evaluator = new BridgePimcEvaluator({ config });
      const decision = await evaluator.evaluate(makeObservation(forcedHand), forcedHand);

      expect(decision.winRate).toBe(0.5);
      expect(decision.forced).toBe(true);
      expect(decision.moves[0].forced).toBe(true);
    }
  });

  it('判别性守卫：任何被迫出牌结果都不得携带 winRate === 1', async () => {
    const evaluator = new BridgePimcEvaluator();
    const candidates = [makeCard('S', '7'), makeCard('H', '2'), makeCard('D', '9')];

    // 逐个作为唯一候选，逐一确认不出现 100% 胜率伪装。
    for (const single of candidates) {
      const decision = await evaluator.evaluate(makeObservation([single]), [single]);
      expect(decision.winRate).not.toBe(1);
      expect(decision.moves.some((m) => m.winRate === 1)).toBe(false);
    }
  });
});
