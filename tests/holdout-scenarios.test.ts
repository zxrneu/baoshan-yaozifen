/**
 * 独立保留集 (Holdout Test Set) 自动化验证与互斥性测试。
 * 遵循红 → 绿 → 重构原则：
 * 1. 验证保留集覆盖四阶段（叫分、定主、扣底、出牌）与四家座位（0..3）；
 * 2. 验证保留集与开发集（Benchmark Scenarios）ID 严格互斥，保证无数据泄漏；
 * 3. 验证保留集全量场景严格遵循物理守恒定律（全场 52 张无重牌，总分恒等于 100 分）。
 */
import { describe, expect, it } from 'vitest';
import { cardId, cardPoints } from '@yaozifen/game-core/cards';
import { ALL_BENCHMARK_SCENARIOS } from '@yaozifen/ai-eval/scenarios';
import {
  ALL_HOLDOUT_SCENARIOS,
  HOLDOUT_BIDDING_SCENARIOS,
  HOLDOUT_TRUMP_SCENARIOS,
  HOLDOUT_BURY_SCENARIOS,
  HOLDOUT_PLAYING_SCENARIOS,
} from '@yaozifen/ai-eval/holdoutScenarios';
import { getScenarioCanonicalKey } from '@yaozifen/ai-eval/canonicalScenario';

describe('独立保留集 (Holdout Set) 质量与物理守恒', () => {
  it('保留集各阶段完备且总数达标（叫分 >= 8，定主 >= 8，扣底 >= 8，出牌 >= 16，总计 >= 40）', () => {
    expect(HOLDOUT_BIDDING_SCENARIOS.length).toBeGreaterThanOrEqual(8);
    expect(HOLDOUT_TRUMP_SCENARIOS.length).toBeGreaterThanOrEqual(8);
    expect(HOLDOUT_BURY_SCENARIOS.length).toBeGreaterThanOrEqual(8);
    expect(HOLDOUT_PLAYING_SCENARIOS.length).toBeGreaterThanOrEqual(16);
    expect(ALL_HOLDOUT_SCENARIOS.length).toBeGreaterThanOrEqual(40);
  });

  it('保留集四个阶段均完整覆盖东/南/西/北 (0, 1, 2, 3) 四个座位', () => {
    for (const phaseScenarios of [
      HOLDOUT_BIDDING_SCENARIOS,
      HOLDOUT_TRUMP_SCENARIOS,
      HOLDOUT_BURY_SCENARIOS,
      HOLDOUT_PLAYING_SCENARIOS,
    ]) {
      const seats = new Set(phaseScenarios.map((s) => s.setup().seat));
      expect(seats.has(0)).toBe(true);
      expect(seats.has(1)).toBe(true);
      expect(seats.has(2)).toBe(true);
      expect(seats.has(3)).toBe(true);
    }
  });

  it('保留集与开发集 ID 严格互斥，不存在任何数据泄漏或重复样本', () => {
    const devIds = new Set(ALL_BENCHMARK_SCENARIOS.map((s) => s.id));
    const holdoutIds = new Set(ALL_HOLDOUT_SCENARIOS.map((s) => s.id));

    expect(holdoutIds.size).toBe(ALL_HOLDOUT_SCENARIOS.length);
    for (const hId of holdoutIds) {
      expect(devIds.has(hId)).toBe(false);
    }
  });

  it('保留集与开发集内容严格互斥：在座位旋转 (0..3) 与花色置换 (S4) 下无任何等价题跨集合重复', () => {
    const devCanonicalKeys = new Map<string, string>();
    for (const dev of ALL_BENCHMARK_SCENARIOS) {
      devCanonicalKeys.set(getScenarioCanonicalKey(dev), dev.id);
    }

    const duplicates: Array<{ holdoutId: string; devId: string }> = [];
    for (const holdout of ALL_HOLDOUT_SCENARIOS) {
      const key = getScenarioCanonicalKey(holdout);
      if (devCanonicalKeys.has(key)) {
        duplicates.push({ holdoutId: holdout.id, devId: devCanonicalKeys.get(key)! });
      }
    }

    expect(duplicates).toEqual([]);
  });

  it('保留集各阶段内部题目相互独立：不存在座位旋转或花色置换的等价冗余题', () => {
    for (const phase of ['bidding', 'trump', 'bury', 'playing'] as const) {
      const phaseScenarios = ALL_HOLDOUT_SCENARIOS.filter((s) => s.phase === phase);
      const keys = new Set(phaseScenarios.map(getScenarioCanonicalKey));
      expect(keys.size).toBe(phaseScenarios.length);
    }
  });

  it('保留集叫分阶段：四家各 12 张牌，底牌 4 张，全场无重牌且总分严格为 100 分', () => {
    for (const scenario of HOLDOUT_BIDDING_SCENARIOS) {
      const { state, seat } = scenario.setup();
      expect(state).toBeDefined();
      expect(state?.phase).toBe('bidding');
      expect(state?.hands[seat].length).toBe(12);

      const allCards = [
        ...state!.hands[0],
        ...state!.hands[1],
        ...state!.hands[2],
        ...state!.hands[3],
        ...state!.kitty,
      ];
      expect(allCards.length).toBe(52);
      const ids = new Set(allCards.map(cardId));
      expect(ids.size).toBe(52);
      const totalPoints = allCards.reduce((sum, c) => sum + cardPoints(c), 0);
      expect(totalPoints).toBe(100);
    }
  });

  it('保留集定主阶段：庄家 12 张，底牌 4 张，全场无重牌且总分严格为 100 分', () => {
    for (const scenario of HOLDOUT_TRUMP_SCENARIOS) {
      const { state, seat } = scenario.setup();
      expect(state).toBeDefined();
      expect(state?.phase).toBe('trump');
      expect(state?.hands[seat].length).toBe(12);

      const allCards = [
        ...state!.hands[0],
        ...state!.hands[1],
        ...state!.hands[2],
        ...state!.hands[3],
        ...state!.kitty,
      ];
      expect(allCards.length).toBe(52);
      const ids = new Set(allCards.map(cardId));
      expect(ids.size).toBe(52);
      const totalPoints = allCards.reduce((sum, c) => sum + cardPoints(c), 0);
      expect(totalPoints).toBe(100);
    }
  });

  it('保留集扣底阶段：庄家带底手牌 16 张，全场无重牌且总分严格为 100 分', () => {
    for (const scenario of HOLDOUT_BURY_SCENARIOS) {
      const { state, seat } = scenario.setup();
      expect(state).toBeDefined();
      expect(state?.phase).toBe('bury');
      expect(state?.hands[seat].length).toBe(16);

      const allCards = [
        ...state!.hands[0],
        ...state!.hands[1],
        ...state!.hands[2],
        ...state!.hands[3],
      ];
      expect(allCards.length).toBe(52);
      const ids = new Set(allCards.map(cardId));
      expect(ids.size).toBe(52);
      const totalPoints = allCards.reduce((sum, c) => sum + cardPoints(c), 0);
      expect(totalPoints).toBe(100);
    }
  });

  it('保留集出牌阶段：合法观察构建完备，手牌与历史已出牌严格无重复', () => {
    for (const scenario of HOLDOUT_PLAYING_SCENARIOS) {
      const setup = scenario.setup();
      expect(setup.observation).toBeDefined();
      const obs = setup.observation!;

      const seen = new Set<string>();
      for (const card of obs.ownHand) {
        const id = cardId(card);
        expect(seen.has(id)).toBe(false);
        seen.add(id);
      }
      for (const entry of obs.currentRound) {
        const id = cardId(entry.card);
        expect(seen.has(id)).toBe(false);
        seen.add(id);
      }
      for (const round of obs.completedRounds) {
        for (const entry of round.cards) {
          const id = cardId(entry.card);
          expect(seen.has(id)).toBe(false);
          seen.add(id);
        }
      }
      // 绝门信息记录合法
      expect(obs.voidSuits).toHaveLength(4);
    }
  });
});
