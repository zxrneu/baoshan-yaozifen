import { describe, expect, it } from 'vitest';
import { cardId, cardPoints, makeCard } from '../src/cards';
import { createGame, bid, declareTrump, bury } from '../src/engine';
import { PlayerObservation } from '../src/ai/optimized/contracts';
import {
  LlmEngine,
  LlmPromptBuilder,
  LlmResponseParser,
  LlmDecisionEvaluator,
  DEFAULT_BENCHMARK_SCENARIOS,
} from '../src/ai/engines';

describe('LLM 全生命周期与评估模块 (LLM Full-Lifecycle & Evaluator - SOLID)', () => {
  // ===================== 1. 提示词构造与零泄露审计 (LlmPromptBuilder) =====================
  describe('LlmPromptBuilder (SRP - 提示词组装与信息隔离)', () => {
    it('叫分阶段：System Prompt 包含完整规则，User 包含纯私有手牌与公开叫分流', () => {
      let state = createGame(101);
      state = bid(state, 1, 75);
      const messages = LlmPromptBuilder.buildBiddingMessages(state, 2, [80, 85, 90, 95, 100]);

      expect(messages.length).toBe(2);
      expect(messages[0].role).toBe('system');
      expect(messages[0].content).toContain('云南保山幺子分');
      expect(messages[0].content).toContain('一副 52 张标准扑克');
      expect(messages[0].content).toContain('叫满 100 分');

      expect(messages[1].role).toBe('user');
      const payload = JSON.parse(messages[1].content);
      expect(payload.phase).toBe('bidding');
      expect(payload.seat).toBe(2);
      expect(payload.hand.length).toBe(12);
      expect(payload.highestBid).toBe(75);
      expect(payload.bidHistory.length).toBe(1);
    });

    it('定主阶段：庄家视角组装四门花色统计，未窥探底牌', () => {
      let state = createGame(102);
      state = bid(state, 1, 80);
      state = bid(state, 2, null);
      state = bid(state, 3, null);
      state = bid(state, 0, null);

      const messages = LlmPromptBuilder.buildTrumpMessages(state, 1);
      expect(messages[0].role).toBe('system');
      const payload = JSON.parse(messages[1].content);
      expect(payload.phase).toBe('trump');
      expect(payload.seat).toBe(1);
      expect(payload.winningBid).toBe(80);
      expect(payload.suitsSummary['S']).toBeDefined();
    });

    it('扣底阶段：候选列表中严格过滤分牌，严禁出现 A/10/5', () => {
      let state = createGame(103);
      state = bid(state, 1, 80);
      state = bid(state, 2, null);
      state = bid(state, 3, null);
      state = bid(state, 0, null);
      state = declareTrump(state, 1, 'D');

      const messages = LlmPromptBuilder.buildBuryMessages(state, 1);
      const payload = JSON.parse(messages[1].content);
      expect(payload.phase).toBe('bury');
      expect(payload.candidates.every((c: any) => !['A', '10', '5'].includes(c.rank))).toBe(true);
      expect(payload.pointCardsMustKeep.length).toBeGreaterThan(0);
    });

    it('出牌阶段：完整包含已出牌历史记录 completed_tricks 与已知断门', () => {
      const candidates = [makeCard('D', 'K'), makeCard('D', '2')];
      const obs: PlayerObservation = {
        seat: 0,
        ownHand: candidates,
        handCounts: [2, 2, 2, 2],
        declarer: 2,
        bid: 75,
        trump: 'D',
        leader: 2,
        roundNumber: 2,
        currentRound: [{ seat: 2, card: makeCard('D', 'A') }],
        completedRounds: [
          {
            trickNumber: 1,
            cards: [
              { seat: 2, card: makeCard('S', 'A') },
              { seat: 3, card: makeCard('S', '2') },
              { seat: 0, card: makeCard('S', '5') },
              { seat: 1, card: makeCard('S', '8') },
            ],
            winner: 2,
            points: 15,
          },
        ],
        voidSuits: [[], ['S'], [], []],
        declarerPoints: 15,
        defenderPoints: 0,
        kittySize: 4,
        ruleId: 'basic-v1',
      };

      const messages = LlmPromptBuilder.buildPlayMessages(obs, candidates);
      const payload = JSON.parse(messages[1].content);
      expect(payload.completed_tricks.length).toBe(1);
      expect(payload.completed_tricks[0].pointsWon).toBe(15);
      expect(payload.known_voids[1].voidSuits).toContain('S');
    });
  });

  // ===================== 2. 响应解析与红线防御 (LlmResponseParser) =====================
  describe('LlmResponseParser (SRP - 响应解析与安全校验)', () => {
    it('思维链提取：支持 <think> 标签与 Markdown 代码块剥离', () => {
      const raw = `<think>
我方搭档已经打出方块A确定本轮拿下墩子。
此时我应该垫出最小0分牌保牌。
</think>
\`\`\`json
{
  "cardId": "2D",
  "thinking": "跟出最小牌保全高阶控制张",
  "conclusion": "跟出 2D 保牌",
  "confidence": 0.98
}
\`\`\``;
      const candidates = [makeCard('D', 'K'), makeCard('D', '2')];
      const parsed = LlmResponseParser.parsePlay(raw, candidates);

      expect(cardId(parsed.card)).toBe('2D');
      expect(parsed.thinking).toContain('我方搭档已经打出方块A');
      expect(parsed.conclusion).toBe('跟出 2D 保牌');
      expect(parsed.confidence).toBe(0.98);
    });

    it('扣底红线防御：模型若企图扣除分牌 (A/10/5)，立即拦截抛出异常', () => {
      const hand = [
        makeCard('D', 'A'), // 分牌 (10分)
        makeCard('D', '2'),
        makeCard('D', '3'),
        makeCard('S', '4'),
        makeCard('C', '6'),
      ];
      const json = JSON.stringify({
        cards: ['AD', '2D', '3D', '4S'], // 企图扣 AD!
        thinking: '扣除大分底牌',
      });

      expect(() => {
        LlmResponseParser.parseBury(json, hand);
      }).toThrow(/分牌 A\/10\/5 严禁扣底/);
    });

    it('扣底张数校验：非 4 张扣底拦截抛出异常', () => {
      const hand = [makeCard('D', '2'), makeCard('D', '3'), makeCard('S', '4')];
      const json = JSON.stringify({ cards: ['2D', '3D'] });
      expect(() => {
        LlmResponseParser.parseBury(json, hand);
      }).toThrow(/扣底张数非法/);
    });

    it('定主解析：支持 S/H/C/D 花色大小写容错', () => {
      const json = JSON.stringify({ trump: 's', conclusion: '黑桃为主' });
      const parsed = LlmResponseParser.parseTrump(json);
      expect(parsed.trump).toBe('S');
    });
  });

  // ===================== 3. 全阶段评估模块测试 (LlmDecisionEvaluator) =====================
  describe('LlmDecisionEvaluator (SOLID - 决策评估引擎)', () => {
    const evaluator = new LlmDecisionEvaluator();

    it('评估叫分：合理评估长套大牌叫分与过度保守', () => {
      const state = createGame(201);
      // 合理叫分
      const rep = evaluator.evaluateBid(state, 1, {
        action: { kind: 'bid', seat: 1, bid: 75 },
        engineType: 'llm',
        latencyMs: 100,
      });
      expect(rep.isLegal).toBe(true);
      expect(rep.score).toBeGreaterThanOrEqual(70);

      // 非法叫分
      const illegalRep = evaluator.evaluateBid(state, 1, {
        action: { kind: 'bid', seat: 1, bid: 60 }, // 起叫最低 70
        engineType: 'llm',
        latencyMs: 100,
      });
      expect(illegalRep.isLegal).toBe(false);
      expect(illegalRep.tacticalRating).toBe('illegal');
    });

    it('评估定主：长套主牌获极高评分，短门主牌严重扣分', () => {
      let state = createGame(202);
      state = bid(state, 1, 75);
      state = bid(state, 2, null);
      state = bid(state, 3, null);
      state = bid(state, 0, null);

      // 找出庄家手牌中最长的花色和最短的花色
      const hand = state.hands[1];
      const counts: Record<string, number> = { S: 0, H: 0, C: 0, D: 0 };
      for (const c of hand) counts[c.suit]++;
      const longestSuit = (Object.keys(counts) as any[]).reduce((a, b) => counts[a] >= counts[b] ? a : b);
      const shortestSuit = (Object.keys(counts) as any[]).reduce((a, b) => counts[a] <= counts[b] ? a : b);

      // 评估定最长花色为主牌 -> 高分
      const repLong = evaluator.evaluateTrump(state, 1, {
        action: { kind: 'trump', seat: 1, trump: longestSuit },
        engineType: 'llm',
        latencyMs: 100,
      });
      expect(repLong.isLegal).toBe(true);
      expect(repLong.score).toBeGreaterThanOrEqual(80);

      // 评估定短门为主牌 -> 严重扣分
      const repShort = evaluator.evaluateTrump(state, 1, {
        action: { kind: 'trump', seat: 1, trump: shortestSuit },
        engineType: 'llm',
        latencyMs: 100,
      });
      expect(repShort.isLegal).toBe(true);
      expect(repShort.score).toBeLessThanOrEqual(70);
    });

    it('评估扣底：零分牌且制造绝门获得满分，违规含分牌得分归零', () => {
      let state = createGame(203);
      state = bid(state, 1, 75);
      state = bid(state, 2, null);
      state = bid(state, 3, null);
      state = bid(state, 0, null);
      state = declareTrump(state, 1, 'S');

      // 模拟庄家 16 张手牌扣底
      const hand = state.hands[1];
      const nonPoints = hand.filter((c) => cardPoints(c) === 0);
      const fourSafe = nonPoints.slice(0, 4);

      const legalRep = evaluator.evaluateBury(state, 1, {
        action: { kind: 'bury', seat: 1, cards: fourSafe },
        engineType: 'llm',
        latencyMs: 100,
      });
      expect(legalRep.isLegal).toBe(true);
      expect(legalRep.zeroPointsBuried).toBe(true);
      expect(legalRep.score).toBeGreaterThanOrEqual(80);

      // 违规放入分牌
      const pointCard = hand.find((c) => cardPoints(c) > 0)!;
      const illegalCards = [pointCard, ...fourSafe.slice(0, 3)];
      const illegalRep = evaluator.evaluateBury(state, 1, {
        action: { kind: 'bury', seat: 1, cards: illegalCards },
        engineType: 'llm',
        latencyMs: 100,
      });
      expect(illegalRep.isLegal).toBe(false);
      expect(illegalRep.zeroPointsBuried).toBe(false);
      expect(illegalRep.score).toBe(0);
    });

    it('评估出牌：搭档稳赢时垫小0分牌保牌获高分，浪费K大牌降级', () => {
      const candidates = [makeCard('D', 'K'), makeCard('D', '2')];
      const obs: PlayerObservation = {
        seat: 0,
        ownHand: candidates,
        handCounts: [2, 2, 2, 2],
        declarer: 2,
        bid: 75,
        trump: 'D',
        leader: 2,
        roundNumber: 1,
        currentRound: [{ seat: 2, card: makeCard('D', 'A') }], // 搭档已稳赢
        completedRounds: [],
        voidSuits: [[], [], [], []],
        declarerPoints: 0,
        defenderPoints: 0,
        kittySize: 4,
        ruleId: 'basic-v1',
      };

      // 策略 1: 出最小牌 2D 保牌
      const preserveRep = evaluator.evaluatePlay(obs, candidates, {
        card: makeCard('D', '2'),
        engineType: 'llm',
        latencyMs: 100,
      });
      expect(preserveRep.preservedControlCards).toBe(true);
      expect(preserveRep.score).toBeGreaterThanOrEqual(90);

      // 策略 2: 出 KD 浪费大牌
      const wasteRep = evaluator.evaluatePlay(obs, candidates, {
        card: makeCard('D', 'K'),
        engineType: 'llm',
        latencyMs: 100,
      });
      expect(wasteRep.score).toBeLessThan(70);
    });

    it('运行完整基准套件 (runBenchmark)：生成综合打分报告', async () => {
      // 使用模拟开发决策的 LLM Engine
      const mockEngine = new LlmEngine({
        enableDevMockOnFailure: true,
      });

      const summary = await evaluator.runBenchmark(mockEngine, DEFAULT_BENCHMARK_SCENARIOS);
      expect(summary.totalScenarios).toBe(4);
      expect(summary.legalRate).toBe(1.0); // 100% 合法
      expect(summary.averageScore).toBeGreaterThanOrEqual(75);
      expect(summary.scenarioResults.every((s) => s.passed)).toBe(true);
    });
  });

  // ===================== 4. LlmEngine 20秒超时与长推演适配 =====================
  describe('LlmEngine 20秒长超时与统一 chooseAction', () => {
    it('默认超时配置为 20,000ms', () => {
      const engine = new LlmEngine();
      expect(engine.getOptions().timeoutMs).toBe(20000);
    });

    it('chooseAction: 统一全生命周期分发 (bidding -> trump -> bury -> playing)', async () => {
      let state = createGame(301);
      const engine = new LlmEngine({ enableDevMockOnFailure: true });

      // 1. 叫分阶段
      const bidAction = await engine.chooseAction(state, 1);
      expect(bidAction.action.kind).toBe('bid');

      // 推进到定主
      state = bid(state, 1, 75);
      state = bid(state, 2, null);
      state = bid(state, 3, null);
      state = bid(state, 0, null);
      expect(state.phase).toBe('trump');

      // 2. 定主阶段
      const trumpAction = await engine.chooseAction(state, 1);
      expect(trumpAction.action.kind).toBe('trump');

      // 推进到扣底
      state = declareTrump(state, 1, (trumpAction.action as any).trump);
      expect(state.phase).toBe('bury');

      // 3. 扣底阶段
      const buryAction = await engine.chooseAction(state, 1);
      expect(buryAction.action.kind).toBe('bury');
      expect((buryAction.action as any).cards.length).toBe(4);

      // 推进到出牌
      state = bury(state, 1, (buryAction.action as any).cards);
      expect(state.phase).toBe('playing');

      // 4. 出牌阶段
      const playAction = await engine.chooseAction(state, 1);
      expect(playAction.action.kind).toBe('play');
    });
  });
});
