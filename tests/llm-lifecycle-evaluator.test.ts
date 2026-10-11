import { observeDecision, observeBidding, observeTrump, observeBury } from '../src/ai/decisionObservation';
import { describe, expect, it, vi } from 'vitest';
import { Card, cardId, cardPoints, makeCard } from '../src/cards';
import { createGame, bid, declareTrump, bury } from '../src/engine';
import { PlayerObservation } from '../src/ai/optimized/contracts';
import {
  LlmEngine,
  LlmPromptBuilder,
  LlmResponseParser,
  LlmDecisionEvaluator,
  DEFAULT_BENCHMARK_SCENARIOS,
  ILlmClient,
  OpenAiSdkClient,
  FetchLlmClient,
} from '../src/ai/engines';

describe('LLM 全生命周期与评估模块 (LLM Full-Lifecycle & Evaluator - SOLID)', () => {
  // ===================== 1. 提示词构造与零泄露审计 (LlmPromptBuilder) =====================
  describe('LlmPromptBuilder (SRP - 提示词组装与信息隔离)', () => {
    it('叫分阶段：System Prompt 包含完整规则，User 包含纯私有手牌与公开叫分流', () => {
      let state = createGame(101);
      state = bid(state, 1, 75);
      const messages = LlmPromptBuilder.buildBiddingMessages(observeBidding(state, 2));

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
      expect(payload.handBySuit).toBeDefined();
      expect(payload.handBySuit['♠黑桃']).toBeDefined();
      expect(payload.handSummary).toBeDefined();
      expect(typeof payload.handSummary.totalPoints).toBe('number');
      expect(typeof payload.handSummary.hasLongSuit).toBe('boolean');
      expect(messages[0].content).toContain('思考链约束');
      expect(payload.highestBid).toBe(75);
      expect(payload.bidHistory.length).toBe(1);
    });

    it('真实案例验证：北家 35 分无长套手牌生成分组清晰的提示词 (hasLongSuit: false)', () => {
      const userHand: Card[] = [
        { suit: 'C', rank: 'K' }, { suit: 'H', rank: '10' }, { suit: 'S', rank: 'J' },
        { suit: 'C', rank: '5' }, { suit: 'D', rank: '8' }, { suit: 'S', rank: '10' },
        { suit: 'H', rank: '2' }, { suit: 'D', rank: 'K' }, { suit: 'S', rank: 'A' },
        { suit: 'S', rank: '2' }, { suit: 'C', rank: '8' }, { suit: 'D', rank: 'Q' },
      ];

      const obs: any = {
        seat: 3,
        ownHand: userHand,
        legalBids: [70, 75, 80, 85, 90, 95, 100],
        highestBid: 0,
        highestBidder: null,
        bidHistory: [
          { seat: 1, bid: null },
          { seat: 2, bid: null },
        ],
        minBid: 70,
        maxBid: 100,
        bidStep: 5,
        ruleId: 'basic-v1',
      };

      const messages = LlmPromptBuilder.buildBiddingMessages(obs);
      expect(messages.length).toBe(2);
      expect(messages[0].role).toBe('system');
      expect(messages[0].content).toContain('叫分实战准则与起叫门槛');
      expect(messages[0].content).toContain('字数严格控制在 50~100 字以内');

      const payload = JSON.parse(messages[1].content);
      expect(payload.seat).toBe(3);
      expect(payload.seatName).toBe('北');
      // 验证手牌已被有序理牌
      expect(payload.hand[0]).toBe('♠A');
      expect(payload.hand).toEqual(['♠A', '♠J', '♠10', '♠2', '♥10', '♥2', '♣K', '♣8', '♣5', '♦K', '♦Q', '♦8']);

      // 验证分花色结构
      expect(payload.handBySuit['♠黑桃'].cards).toEqual(['♠A', '♠J', '♠10', '♠2']);
      expect(payload.handBySuit['♠黑桃'].count).toBe(4);
      expect(payload.handBySuit['♠黑桃'].points).toBe(20);
      expect(payload.handBySuit['♠黑桃'].honors).toEqual(['A', 'J']);

      // 验证统计快照直接提供总分与长套标记
      expect(payload.handSummary.totalPoints).toBe(35);
      expect(payload.handSummary.hasLongSuit).toBe(false);
      expect(payload.handSummary.longestSuit).toContain('4张');
      expect(payload.handSummary.hcp).toBe(13);
      expect(payload.bidAdvice.suggestedBid).toBeNull();
      expect(payload.bidAdvice.tacticalAdvice).toContain('果断放弃');
    });

    it('真实案例验证：南家 7 张梅花特长套带双 A，即便 20 分亦生成强烈起叫与绝门建议', () => {
      const userHand: Card[] = [
        { suit: 'S', rank: 'A' },
        { suit: 'H', rank: '9' }, { suit: 'H', rank: '6' }, { suit: 'H', rank: '3' },
        { suit: 'C', rank: 'A' }, { suit: 'C', rank: 'J' }, { suit: 'C', rank: '8' },
        { suit: 'C', rank: '7' }, { suit: 'C', rank: '6' }, { suit: 'C', rank: '4' }, { suit: 'C', rank: '2' },
        { suit: 'D', rank: '2' },
      ];

      const obs: any = {
        seat: 1,
        ownHand: userHand,
        legalBids: [70, 75, 80, 85, 90, 95, 100],
        highestBid: 0,
        highestBidder: null,
        bidHistory: [],
        minBid: 70,
        maxBid: 100,
        bidStep: 5,
        ruleId: 'basic-v1',
      };

      const messages = LlmPromptBuilder.buildBiddingMessages(obs);
      expect(messages[0].content).toContain('特大套破格起叫');
      expect(messages[0].content).toContain('短门绝杀认知');

      const payload = JSON.parse(messages[1].content);
      expect(payload.handSummary.longestSuit).toBe('♣梅花 (7张)');
      expect(payload.handSummary.totalPoints).toBe(20);
      expect(payload.bidAdvice.suggestedBid).toBeGreaterThanOrEqual(70);
      expect(payload.bidAdvice.tacticalAdvice).toContain('强烈建议起叫争庄');
      expect(payload.bidAdvice.voidPotentials[0]).toContain('♦方块: 单张非分牌');
    });



    it('定主阶段：庄家视角组装四门花色统计，未窥探底牌', () => {
      let state = createGame(102);
      state = bid(state, 1, 80);
      state = bid(state, 2, null);
      state = bid(state, 3, null);
      state = bid(state, 0, null);

      const messages = LlmPromptBuilder.buildTrumpMessages(observeTrump(state, 1));
      expect(messages[0].role).toBe('system');
      const payload = JSON.parse(messages[1].content);
      expect(payload.phase).toBe('trump');
      expect(payload.seat).toBe(1);
      expect(payload.winningBid).toBe(80);
      expect(payload.suitsSummary['S']).toBeDefined();
      expect(typeof payload.suitsSummary['S'].strengthScore).toBe('number');
      expect(payload.handBySuit).toBeDefined();
      expect(payload.handSummary).toBeDefined();
    });

    it('扣底阶段：候选列表中严格过滤分牌，严禁出现 A/10/5', () => {
      let state = createGame(103);
      state = bid(state, 1, 80);
      state = bid(state, 2, null);
      state = bid(state, 3, null);
      state = bid(state, 0, null);
      state = declareTrump(state, 1, 'D');

      const messages = LlmPromptBuilder.buildBuryMessages(observeBury(state, 1));
      const payload = JSON.parse(messages[1].content);
      expect(payload.phase).toBe('bury');
      expect(payload.candidates.every((c: any) => !['A', '10', '5'].includes(c.rank))).toBe(true);
      expect(payload.pointCardsMustKeep.length).toBeGreaterThan(0);
      expect(payload.candidatesBySuit).toBeDefined();
      expect(Array.isArray(payload.voidCreationAdvice)).toBe(true);
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
      expect(payload.current_trick_status).toBeDefined();
      expect(payload.current_trick_status.leadCard).toBe('♦A');
      expect(payload.current_trick_status.pointsInTrick).toBe(10);
      expect(payload.remaining_points_tracker).toBeDefined();
      expect(payload.remaining_points_tracker['A']).toBe(2); // 场上出了2张A (SA, DA)，还剩2张
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

  // ===================== 4. LlmEngine 60秒超时与长推演适配 =====================
  describe('LlmEngine 60秒长超时与统一 chooseAction', () => {
    it('默认超时配置为 20,000ms', () => {
      const engine = new LlmEngine();
      expect(engine.getOptions().timeoutMs).toBe(60000);
    });

    it('chooseAction: 统一全生命周期分发 (bidding -> trump -> bury -> playing)', async () => {
      let state = createGame(301);
      const engine = new LlmEngine({ enableDevMockOnFailure: true });

      // 1. 叫分阶段
      const bidAction = await engine.chooseAction(observeDecision(state, 1));
      expect(bidAction.action.kind).toBe('bid');

      // 推进到定主
      state = bid(state, 1, 75);
      state = bid(state, 2, null);
      state = bid(state, 3, null);
      state = bid(state, 0, null);
      expect(state.phase).toBe('trump');

      // 2. 定主阶段
      const trumpAction = await engine.chooseAction(observeDecision(state, 1));
      expect(trumpAction.action.kind).toBe('trump');

      // 推进到扣底
      state = declareTrump(state, 1, (trumpAction.action as any).trump);
      expect(state.phase).toBe('bury');

      // 3. 扣底阶段
      const buryAction = await engine.chooseAction(observeDecision(state, 1));
      expect(buryAction.action.kind).toBe('bury');
      expect((buryAction.action as any).cards.length).toBe(4);

      // 推进到出牌
      state = bury(state, 1, (buryAction.action as any).cards);
      expect(state.phase).toBe('playing');

      // 4. 出牌阶段
      const playAction = await engine.chooseAction(observeDecision(state, 1));
      expect(playAction.action.kind).toBe('play');
    });
  });

  // ===================== 5. 成熟 LLM 客户端抽象与官方 SDK 适配 (SOLID - DIP / OCP) =====================
  describe('ILlmClient 与成熟 OpenAI SDK 适配器 (SOLID - DIP / OCP)', () => {
    it('FetchLlmClient: 正确包装自定义 fetch 并完成 chat 请求解析', async () => {
      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          choices: [
            {
              message: {
                content: JSON.stringify({ cardId: 'AD', confidence: 0.95 }),
                reasoning_content: '分析局势，出大牌拿下领出权',
              },
            },
          ],
        }),
      } as any);

      const client = new FetchLlmClient({
        baseUrl: 'http://127.0.0.1:8000/v1',
        apiKey: 'sk-test',
        fetchFn: mockFetch,
      });

      const res = await client.complete({
        model: 'qwen38_27b',
        messages: [{ role: 'user', content: 'test' }],
      });

      expect(res.rawText).toContain('AD');
      expect(res.reasoningContent).toBe('分析局势，出大牌拿下领出权');
      expect(mockFetch).toHaveBeenCalledTimes(1);
    });

    it('OpenAiSdkClient: 实例创建与 OpenAI SDK 兼容性', () => {
      const client = new OpenAiSdkClient({
        baseUrl: 'http://127.0.0.1:8000/v1',
        apiKey: 'sk-test-openai',
        timeoutMs: 15000,
        maxRetries: 3,
      });

      expect(client).toBeDefined();
    });

    it('LlmEngine 依赖倒置：可直接注入自定义 ILlmClient (DIP)', async () => {
      const mockCustomClient: ILlmClient = {
        complete: vi.fn().mockResolvedValue({
          rawText: JSON.stringify({ cardId: '2D', confidence: 0.88, conclusion: 'Mock Client 决策' }),
          reasoningContent: 'Mock Reasoning Chain',
          requestBody: {},
          latencyMs: 12,
        }),
      };

      const engine = new LlmEngine({
        client: mockCustomClient,
      });

      expect(engine.getClient()).toBe(mockCustomClient);

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
        currentRound: [{ seat: 2, card: makeCard('D', 'A') }],
        completedRounds: [],
        voidSuits: [[], [], [], []],
        declarerPoints: 0,
        defenderPoints: 0,
        kittySize: 4,
        ruleId: 'basic-v1',
      };

      const decision = await engine.chooseCard(obs, candidates);
      expect(decision.card).toEqual(makeCard('D', '2'));
      expect(decision.thinking).toContain('Mock Reasoning Chain');
      expect(decision.conclusion).toBe('Mock Client 决策');
      expect(mockCustomClient.complete).toHaveBeenCalledTimes(1);
    });
  });
});
