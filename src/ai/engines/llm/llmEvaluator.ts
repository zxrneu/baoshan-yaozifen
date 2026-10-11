/**
 * LLM 与全阶段决策评估模块 (SOLID 原则架构实现)。
 *
 * SOLID 架构设计：
 * - S (单一职责)：专门负责评估各阶段动作的合法性、战术合理度与成套基准打分，不做网络推断与状态变异。
 * - O (开闭原则)：评测指标与用例采用策略接口，新增战术指标或基准场景无需修改核心评估器。
 * - L (里氏替换)：实现统一的 IDecisionEvaluator 接口，可无缝替换不同评估器实现。
 * - I (接口隔离)：分别提供 IBidEvaluator、ITrumpEvaluator、IBuryEvaluator、IPlayEvaluator 与 IBenchmarkRunner 细粒度接口。
 * - D (依赖倒置)：依赖领域类型抽象 (GameState, PlayerObservation, Card, ActionDecision)，不依赖具体网络实现。
 */
import { Card, cardId, cardLabel, cardPoints, Suit, SUITS } from '../../../cards';
import { GameState, sideOf, legalBids } from '../../../engine';
import { PlayerObservation } from '../../optimized/contracts';
import { ActionDecision, EngineDecision, DecisionEngine } from '../engineTypes';

// ======================== 细粒度评估报告类型 ========================

export type TacticalRating = 'optimal' | 'good' | 'suboptimal' | 'poor' | 'illegal';

export interface BaseEvaluationReport {
  isLegal: boolean;
  score: number; // 0 ~ 100
  tacticalRating: TacticalRating;
  details: string;
}

export interface BidEvaluationReport extends BaseEvaluationReport {
  bid: number | null;
  hcp: number;
  longestSuitLength: number;
  pointCardsCount: number;
  pointCardsTotal: number;
}

export interface TrumpEvaluationReport extends BaseEvaluationReport {
  trump: Suit;
  suitLength: number;
  isLongestSuit: boolean;
  hasHighControls: boolean;
}

export interface BuryEvaluationReport extends BaseEvaluationReport {
  buriedCards: string[];
  zeroPointsBuried: boolean; // 铁律红线：严禁扣 A/10/5
  voidsCreated: number;      // 制造绝门数
  trumpsPreserved: boolean;  // 是否保留了主牌
}

export interface PlayEvaluationReport extends BaseEvaluationReport {
  cardId: string;
  isPartnerWinning: boolean;
  preservedControlCards: boolean; // 是否成功保住了大牌
  fedPointsToPartner: boolean;    // 是否向赢轮搭档喂分
}

export interface BenchmarkScenario {
  id: string;
  name: string;
  phase: 'bidding' | 'trump' | 'bury' | 'playing';
  setup: () => {
    state?: GameState;
    observation?: PlayerObservation;
    candidates?: readonly Card[];
    seat: number;
  };
  expectedCriteria: (report: BaseEvaluationReport) => boolean;
}

export interface BenchmarkSummaryReport {
  totalScenarios: number;
  legalCount: number;
  legalRate: number; // 0 ~ 1.0 (目标: 1.0)
  averageScore: number;
  averageLatencyMs: number;
  phaseScores: Record<'bidding' | 'trump' | 'bury' | 'playing', number>;
  scenarioResults: Array<{
    scenarioId: string;
    scenarioName: string;
    phase: string;
    passed: boolean;
    score: number;
    latencyMs: number;
    details: string;
  }>;
}

// ======================== 细粒度接口定义 (ISP) ========================

export interface IBidEvaluator {
  evaluateBid(state: GameState, seat: number, decision: ActionDecision): BidEvaluationReport;
}

export interface ITrumpEvaluator {
  evaluateTrump(state: GameState, seat: number, decision: ActionDecision): TrumpEvaluationReport;
}

export interface IBuryEvaluator {
  evaluateBury(state: GameState, seat: number, decision: ActionDecision): BuryEvaluationReport;
}

export interface IPlayEvaluator {
  evaluatePlay(observation: PlayerObservation, candidates: readonly Card[], decision: EngineDecision): PlayEvaluationReport;
}

export interface IDecisionEvaluator extends IBidEvaluator, ITrumpEvaluator, IBuryEvaluator, IPlayEvaluator {
  runBenchmark(engine: DecisionEngine, scenarios?: BenchmarkScenario[]): Promise<BenchmarkSummaryReport>;
}

// ======================== 纯函数辅助分析工具 ========================

function calculateHcp(cards: readonly Card[]): number {
  return cards.reduce((sum, c) => {
    if (c.rank === 'A') return sum + 4;
    if (c.rank === 'K') return sum + 3;
    if (c.rank === 'Q') return sum + 2;
    if (c.rank === 'J') return sum + 1;
    return sum;
  }, 0);
}

function getSuitCounts(cards: readonly Card[]): Record<Suit, number> {
  const counts: Record<Suit, number> = { S: 0, H: 0, C: 0, D: 0 };
  for (const c of cards) counts[c.suit]++;
  return counts;
}

// ======================== 决策评估核心实现 (SRP / OCP / LSP) ========================

export class LlmDecisionEvaluator implements IDecisionEvaluator {
  /**
   * 1. 评估叫分决策
   */
  evaluateBid(state: GameState, seat: number, decision: ActionDecision): BidEvaluationReport {
    if (decision.action.kind !== 'bid') {
      return {
        isLegal: false,
        score: 0,
        tacticalRating: 'illegal',
        bid: null,
        hcp: 0,
        longestSuitLength: 0,
        pointCardsCount: 0,
        pointCardsTotal: 0,
        details: `动作类型不匹配：期望 bid，实际为 ${decision.action.kind}`,
      };
    }

    const legal = legalBids(state);
    const chosenBid = decision.action.bid;
    const hand = state.hands[seat] ?? [];
    const hcp = calculateHcp(hand);
    const suitCounts = getSuitCounts(hand);
    const longest = Math.max(...Object.values(suitCounts));
    const pointCards = hand.filter((c) => cardPoints(c) > 0);
    const pointTotal = pointCards.reduce((a, c) => a + cardPoints(c), 0);

    const isLegal = chosenBid === null || legal.includes(chosenBid);
    if (!isLegal) {
      return {
        isLegal: false,
        score: 0,
        tacticalRating: 'illegal',
        bid: chosenBid,
        hcp,
        longestSuitLength: longest,
        pointCardsCount: pointCards.length,
        pointCardsTotal: pointTotal,
        details: `非法叫分：${chosenBid}，合法档位为 [${legal.join(', ')}] 或 null`,
      };
    }

    // 战术打分评估
    let score = 80;
    let rating: TacticalRating = 'good';
    let details = '';

    if (chosenBid === null) {
      if (hcp >= 16 && longest >= 5) {
        score = 40;
        rating = 'poor';
        details = `过分保守：手牌拥有 ${hcp} 大牌点且有 ${longest} 张长套，放弃叫分错失争庄良机`;
      } else {
        score = 90;
        rating = 'optimal';
        details = `合理放弃：手牌牌力不足（HCP: ${hcp}, 长套: ${longest}），稳健选择不叫`;
      }
    } else {
      if (chosenBid >= 90 && (hcp < 10 || longest < 5)) {
        score = 45;
        rating = 'poor';
        details = `过激叫分：在牌力较弱（HCP: ${hcp}, 长套: ${longest}）情况下叫 ${chosenBid} 分，成局风险极高`;
      } else if (chosenBid >= 80 && longest >= 5 && hcp >= 12) {
        score = 95;
        rating = 'optimal';
        details = `精准叫分：依托 ${longest} 张长套与 ${hcp} 点控牌积极争庄，叫 ${chosenBid} 分契合期望`;
      } else {
        score = 85;
        rating = 'good';
        details = `正常试探性叫分：叫 ${chosenBid} 分`;
      }
    }

    return {
      isLegal: true,
      score,
      tacticalRating: rating,
      bid: chosenBid,
      hcp,
      longestSuitLength: longest,
      pointCardsCount: pointCards.length,
      pointCardsTotal: pointTotal,
      details,
    };
  }

  /**
   * 2. 评估定主决策
   */
  evaluateTrump(state: GameState, seat: number, decision: ActionDecision): TrumpEvaluationReport {
    if (decision.action.kind !== 'trump') {
      return {
        isLegal: false,
        score: 0,
        tacticalRating: 'illegal',
        trump: 'S',
        suitLength: 0,
        isLongestSuit: false,
        hasHighControls: false,
        details: `动作类型不匹配：期望 trump，实际为 ${decision.action.kind}`,
      };
    }

    const trump = decision.action.trump;
    const isLegal = SUITS.includes(trump);
    if (!isLegal) {
      return {
        isLegal: false,
        score: 0,
        tacticalRating: 'illegal',
        trump,
        suitLength: 0,
        isLongestSuit: false,
        hasHighControls: false,
        details: `非法主牌门类：${trump}`,
      };
    }

    const hand = state.hands[seat] ?? [];
    const counts = getSuitCounts(hand);
    const maxCount = Math.max(...Object.values(counts));
    const suitLength = counts[trump];
    const isLongest = suitLength === maxCount;
    const inSuit = hand.filter((c) => c.suit === trump);
    const hasControls = inSuit.some((c) => c.rank === 'A' || c.rank === 'K');

    let score = 70;
    let rating: TacticalRating = 'good';
    let details = '';

    if (suitLength <= 2) {
      score = 25;
      rating = 'poor';
      details = `严重失误：定短门 ${trump} (仅 ${suitLength} 张) 为主牌，严重违背保山幺子分定长套原则`;
    } else if (isLongest && hasControls) {
      score = 98;
      rating = 'optimal';
      details = `极佳定主：选定最长花色 ${trump} (${suitLength} 张) 且带大牌控制张，控场潜力极佳`;
    } else if (isLongest) {
      score = 85;
      rating = 'good';
      details = `合理定主：选定最长花色 ${trump} (${suitLength} 张)`;
    } else {
      score = 65;
      rating = 'suboptimal';
      details = `次优定主：所选花色 ${trump} (${suitLength} 张) 非手牌最长花色 (最长为 ${maxCount} 张)`;
    }

    return {
      isLegal: true,
      score,
      tacticalRating: rating,
      trump,
      suitLength,
      isLongestSuit: isLongest,
      hasHighControls: hasControls,
      details,
    };
  }

  /**
   * 3. 评估扣底决策 (重点严查 A/10/5 分牌铁律红线)
   */
  evaluateBury(state: GameState, seat: number, decision: ActionDecision): BuryEvaluationReport {
    if (decision.action.kind !== 'bury') {
      return {
        isLegal: false,
        score: 0,
        tacticalRating: 'illegal',
        buriedCards: [],
        zeroPointsBuried: false,
        voidsCreated: 0,
        trumpsPreserved: false,
        details: `动作类型不匹配：期望 bury，实际为 ${decision.action.kind}`,
      };
    }

    const buried = decision.action.cards;
    const hand = state.hands[seat] ?? [];
    const buriedLabels = buried.map((c) => cardLabel(c));

    // 1. 张数检验
    if (buried.length !== 4) {
      return {
        isLegal: false,
        score: 0,
        tacticalRating: 'illegal',
        buriedCards: buriedLabels,
        zeroPointsBuried: false,
        voidsCreated: 0,
        trumpsPreserved: false,
        details: `扣底张数非法：期望恰好 4 张，实际扣了 ${buried.length} 张`,
      };
    }

    // 2. 分牌红线检验 (绝对不可扣 A/10/5)
    const pointCardsBuried = buried.filter((c) => cardPoints(c) > 0);
    const zeroPointsBuried = pointCardsBuried.length === 0;
    if (!zeroPointsBuried) {
      return {
        isLegal: false,
        score: 0,
        tacticalRating: 'illegal',
        buriedCards: buriedLabels,
        zeroPointsBuried: false,
        voidsCreated: 0,
        trumpsPreserved: false,
        details: `严重违规：扣底中包含了分牌 [${pointCardsBuried.map((c) => cardLabel(c)).join(', ')}]，保山幺子分铁律严禁扣分牌！`,
      };
    }

    // 3. 扣底牌存在性
    const handCopy = [...hand];
    for (const c of buried) {
      const idx = handCopy.findIndex((h) => h.suit === c.suit && h.rank === c.rank);
      if (idx === -1) {
        return {
          isLegal: false,
          score: 0,
          tacticalRating: 'illegal',
          buriedCards: buriedLabels,
          zeroPointsBuried: true,
          voidsCreated: 0,
          trumpsPreserved: false,
          details: `扣底非法：扣除的牌 ${cardLabel(c)} 不在原始手牌中`,
        };
      }
      handCopy.splice(idx, 1);
    }

    // 4. 战术分析：制造绝门与主牌保护
    const trump = state.trump;
    const remainingHand = handCopy;
    const remainingCounts = getSuitCounts(remainingHand);
    const originalCounts = getSuitCounts(hand);

    let voidsCreated = 0;
    for (const suit of SUITS) {
      if (suit !== trump && originalCounts[suit] > 0 && remainingCounts[suit] === 0) {
        voidsCreated++;
      }
    }

    const trumpsBuried = trump ? buried.filter((c) => c.suit === trump) : [];
    const trumpsPreserved = trumpsBuried.length === 0;

    let score = 80;
    let rating: TacticalRating = 'good';
    let details = '';

    if (voidsCreated > 0 && trumpsPreserved) {
      score = 98;
      rating = 'optimal';
      details = `绝佳扣底：成功造成 ${voidsCreated} 门副牌绝门，且完整保留所有主牌，具备极高主牌毙杀吃分潜力`;
    } else if (!trumpsPreserved) {
      score = 60;
      rating = 'suboptimal';
      details = `次优扣底：扣除了主牌 [${trumpsBuried.map((c) => cardLabel(c)).join(', ')}]，削弱了主牌控场深度`;
    } else {
      score = 85;
      rating = 'good';
      details = `合规稳健扣底：扣除 4 张非分杂牌 [${buriedLabels.join(' ')}]`;
    }

    return {
      isLegal: true,
      score,
      tacticalRating: rating,
      buriedCards: buriedLabels,
      zeroPointsBuried: true,
      voidsCreated,
      trumpsPreserved,
      details,
    };
  }

  /**
   * 4. 评估出牌决策
   */
  evaluatePlay(
    observation: PlayerObservation,
    candidates: readonly Card[],
    decision: EngineDecision,
  ): PlayEvaluationReport {
    const chosen = decision.card;
    const chosenId = cardId(chosen);
    const isLegal = candidates.some((c) => cardId(c) === chosenId);

    if (!isLegal) {
      return {
        isLegal: false,
        score: 0,
        tacticalRating: 'illegal',
        cardId: chosenId,
        isPartnerWinning: false,
        preservedControlCards: false,
        fedPointsToPartner: false,
        details: `非法出牌：${cardLabel(chosen)} 不在当前合法候选集中`,
      };
    }

    const currentTrick = observation.currentRound;
    const mySide = sideOf(observation.seat);

    // 判断搭档当前是否稳赢
    let isPartnerWinning = false;
    if (currentTrick.length > 0) {
      isPartnerWinning = currentTrick.some((t) => sideOf(t.seat) === mySide);
    }

    const chosenPoints = cardPoints(chosen);
    let fedPoints = false;
    let preservedControl = false;
    let score = 85;
    let rating: TacticalRating = 'good';
    let details = '';

    if (isPartnerWinning) {
      if (chosenPoints > 0) {
        fedPoints = true;
        score = 98;
        rating = 'optimal';
        details = `高明配合：搭档处于优势领先，果断喂出分牌 ${cardLabel(chosen)} (+${chosenPoints}分) 锁定团队得分`;
      } else if (['K', 'Q'].includes(chosen.rank)) {
        score = 55;
        rating = 'suboptimal';
        details = `浪费大牌：搭档已具备优势，无需浪费高阶控制牌 ${cardLabel(chosen)}，应出小零分牌保牌`;
      } else {
        preservedControl = true;
        score = 92;
        rating = 'optimal';
        details = `稳妥保牌：搭档领先，出最小零分牌 ${cardLabel(chosen)} 保全控制张`;
      }
    } else {
      score = 85;
      rating = 'good';
      details = `常规合规出牌：打出 ${cardLabel(chosen)}`;
    }

    return {
      isLegal: true,
      score,
      tacticalRating: rating,
      cardId: chosenId,
      isPartnerWinning,
      preservedControlCards: preservedControl,
      fedPointsToPartner: fedPoints,
      details,
    };
  }

  /**
   * 5. 综合全生命周期基准测试套件
   */
  async runBenchmark(
    engine: DecisionEngine,
    scenarios: BenchmarkScenario[] = DEFAULT_BENCHMARK_SCENARIOS,
  ): Promise<BenchmarkSummaryReport> {
    const results: BenchmarkSummaryReport['scenarioResults'] = [];
    const phaseScores: Record<'bidding' | 'trump' | 'bury' | 'playing', number[]> = {
      bidding: [],
      trump: [],
      bury: [],
      playing: [],
    };

    let legalCount = 0;
    let totalScore = 0;
    let totalLatency = 0;

    for (const scenario of scenarios) {
      const { state, observation, candidates, seat } = scenario.setup();
      const t0 = performance.now();
      let report: BaseEvaluationReport;

      try {
        if (scenario.phase === 'bidding' && state) {
          const res = engine.chooseBid ? await engine.chooseBid(state, seat) : await engine.chooseAction?.(state, seat);
          report = this.evaluateBid(state, seat, res!);
        } else if (scenario.phase === 'trump' && state) {
          const res = engine.chooseTrump ? await engine.chooseTrump(state, seat) : await engine.chooseAction?.(state, seat);
          report = this.evaluateTrump(state, seat, res!);
        } else if (scenario.phase === 'bury' && state) {
          const res = engine.chooseBury ? await engine.chooseBury(state, seat) : await engine.chooseAction?.(state, seat);
          report = this.evaluateBury(state, seat, res!);
        } else if (scenario.phase === 'playing' && observation && candidates) {
          const res = await engine.chooseCard(observation, candidates);
          report = this.evaluatePlay(observation, candidates, res);
        } else {
          throw new Error('未知的场景或配置不全');
        }
      } catch (err: any) {
        report = {
          isLegal: false,
          score: 0,
          tacticalRating: 'illegal',
          details: `执行抛出异常: ${err.message}`,
        };
      }

      const latencyMs = performance.now() - t0;
      totalLatency += latencyMs;
      totalScore += report.score;
      if (report.isLegal) legalCount++;

      phaseScores[scenario.phase].push(report.score);
      const passed = scenario.expectedCriteria(report);

      results.push({
        scenarioId: scenario.id,
        scenarioName: scenario.name,
        phase: scenario.phase,
        passed,
        score: report.score,
        latencyMs,
        details: report.details,
      });
    }

    const calcAvg = (arr: number[]) => (arr.length > 0 ? arr.reduce((a, b) => a + b, 0) / arr.length : 0);

    return {
      totalScenarios: scenarios.length,
      legalCount,
      legalRate: scenarios.length > 0 ? legalCount / scenarios.length : 1.0,
      averageScore: scenarios.length > 0 ? Math.round(totalScore / scenarios.length) : 0,
      averageLatencyMs: scenarios.length > 0 ? Math.round(totalLatency / scenarios.length) : 0,
      phaseScores: {
        bidding: Math.round(calcAvg(phaseScores.bidding)),
        trump: Math.round(calcAvg(phaseScores.trump)),
        bury: Math.round(calcAvg(phaseScores.bury)),
        playing: Math.round(calcAvg(phaseScores.playing)),
      },
      scenarioResults: results,
    };
  }
}

// ======================== 默认标准基准测试套件 ========================

import { createGame, bid, declareTrump } from '../../../engine';
import { makeCard } from '../../../cards';

export const DEFAULT_BENCHMARK_SCENARIOS: BenchmarkScenario[] = [
  {
    id: 'bid-strong-hand',
    name: '叫分-强手牌大套积极争庄',
    phase: 'bidding',
    setup: () => {
      const state = createGame(1001);
      return { state, seat: state.dealer };
    },
    expectedCriteria: (r) => r.isLegal && r.score >= 70,
  },
  {
    id: 'trump-length-preference',
    name: '定主-长套主牌选择倾向',
    phase: 'trump',
    setup: () => {
      let state = createGame(1002);
      state = bid(state, 1, 75);
      state = bid(state, 2, null);
      state = bid(state, 3, null);
      state = bid(state, 0, null);
      return { state, seat: 1 };
    },
    expectedCriteria: (r) => r.isLegal && r.score >= 70,
  },
  {
    id: 'bury-strictly-no-points',
    name: '扣底-铁律红线绝无分牌',
    phase: 'bury',
    setup: () => {
      let state = createGame(1003);
      state = bid(state, 1, 75);
      state = bid(state, 2, null);
      state = bid(state, 3, null);
      state = bid(state, 0, null);
      state = declareTrump(state, 1, 'S');
      return { state, seat: 1 };
    },
    expectedCriteria: (r) => (r as BuryEvaluationReport).isLegal && (r as BuryEvaluationReport).zeroPointsBuried,
  },
  {
    id: 'play-partner-winning-preserve',
    name: '出牌-搭档稳赢时保牌防浪费',
    phase: 'playing',
    setup: () => {
      const candidates = [makeCard('D', 'K'), makeCard('D', '2'), makeCard('D', '5')];
      const obs: PlayerObservation = {
        seat: 0,
        ownHand: candidates,
        handCounts: [3, 3, 3, 3],
        declarer: 2,
        bid: 75,
        trump: 'D',
        leader: 2,
        roundNumber: 1,
        currentRound: [
          { seat: 2, card: makeCard('D', 'A') }, // 搭档已出 A 稳赢
          { seat: 3, card: makeCard('D', '3') },
        ],
        completedRounds: [],
        voidSuits: [[], [], [], []],
        declarerPoints: 0,
        defenderPoints: 0,
        kittySize: 4,
        ruleId: 'basic-v1',
      };
      return { observation: obs, candidates, seat: 0 };
    },
    expectedCriteria: (r) => r.isLegal && r.score >= 80,
  },
];
