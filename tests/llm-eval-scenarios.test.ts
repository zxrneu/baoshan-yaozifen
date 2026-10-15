/**
 * 全阶段基准场景与物理守恒自动化测试 (tests/llm-eval-scenarios.test.ts)。
 * 验证 55 组场景物理守恒、候选合法性、裁判准确度与 BenchmarkRunner 执行完整性。
 */
import { describe, expect, it } from 'vitest';
import {
  ALL_BENCHMARK_SCENARIOS,
  BIDDING_SCENARIOS,
  TRUMP_SCENARIOS,
  BURY_SCENARIOS,
  PLAYING_SCENARIOS,
} from '../src/ai/eval/scenarios';
import { BenchmarkRunner } from '../src/ai/eval/benchmarkRunner';
import { LlmEngine } from '../src/ai/engines/llmEngine';
import { cardId, cardPoints, makeCard } from '../src/cards';
import { LlmDecisionEvaluator } from '../src/ai/engines/llm/llmEvaluator';

describe('保山幺子分 55 组基准场景与评估器 (Benchmark Scenarios Suite)', () => {
  // ===================== 1. L0 物理牌张守恒与数据合规性 =====================
  describe('L0 数据合规与物理守恒验证', () => {
    it('全量基准场景数量恰好为 65 组 (12叫分 + 11定主 + 12扣底 + 30出牌)', () => {
      expect(BIDDING_SCENARIOS.length).toBe(12);
      expect(TRUMP_SCENARIOS.length).toBe(11);
      expect(BURY_SCENARIOS.length).toBe(12);
      expect(PLAYING_SCENARIOS.length).toBe(30);
      expect(ALL_BENCHMARK_SCENARIOS.length).toBe(65);
    });

    it('叫分阶段场景：四家手牌各 12 张，底牌 4 张，全场无重牌且总分严格为 100', () => {
      for (const scenario of BIDDING_SCENARIOS) {
        const { state, seat } = scenario.setup();
        expect(state).toBeDefined();
        expect(state?.phase).toBe('bidding');
        expect(state?.hands[seat].length).toBe(12);

        // 验证物理守恒
        const allCards = [...state!.hands[0], ...state!.hands[1], ...state!.hands[2], ...state!.hands[3], ...state!.kitty];
        expect(allCards.length).toBe(52);
        const cardIds = new Set(allCards.map(cardId));
        expect(cardIds.size).toBe(52);
        const totalPoints = allCards.reduce((sum, c) => sum + cardPoints(c), 0);
        expect(totalPoints).toBe(100);
      }
    });

    it('定主阶段场景：庄家手牌 12 张，底牌 4 张，全场无重牌且总分严格为 100', () => {
      for (const scenario of TRUMP_SCENARIOS) {
        const { state, seat } = scenario.setup();
        expect(state).toBeDefined();
        expect(state?.phase).toBe('trump');
        expect(state?.hands[seat].length).toBe(12);

        const allCards = [...state!.hands[0], ...state!.hands[1], ...state!.hands[2], ...state!.hands[3], ...state!.kitty];
        expect(allCards.length).toBe(52);
        const cardIds = new Set(allCards.map(cardId));
        expect(cardIds.size).toBe(52);
        const totalPoints = allCards.reduce((sum, c) => sum + cardPoints(c), 0);
        expect(totalPoints).toBe(100);
      }
    });

    it('扣底阶段场景：庄家拿底手牌恰好 16 张，全场无重牌且总分严格为 100', () => {
      for (const scenario of BURY_SCENARIOS) {
        const { state, seat } = scenario.setup();
        expect(state).toBeDefined();
        expect(state?.phase).toBe('bury');
        expect(state?.hands[seat].length).toBe(16);

        // 扣底阶段 hands 包含了 16 张，其他三家各有 12 张，加上已分配的 kitty
        const uniqueCards = new Set<string>();
        for (const c of state!.hands[seat]) uniqueCards.add(cardId(c));
        for (let s = 0; s < 4; s++) {
          if (s !== seat) {
            for (const c of state!.hands[s]) uniqueCards.add(cardId(c));
          }
        }
        expect(uniqueCards.size).toBe(52);
      }
    });

    it('出牌阶段场景：手牌与观察对象无重复牌，候选牌集非空且严格合法', () => {
      for (const scenario of PLAYING_SCENARIOS) {
        const { observation, candidates, seat } = scenario.setup();
        expect(observation).toBeDefined();
        expect(candidates).toBeDefined();
        expect(candidates!.length).toBeGreaterThan(0);
        expect(observation?.seat).toBe(seat);

        // 验证候选牌集必须来自自身手牌
        for (const cand of candidates!) {
          const inHand = observation!.ownHand.some((h) => cardId(h) === cardId(cand));
          expect(inHand).toBe(true);
        }
      }
    });
  });

  // ===================== 2. 裁判准则逻辑精准度测试 =====================
  describe('裁判准则准确性 (expectedCriteria 精准区分优劣打法)', () => {
    const evaluator = new LlmDecisionEvaluator();

    it('叫分-垃圾散牌 (bid-garbage-pass): Pass 判定通过，乱叫判定失败', () => {
      const scenario = BIDDING_SCENARIOS.find((s) => s.id === 'bid-garbage-pass')!;
      const { state, seat } = scenario.setup();

      // 优选动作: Pass
      const passRep = evaluator.evaluateBid(state!, seat, {
        action: { kind: 'bid', seat, bid: null },
        engineType: 'llm',
        latencyMs: 100,
      });
      expect(scenario.expectedCriteria(passRep, { action: { kind: 'bid', seat, bid: null } })).toBe(true);

      // 冒进动作: 叫 70 分
      const bidRep = evaluator.evaluateBid(state!, seat, {
        action: { kind: 'bid', seat, bid: 70 },
        engineType: 'llm',
        latencyMs: 100,
      });
      expect(scenario.expectedCriteria(bidRep, { action: { kind: 'bid', seat, bid: 70 } })).toBe(false);
    });

    it('定主-短门高分陷阱抗性 (trump-trap-points-vs-length): 定长套C通过，受高分诱惑定H失败', () => {
      const scenario = TRUMP_SCENARIOS.find((s) => s.id === 'trump-trap-points-vs-length')!;
      const { state, seat } = scenario.setup();

      // 优选动作: 定长套梅花 C
      const optRep = evaluator.evaluateTrump(state!, seat, {
        action: { kind: 'trump', seat, trump: 'C' },
        engineType: 'llm',
        latencyMs: 100,
      });
      expect(scenario.expectedCriteria(optRep, { action: { kind: 'trump', seat, trump: 'C' } })).toBe(true);

      // 陷阱动作: 定短门红桃 H (仅2张A10)
      const trapRep = evaluator.evaluateTrump(state!, seat, {
        action: { kind: 'trump', seat, trump: 'H' },
        engineType: 'llm',
        latencyMs: 100,
      });
      expect(scenario.expectedCriteria(trapRep, { action: { kind: 'trump', seat, trump: 'H' } })).toBe(false);
    });

    it('扣底-分牌红线测试 (bury-zero-point-redline): 扣非分牌通过，含分牌判定失败', () => {
      const scenario = BURY_SCENARIOS.find((s) => s.id === 'bury-zero-point-redline')!;
      const { state, seat } = scenario.setup();

      // 优选动作: 扣 4 张非分牌 (2C, 6C, 9C, 4D)
      const safeCards = [makeCard('C', '2'), makeCard('C', '6'), makeCard('C', '9'), makeCard('D', '4')];
      const optRep = evaluator.evaluateBury(state!, seat, {
        action: { kind: 'bury', seat, cards: safeCards },
        engineType: 'llm',
        latencyMs: 100,
      });
      expect(scenario.expectedCriteria(optRep, { action: { kind: 'bury', seat, cards: safeCards } })).toBe(true);

      // 违规动作: 包含分牌 AH (10分)
      const illegalCards = [makeCard('H', 'A'), makeCard('C', '2'), makeCard('C', '6'), makeCard('C', '9')];
      const illegalRep = evaluator.evaluateBury(state!, seat, {
        action: { kind: 'bury', seat, cards: illegalCards },
        engineType: 'llm',
        latencyMs: 100,
      });
      expect(scenario.expectedCriteria(illegalRep, { action: { kind: 'bury', seat, cards: illegalCards } })).toBe(false);
    });

    it('出牌-搭档稳赢保大牌 (play-follow-preserve-honors): 出2C保牌通过，出KC浪费大牌失败', () => {
      const scenario = PLAYING_SCENARIOS.find((s) => s.id === 'play-follow-preserve-honors')!;
      const { observation, candidates } = scenario.setup();

      // 优选动作: 出 2C 保 KC 控制张
      const optRep = evaluator.evaluatePlay(observation!, candidates!, {
        card: makeCard('C', '2'),
        engineType: 'llm',
        latencyMs: 100,
      });
      expect(scenario.expectedCriteria(optRep)).toBe(true);

      // 次优动作: 出 KC 浪费控制张
      const wasteRep = evaluator.evaluatePlay(observation!, candidates!, {
        card: makeCard('C', 'K'),
        engineType: 'llm',
        latencyMs: 100,
      });
      expect(scenario.expectedCriteria(wasteRep)).toBe(false);
    });

    it('出牌-大主超毙 (play-overruff-opponent): 10S/8S 超毙通过，出小牌/垫牌失败', () => {
      const scenario = PLAYING_SCENARIOS.find((s) => s.id === 'play-overruff-opponent')!;
      const { observation, candidates } = scenario.setup();

      // 优选动作: 出 10S 超毙
      const optRep = evaluator.evaluatePlay(observation!, candidates!, {
        card: makeCard('S', '10'),
        engineType: 'llm',
        latencyMs: 100,
      });
      expect(scenario.expectedCriteria(optRep)).toBe(true);

      // 失误动作: 垫副牌废牌 2D
      const sloughRep = evaluator.evaluatePlay(observation!, candidates!, {
        card: makeCard('D', '2'),
        engineType: 'llm',
        latencyMs: 100,
      });
      expect(scenario.expectedCriteria(sloughRep)).toBe(false);
    });

    it('出牌-第二手走小 (play-second-hand-low): 2D 走小通过，冲 KD 失败', () => {
      const scenario = PLAYING_SCENARIOS.find((s) => s.id === 'play-second-hand-low')!;
      const { observation, candidates } = scenario.setup();

      const lowRep = evaluator.evaluatePlay(observation!, candidates!, {
        card: makeCard('D', '2'),
        engineType: 'llm',
        latencyMs: 100,
      });
      expect(scenario.expectedCriteria(lowRep)).toBe(true);

      const highRep = evaluator.evaluatePlay(observation!, candidates!, {
        card: makeCard('D', 'K'),
        engineType: 'llm',
        latencyMs: 100,
      });
      expect(scenario.expectedCriteria(highRep)).toBe(false);
    });
  });

  // ===================== 3. BenchmarkRunner 全套基准执行测试 =====================
  describe('BenchmarkRunner 执行套件与报告生成', () => {
    it('运行完整 55 组基准并生成标准宏平均分与分阶段报告', async () => {
      const runner = new BenchmarkRunner();
      const mockEngine = new LlmEngine({
        enableDevMockOnFailure: true,
        timeoutMs: 50,
        maxRetries: 0,
        fetchFn: () => Promise.reject(new Error('Unit test offline mock')),
      });

      const summary = await runner.runSuite(mockEngine, ALL_BENCHMARK_SCENARIOS, {
        runId: 'test-run-mock',
        modelName: 'mock_engine',
      });

      expect(summary.totalScenarios).toBe(65);
      expect(summary.legalRate).toBe(1.0); // 100% 规则合法
      expect(summary.phaseSummaries.bidding.total).toBe(12);
      expect(summary.phaseSummaries.trump.total).toBe(11);
      expect(summary.phaseSummaries.bury.total).toBe(12);
      expect(summary.phaseSummaries.playing.total).toBe(30);

      expect(summary.averageScore).toBeGreaterThanOrEqual(75);
      expect(summary.phaseMacroAverageScore).toBeGreaterThanOrEqual(75);

      const markdown = runner.formatMarkdownReport(summary);
      expect(markdown).toContain('保山幺子分 · 全阶段决策能力基准评测报告');
      expect(markdown).toContain('bid-garbage-pass');
      expect(markdown).toContain('play-slough-ruff-for-points');
      expect(markdown).toContain('阶段宏平均分');
    }, 15000); // 全套新增 20 题，离线降级路径包含搜索，保留全部断言并扩展执行时间。
  });
});
