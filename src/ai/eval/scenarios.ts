/**
 * 保山幺子分 35 组标准评测基准场景 (依据 docs/ai-engine-model-evaluation-plan.md 规范定义)。
 * 严格保证 L0 物理牌张守恒，无重牌，总分 100 分。
 */
import { Card, cardId } from '../../cards';
import {
  c,
  parseCards,
  createBiddingState,
  createTrumpState,
  createBuryState,
  createPlayingObservation,
} from './deckHelper';
import { EvalScenario } from './types';
import {
  BaseEvaluationReport,
  BidEvaluationReport,
  TrumpEvaluationReport,
  BuryEvaluationReport,
  PlayEvaluationReport,
} from '../engines/llm/llmEvaluator';

// ======================== 1. 叫分阶段场景 (8 组) ========================

export const BIDDING_SCENARIOS: EvalScenario[] = [
  {
    id: 'bid-garbage-pass',
    name: '叫分-垃圾散牌坚决不叫',
    phase: 'bidding',
    category: '牌力纪律',
    description: '4-3-3-2 无长套无大牌散牌（自带0分，HCP 3点），必须坚决放弃争庄',
    optimalActionDesc: 'Pass (不叫 / null)',
    setup: () => {
      // ♠8 ♠4 ♠3 ♠2 | ♥Q ♥7 ♥6 | ♣J ♣9 ♣3 | ♦6 ♦2 (共12张，0分，HCP 3)
      const hand = parseCards([
        '8S', '4S', '3S', '2S',
        'QH', '7H', '6H',
        'JC', '9C', '3C',
        '6D', '2D',
      ]);
      const state = createBiddingState({ seat: 1, hand });
      return { state, seat: 1 };
    },
    expectedCriteria: (report: BaseEvaluationReport, raw?: any) => {
      const bidRep = report as BidEvaluationReport;
      const actualBid = raw?.action?.bid ?? bidRep.bid;
      // 必须是 null (Pass)
      return report.isLegal && actualBid === null;
    },
  },
  {
    id: 'bid-standard-open',
    name: '叫分-5张套标准起叫',
    phase: 'bidding',
    category: '标准门槛',
    description: '♠AK1073 (20分) + ♥K82 + ♣104 (10分) + ♦92，总分 30，HCP 10，长套带顶张控制',
    optimalActionDesc: '叫 70 或 75 分',
    setup: () => {
      const hand = parseCards([
        'AS', 'KS', '10S', '7S', '3S',
        'KH', '8H', '2H',
        '10C', '4C',
        '9D', '2D',
      ]);
      const state = createBiddingState({ seat: 1, hand });
      return { state, seat: 1 };
    },
    expectedCriteria: (report: BaseEvaluationReport, raw?: any) => {
      const bidRep = report as BidEvaluationReport;
      const actualBid = raw?.action?.bid ?? bidRep.bid;
      return report.isLegal && (actualBid === 70 || actualBid === 75);
    },
  },
  {
    id: 'bid-extreme-long-suit',
    name: '叫分-7张特长套破格起叫',
    phase: 'bidding',
    category: '特大套破格',
    description: '♣AK98742 (10分, 7张长套) + ♠A6 (10分) + ♥83 + ♦2 单张绝门潜质，虽仅20分但主牌统治力极强',
    optimalActionDesc: '叫 70 分 (起叫做庄)',
    setup: () => {
      const hand = parseCards([
        'AC', 'KC', '9C', '8C', '7C', '4C', '2C',
        'AS', '6S',
        '8H', '3H',
        '2D',
      ]);
      const state = createBiddingState({ seat: 1, hand });
      return { state, seat: 1 };
    },
    expectedCriteria: (report: BaseEvaluationReport, raw?: any) => {
      const bidRep = report as BidEvaluationReport;
      const actualBid = raw?.action?.bid ?? bidRep.bid;
      return report.isLegal && (actualBid === 70 || actualBid === 75);
    },
  },
  {
    id: 'bid-strong-high-bid',
    name: '叫分-强牌大套高分争庄',
    phase: 'bidding',
    category: '强牌高叫',
    description: '♠AKQ1083 (20分) + ♥A10 (20分) + ♣A5 (15分) + ♦42，自带55分，多门A强控带断门潜质',
    optimalActionDesc: '叫 85 ~ 95 分 (或 100 分)',
    setup: () => {
      const hand = parseCards([
        'AS', 'KS', 'QS', '10S', '8S', '3S',
        'AH', '10H',
        'AC', '5C',
        '4D', '2D',
      ]);
      const state = createBiddingState({ seat: 1, hand });
      return { state, seat: 1 };
    },
    expectedCriteria: (report: BaseEvaluationReport, raw?: any) => {
      const bidRep = report as BidEvaluationReport;
      const actualBid = raw?.action?.bid ?? bidRep.bid;
      return report.isLegal && actualBid !== null && actualBid >= 85 && actualBid <= 100;
    },
  },
  {
    id: 'bid-competitive-pass',
    name: '叫分-竞叫防守纪律',
    phase: 'bidding',
    category: '防守纪律',
    description: '上家已叫 85 分，当前最低叫分 90 分。自身为中等 5 张套 25 分牌，不足以承担 90 分风险',
    optimalActionDesc: 'Pass (不叫 / null)',
    setup: () => {
      // ♠A9843 (10分) + ♥K102 (10分) + ♣52 (5分) + ♦84 (25分, HCP 8)
      const hand = parseCards([
        'AS', '9S', '8S', '4S', '3S',
        'KH', '10H', '2H',
        '5C', '2C',
        '8D', '4D',
      ]);
      const state = createBiddingState({
        seat: 1,
        hand,
        highestBid: 85,
        highestBidder: 0,
        history: [{ seat: 0, bid: 85 }],
      });
      return { state, seat: 1 };
    },
    expectedCriteria: (report: BaseEvaluationReport, raw?: any) => {
      const bidRep = report as BidEvaluationReport;
      const actualBid = raw?.action?.bid ?? bidRep.bid;
      return report.isLegal && actualBid === null;
    },
  },
  {
    id: 'bid-trap-high-points-flat',
    name: '叫分-多分无套陷阱手',
    phase: 'bidding',
    category: '牌型陷阱',
    description: '3-3-3-3 平均型，无长套无控，手牌自带40分（4张10+4张5），必须坚决Pass防抓庄',
    optimalActionDesc: 'Pass (不叫 / null)',
    setup: () => {
      const hand = parseCards([
        '10S', '5S', '2S',
        '10H', '5H', '2H',
        '10C', '5C', '2C',
        '10D', '5D', '2D',
      ]);
      const state = createBiddingState({ seat: 1, hand });
      return { state, seat: 1 };
    },
    expectedCriteria: (report: BaseEvaluationReport, raw?: any) => {
      const bidRep = report as BidEvaluationReport;
      const actualBid = raw?.action?.bid ?? bidRep.bid;
      return report.isLegal && actualBid === null;
    },
  },
  {
    id: 'bid-defensive-pass',
    name: '叫分-防守埋伏手坚决不叫',
    phase: 'bidding',
    category: '防守定位',
    description: '四门 3-3-3-3 均匀分布，持4个K+4个Q（HCP 20），副牌顶张极多但无5张长套，应防守吃分而不宜盲目抢庄',
    optimalActionDesc: 'Pass (不叫 / null)',
    setup: () => {
      const hand = parseCards([
        'KS', 'QS', 'JS',
        'KH', 'QH', 'JH',
        'KC', 'QC', '8C',
        'KD', 'QD', '8D',
      ]);
      const state = createBiddingState({ seat: 1, hand });
      return { state, seat: 1 };
    },
    expectedCriteria: (report: BaseEvaluationReport, raw?: any) => {
      const bidRep = report as BidEvaluationReport;
      const actualBid = raw?.action?.bid ?? bidRep.bid;
      return report.isLegal && actualBid === null;
    },
  },
  {
    id: 'bid-rebid-raise',
    name: '叫分-竞争性再叫争庄',
    phase: 'bidding',
    category: '再叫竞争',
    description: '自身首叫 70，对手抬至 75，转回自己。持 ♠AKJ1084 六张套带 ♣A，总分 30，HCP 16，应继续加叫争庄',
    optimalActionDesc: '叫 80 或 85 分',
    setup: () => {
      const hand = parseCards([
        'AS', 'KS', 'JS', '10S', '8S', '4S',
        '8H', '3H',
        'AC', '7C',
        '9D', '2D',
      ]);
      const state = createBiddingState({
        seat: 1,
        hand,
        highestBid: 75,
        highestBidder: 2,
        history: [
          { seat: 1, bid: 70 },
          { seat: 2, bid: 75 },
          { seat: 3, bid: null },
          { seat: 0, bid: null },
        ],
      });
      return { state, seat: 1 };
    },
    expectedCriteria: (report: BaseEvaluationReport, raw?: any) => {
      const bidRep = report as BidEvaluationReport;
      const actualBid = raw?.action?.bid ?? bidRep.bid;
      return report.isLegal && (actualBid === 80 || actualBid === 85);
    },
  },
];

// ======================== 2. 定主阶段场景 (7 组) ========================

export const TRUMP_SCENARIOS: EvalScenario[] = [
  {
    id: 'trump-clear-longest',
    name: '定主-明显单长套选主',
    phase: 'trump',
    category: '长套为大',
    description: '♠AK9764 (6张含AK) 对 ♥K3 (2张) + ♣82 (2张) + ♦J4 (2张)',
    optimalActionDesc: '定黑桃 (S)',
    setup: () => {
      const hand = parseCards([
        'AS', 'KS', '9S', '7S', '6S', '4S',
        'KH', '3H',
        '8C', '2C',
        'JD', '4D',
      ]);
      const state = createTrumpState({ seat: 1, hand });
      return { state, seat: 1 };
    },
    expectedCriteria: (report: BaseEvaluationReport, raw?: any) => {
      const actualTrump = raw?.action?.trump ?? (report as TrumpEvaluationReport).trump;
      return report.isLegal && actualTrump === 'S';
    },
  },
  {
    id: 'trump-equal-length-controls',
    name: '定主-等长套控制深度对比',
    phase: 'trump',
    category: '控制深度',
    description: '♥AKJ83 (5张含AK，HCP 8) vs ♦Q9742 (5张无控，HCP 2)，同长比较看大牌控制',
    optimalActionDesc: '定红桃 (H)',
    setup: () => {
      const hand = parseCards([
        'AH', 'KH', 'JH', '8H', '3H',
        'QD', '9D', '7D', '4D', '2D',
        '2S',
        '3C',
      ]);
      const state = createTrumpState({ seat: 1, hand });
      return { state, seat: 1 };
    },
    expectedCriteria: (report: BaseEvaluationReport, raw?: any) => {
      const actualTrump = raw?.action?.trump ?? (report as TrumpEvaluationReport).trump;
      return report.isLegal && actualTrump === 'H';
    },
  },
  {
    id: 'trump-trap-points-vs-length',
    name: '定主-短门高分陷阱抗性',
    phase: 'trump',
    category: '陷阱抗性',
    description: '♥A10 (2张高达20分) vs ♣987643 (6张0分弱套)，坚决不把分牌价值误当主牌控制力',
    optimalActionDesc: '定梅花 (C) (绝不定红桃 H)',
    setup: () => {
      const hand = parseCards([
        'AH', '10H',
        '9C', '8C', '7C', '6C', '4C', '3C',
        'KS', '2S',
        'QD', '3D',
      ]);
      const state = createTrumpState({ seat: 1, hand });
      return { state, seat: 1 };
    },
    expectedCriteria: (report: BaseEvaluationReport, raw?: any) => {
      const actualTrump = raw?.action?.trump ?? (report as TrumpEvaluationReport).trump;
      return report.isLegal && actualTrump === 'C';
    },
  },
  {
    id: 'trump-extreme-7card-dominance',
    name: '定主-7张弱套长套霸权',
    phase: 'trump',
    category: '特长霸权',
    description: '♦10987643 (7张弱套) 对 ♠AKQ (3张顶张)，7张特长套具有绝对主牌清主优势',
    optimalActionDesc: '定方块 (D)',
    setup: () => {
      const hand = parseCards([
        '10D', '9D', '8D', '7D', '6D', '4D', '3D',
        'AS', 'KS', 'QS',
        '2H',
        '3C',
      ]);
      const state = createTrumpState({ seat: 1, hand });
      return { state, seat: 1 };
    },
    expectedCriteria: (report: BaseEvaluationReport, raw?: any) => {
      const actualTrump = raw?.action?.trump ?? (report as TrumpEvaluationReport).trump;
      return report.isLegal && actualTrump === 'D';
    },
  },
  {
    id: 'trump-protect-naked-honors',
    name: '定主-短门带高分严判定主',
    phase: 'trump',
    category: '保护副牌分牌',
    description: '♠5张 AK982 带顶张；♣5张 QJ863；副牌仅单张 ♦10 与单张 ♥5。严防定方块/红心短门，必须定黑桃建立绝对牌权',
    optimalActionDesc: '定黑桃 (S)',
    setup: () => {
      const hand = parseCards([
        'AS', 'KS', '9S', '8S', '2S',
        'QC', 'JC', '8C', '6C', '3C',
        '10D',
        '5H',
      ]);
      const state = createTrumpState({ seat: 1, hand });
      return { state, seat: 1 };
    },
    expectedCriteria: (report: BaseEvaluationReport, raw?: any) => {
      const actualTrump = raw?.action?.trump ?? (report as TrumpEvaluationReport).trump;
      return report.isLegal && actualTrump === 'S';
    },
  },
  {
    id: 'trump-4-4-choice-void-threat',
    name: '定主-双4张套选易造绝门套',
    phase: 'trump',
    category: '造绝门潜力',
    description: '♠4张 AK92、♥4张 KQ84；副牌 ♣3张 J73、♦1张 2D (单张)。黑桃红心均为强4张，单张方块极易扣空做绝门，应定顶张更强的黑桃(或红心)',
    optimalActionDesc: '定黑桃 (S) 或红心 (H)',
    setup: () => {
      const hand = parseCards([
        'AS', 'KS', '9S', '2S',
        'KH', 'QH', '8H', '4H',
        'JC', '7C', '3C',
        '2D',
      ]);
      const state = createTrumpState({ seat: 1, hand });
      return { state, seat: 1 };
    },
    expectedCriteria: (report: BaseEvaluationReport, raw?: any) => {
      const actualTrump = raw?.action?.trump ?? (report as TrumpEvaluationReport).trump;
      return report.isLegal && (actualTrump === 'S' || actualTrump === 'H');
    },
  },
  {
    id: 'trump-solid-vs-fragile-length',
    name: '定主-坚固5张对比脆弱6张',
    phase: 'trump',
    category: '顶张质量对比',
    description: '♠5张 AKQJ10 (绝对顶张大牌，自带20分) 对 ♥6张 987642 (纯小废牌)。长套虽多1张但无大牌必被防守方打穿，必须定黑桃绝对控场',
    optimalActionDesc: '定黑桃 (S)',
    setup: () => {
      const hand = parseCards([
        'AS', 'KS', 'QS', 'JS', '10S',
        '9H', '8H', '7H', '6H', '4H', '2H',
        '3C',
      ]);
      const state = createTrumpState({ seat: 1, hand });
      return { state, seat: 1 };
    },
    expectedCriteria: (report: BaseEvaluationReport, raw?: any) => {
      const actualTrump = raw?.action?.trump ?? (report as TrumpEvaluationReport).trump;
      return report.isLegal && actualTrump === 'S';
    },
  },
];

// ======================== 3. 扣底阶段场景 (8 组) ========================

export const BURY_SCENARIOS: EvalScenario[] = [
  {
    id: 'bury-zero-point-redline',
    name: '扣底-分牌绝对红线测试',
    phase: 'bury',
    category: '铁律红线',
    description: '16张手牌含副牌 ♥A, ♣10, ♦5 与充足非分牌，严禁扣入任何 A/10/5 分牌',
    optimalActionDesc: '恰好扣 4 张本人非分牌，0 分牌入底',
    setup: () => {
      // 主牌 ♠ (5张): ♠AK874
      // 副牌 ♥ (4张): ♥A, ♥K, ♥8, ♥3
      // 副牌 ♣ (4张): ♣10, ♣9, ♣6, ♣2
      // 副牌 ♦ (3张): ♦5, ♦4, ♦2
      const hand16 = parseCards([
        'AS', 'KS', '8S', '7S', '4S',
        'AH', 'KH', '8H', '3H',
        '10C', '9C', '6C', '2C',
        '5D', '4D', '2D',
      ]);
      const state = createBuryState({ seat: 1, hand16, trump: 'S' });
      return { state, seat: 1 };
    },
    expectedCriteria: (report: BaseEvaluationReport) => {
      const buryRep = report as BuryEvaluationReport;
      return buryRep.isLegal && buryRep.zeroPointsBuried;
    },
  },
  {
    id: 'bury-create-single-void',
    name: '扣底-副牌制造单绝门',
    phase: 'bury',
    category: '绝门战术',
    description: '主牌 ♠6张；副牌 ♦3, ♦2 恰好两张非分牌；♥5张；♣3张。必须扣空方块制造绝门',
    optimalActionDesc: '扣除 ♦3, ♦2 及另两张副牌杂小牌，达成方块绝门',
    setup: () => {
      // ♠(主6张): ♠AKQ876
      // ♥(5张): ♥AJ1084
      // ♣(3张): ♣K82
      // ♦(2张): ♦3, ♦2
      const hand16 = parseCards([
        'AS', 'KS', 'QS', '8S', '7S', '6S',
        'AH', 'JH', '10H', '8H', '4H',
        'KC', '8C', '2C',
        '3D', '2D',
      ]);
      const state = createBuryState({ seat: 1, hand16, trump: 'S' });
      return { state, seat: 1 };
    },
    expectedCriteria: (report: BaseEvaluationReport, raw?: any) => {
      const buryRep = report as BuryEvaluationReport;
      const buried: Card[] = raw?.action?.cards ?? [];
      const buriedIds = buried.map(cardId);
      const buriedDiamondVoid = buriedIds.includes('3D') && buriedIds.includes('2D');
      return buryRep.isLegal && buryRep.zeroPointsBuried && buriedDiamondVoid && buryRep.trumpsPreserved;
    },
  },
  {
    id: 'bury-preserve-trumps',
    name: '扣底-严禁扣主牌削弱主控',
    phase: 'bury',
    category: '保主意识',
    description: '主牌 ♥A/K/10/8/4/3/2 (7张)，副牌有充足非分杂牌，必须保留全部 7 张主牌深度',
    optimalActionDesc: '全部 7 张主牌保留，扣副牌非分牌',
    setup: () => {
      // ♥(主7张): ♥AK108432
      // ♠(3张): ♠964
      // ♣(3张): ♣873
      // ♦(3张): ♦K82
      const hand16 = parseCards([
        'AH', 'KH', '10H', '8H', '4H', '3H', '2H',
        '9S', '6S', '4S',
        '8C', '7C', '3C',
        'KD', '8D', '2D',
      ]);
      const state = createBuryState({ seat: 1, hand16, trump: 'H' });
      return { state, seat: 1 };
    },
    expectedCriteria: (report: BaseEvaluationReport) => {
      const buryRep = report as BuryEvaluationReport;
      return buryRep.isLegal && buryRep.zeroPointsBuried && buryRep.trumpsPreserved;
    },
  },
  {
    id: 'bury-preserve-side-honors',
    name: '扣底-保护副牌关键控制张',
    phase: 'bury',
    category: '保留大牌',
    description: '主牌 ♠；副牌 ♣K3，♦8742。必须保留 ♣K 赢张，扣方块纯杂小牌',
    optimalActionDesc: '保留 ♣K，扣除方块杂小牌',
    setup: () => {
      // ♠(主6张): ♠AQ10864
      // ♥(4张): ♥A1073
      // ♣(2张): ♣K, ♣3
      // ♦(4张): ♦8, ♦7, ♦4, ♦2
      const hand16 = parseCards([
        'AS', 'QS', '10S', '8S', '6S', '4S',
        'AH', '10H', '7H', '3H',
        'KC', '3C',
        '8D', '7D', '4D', '2D',
      ]);
      const state = createBuryState({ seat: 1, hand16, trump: 'S' });
      return { state, seat: 1 };
    },
    expectedCriteria: (report: BaseEvaluationReport, raw?: any) => {
      const buryRep = report as BuryEvaluationReport;
      const buried: Card[] = raw?.action?.cards ?? [];
      const buriedKC = buried.some((c) => cardId(c) === 'KC');
      // 不能扣 ♣K
      return buryRep.isLegal && buryRep.zeroPointsBuried && !buriedKC;
    },
  },
  {
    id: 'bury-double-voids',
    name: '扣底-双短门绝门最大化',
    phase: 'bury',
    category: '双绝门规划',
    description: '主牌 ♣；副牌 ♦2 (单张)，♥43 (双张)，♠AK1086 (长套)。扣 ♦2, ♥4, ♥3 及一张 ♠ 杂牌，达成方块与红桃双绝门',
    optimalActionDesc: '扣除 ♦2, ♥4, ♥3 及一张黑桃杂牌，形成双绝门',
    setup: () => {
      // ♣(主8张): ♣AKQ108742
      // ♠(5张): ♠AK1086
      // ♥(2张): ♥4, ♥3
      // ♦(1张): ♦2
      const hand16 = parseCards([
        'AC', 'KC', 'QC', '10C', '8C', '7C', '4C', '2C',
        'AS', 'KS', '10S', '8S', '6S',
        '4H', '3H',
        '2D',
      ]);
      const state = createBuryState({ seat: 1, hand16, trump: 'C' });
      return { state, seat: 1 };
    },
    expectedCriteria: (report: BaseEvaluationReport) => {
      const buryRep = report as BuryEvaluationReport;
      return buryRep.isLegal && buryRep.zeroPointsBuried && buryRep.voidsCreated >= 2;
    },
  },
  {
    id: 'bury-protect-trapped-king',
    name: '扣底-严防单张死K陷阱',
    phase: 'bury',
    category: '大牌保护',
    description: '主牌 ♠6张；副牌持 ♣K4 双张，♦4张小废牌 (9862)，♥4张 (A752含5分)。严禁扣 ♣4 留下单张死 ♣K，应扣方块废牌',
    optimalActionDesc: '扣除方块小废牌，保留 ♣K4 与 ♥A 控制张',
    setup: () => {
      const hand16 = parseCards([
        'AS', 'KS', 'QS', '10S', '8S', '3S',
        'KC', '4C',
        '9D', '8D', '6D', '2D',
        'AH', '7H', '5H', '2H',
      ]);
      const state = createBuryState({ seat: 1, hand16, trump: 'S' });
      return { state, seat: 1 };
    },
    expectedCriteria: (report: BaseEvaluationReport, raw?: any) => {
      const buryRep = report as BuryEvaluationReport;
      const buried: Card[] = raw?.action?.cards ?? [];
      const buriedIds = buried.map(cardId);
      // 不能扣 4C 导致 KC 变成单张死 K；且 0 分扣底保主
      return buryRep.isLegal && buryRep.zeroPointsBuried && !buriedIds.includes('4C') && buryRep.trumpsPreserved;
    },
  },
  {
    id: 'bury-clear-long-garbage',
    name: '扣底-彻底拔除长门废牌',
    phase: 'bury',
    category: '整门拔除',
    description: '主牌 ♠6张，副牌 ♦恰好4张纯小废牌 (9862)，红心与梅花均带AK顶张。必须整门扣空方块4张达成大绝门',
    optimalActionDesc: '精确扣除 ♦9, ♦8, ♦6, ♦2 达成纯绝门',
    setup: () => {
      const hand16 = parseCards([
        'AS', 'KS', 'QS', '10S', '8S', '2S',
        '9D', '8D', '6D', '2D',
        'AH', 'KH', '7H',
        'AC', 'KC', '3C',
      ]);
      const state = createBuryState({ seat: 1, hand16, trump: 'S' });
      return { state, seat: 1 };
    },
    expectedCriteria: (report: BaseEvaluationReport, raw?: any) => {
      const buryRep = report as BuryEvaluationReport;
      const buried: Card[] = raw?.action?.cards ?? [];
      const buriedIds = buried.map(cardId);
      const buriedDiamondVoid = ['9D', '8D', '6D', '2D'].every((id) => buriedIds.includes(id));
      return buryRep.isLegal && buryRep.zeroPointsBuried && buryRep.trumpsPreserved && buriedDiamondVoid;
    },
  },
  {
    id: 'bury-keep-tenace',
    name: '扣底-保留副牌叉子结构',
    phase: 'bury',
    category: '叉子保护',
    description: '主牌 ♠6张，副牌持 ♥AQ3 (AQ叉子) 与 ♣K74、♦J862。扣底应扣方块4张非分废牌，保留 ♥AQ 叉子用于中盘飞牌',
    optimalActionDesc: '扣除方块4张小牌，完整保留 ♥AQ 叉子与 ♣K',
    setup: () => {
      const hand16 = parseCards([
        'AS', 'KS', 'JS', '9S', '7S', '3S',
        'AH', 'QH', '3H',
        'JD', '8D', '6D', '2D',
        'KC', '7C', '4C',
      ]);
      const state = createBuryState({ seat: 1, hand16, trump: 'S' });
      return { state, seat: 1 };
    },
    expectedCriteria: (report: BaseEvaluationReport, raw?: any) => {
      const buryRep = report as BuryEvaluationReport;
      const buried: Card[] = raw?.action?.cards ?? [];
      const buriedIds = buried.map(cardId);
      return (
        buryRep.isLegal &&
        buryRep.zeroPointsBuried &&
        buryRep.trumpsPreserved &&
        !buriedIds.includes('3H') &&
        !buriedIds.includes('QH')
      );
    },
  },
];

// ======================== 4. 出牌阶段场景 (12 组) ========================

export const PLAYING_SCENARIOS: EvalScenario[] = [
  {
    id: 'play-lead-draw-trumps',
    name: '出牌-庄家首轮大主拔大清主',
    phase: 'playing',
    category: '领出清主',
    description: '第 1 轮首攻，庄家手握 ♠A, ♠K, ♠10 等大主牌，全场主牌未清，必须拔 ♠A 清主',
    optimalActionDesc: '出 ♠A (AS)',
    setup: () => {
      const ownHand = parseCards([
        'AS', 'KS', '10S', '8S', '6S',
        'AH', '8H', '4H',
        'KC', '9C',
        '10D', '3D',
      ]);
      return {
        ...createPlayingObservation({
          seat: 1,
          ownHand,
          trump: 'S',
          declarer: 1,
          bid: 75,
          leader: 1,
          roundNumber: 1,
          currentRound: [],
        }),
        seat: 1,
      };
    },
    expectedCriteria: (report: BaseEvaluationReport) => {
      return report.isLegal && (report as PlayEvaluationReport).cardId === 'AS';
    },
  },
  {
    id: 'play-lead-side-ace',
    name: '出牌-领出副牌拔分赢张',
    phase: 'playing',
    category: '兑现赢张',
    description: '第 4 轮领出，历史已完成 3 轮主牌清理，副牌 ♥A 为绝对赢张，必须领出拔分',
    optimalActionDesc: '出 ♥A (AH)',
    setup: () => {
      const ownHand = parseCards([
        'AH', '9H',
        'KC', '8C', '4C',
        'QD', '10D', '6D', '2D',
      ]);
      const completedRounds = [
        {
          trickNumber: 1,
          winner: 1,
          points: 20, // AS (10) + 10S (10) = 20分
          cards: [
            { seat: 1, card: c('AS') },
            { seat: 2, card: c('7S') },
            { seat: 3, card: c('10S') },
            { seat: 0, card: c('2S') },
          ],
        },
        {
          trickNumber: 2,
          winner: 1,
          points: 0,
          cards: [
            { seat: 1, card: c('KS') },
            { seat: 2, card: c('8S') },
            { seat: 3, card: c('3S') },
            { seat: 0, card: c('4S') },
          ],
        },
        {
          trickNumber: 3,
          winner: 1,
          points: 5, // 5S (5分)
          cards: [
            { seat: 1, card: c('QS') },
            { seat: 2, card: c('JS') },
            { seat: 3, card: c('9S') },
            { seat: 0, card: c('5S') },
          ],
        },
      ];
      return {
        ...createPlayingObservation({
          seat: 1,
          ownHand,
          trump: 'S',
          declarer: 1,
          bid: 75,
          leader: 1,
          roundNumber: 4,
          currentRound: [],
          completedRounds,
          declarerPoints: 25, // 20 + 0 + 5 = 25分与桌面严格守恒
          defenderPoints: 0,
        }),
        seat: 1,
      };
    },
    expectedCriteria: (report: BaseEvaluationReport) => {
      return report.isLegal && (report as PlayEvaluationReport).cardId === 'AH';
    },
  },
  {
    id: 'play-follow-feed-points',
    name: '出牌-跟牌搭档稳赢安全喂分',
    phase: 'playing',
    category: '搭档喂分',
    description: '首家领出 ♦3，搭档(第2手)出 ♦A 稳赢，第3手跟 ♦4；自身为第4手，持 ♦10, ♦5, ♦2，必须喂出 ♦10 锁定大分',
    optimalActionDesc: '跟出 ♦10 (10D)，♦5 可接受',
    setup: () => {
      // 自身持 12 张完整手牌 (含 ♦10, ♦5, ♦2)
      const ownHand = parseCards([
        '10D', '5D', '2D',
        'KH', '8H', '4H', '3H',
        '8C', '4C', '3C',
        '9S', '7S',
      ]);
      const currentRound = [
        { seat: 2, card: c('3D') }, // 对手西领出 3D
        { seat: 3, card: c('AD') }, // 搭档北出 AD 稳赢！
        { seat: 0, card: c('4D') }, // 对手东跟 4D
      ];
      return {
        ...createPlayingObservation({
          seat: 1,
          ownHand,
          trump: 'S',
          declarer: 0,
          bid: 75,
          leader: 2,
          roundNumber: 1,
          currentRound,
        }),
        seat: 1,
      };
    },
    expectedCriteria: (report: BaseEvaluationReport) => {
      const playRep = report as PlayEvaluationReport;
      return report.isLegal && (playRep.cardId === '10D' || playRep.cardId === '5D');
    },
  },
  {
    id: 'play-follow-preserve-honors',
    name: '出牌-跟牌搭档稳赢保大牌',
    phase: 'playing',
    category: '保牌防浪费',
    description: '首家领出 ♣3，搭档(第2手)出 ♣A 稳赢，第3手跟 ♣5；自身为第4手，持 ♣K, ♣2 (无分牌)，必须出 ♣2 保留 ♣K',
    optimalActionDesc: '出 ♣2 (2C) (严禁出 ♣K 浪费大牌)',
    setup: () => {
      // 自身持 12 张完整手牌 (含 ♣K, ♣2)
      const ownHand = parseCards([
        'KC', '2C',
        '10H', '8H', '4H', '3H',
        '8D', '4D', '2D',
        '9S', '7S', '6S',
      ]);
      const currentRound = [
        { seat: 2, card: c('3C') }, // 对手西领出 3C
        { seat: 3, card: c('AC') }, // 搭档北出 AC 稳赢！
        { seat: 0, card: c('5C') }, // 对手东跟 5C
      ];
      return {
        ...createPlayingObservation({
          seat: 1,
          ownHand,
          trump: 'S',
          declarer: 0,
          bid: 75,
          leader: 2,
          roundNumber: 1,
          currentRound,
        }),
        seat: 1,
      };
    },
    expectedCriteria: (report: BaseEvaluationReport) => {
      const playRep = report as PlayEvaluationReport;
      return report.isLegal && playRep.cardId === '2C';
    },
  },
  {
    id: 'play-follow-duck-opponent',
    name: '出牌-跟牌对手稳赢防送分',
    phase: 'playing',
    category: '防守不送分',
    description: '对手庄家首攻出 ♠A 稳赢；自身为防守方第4手，持 ♠10, ♠5, ♠3，必须跟出 ♠3，严禁主动送出 ♠10 或 ♠5',
    optimalActionDesc: '跟出 ♠3 (3S) (严禁出 10S 或 5S)',
    setup: () => {
      // 自身持 12 张完整手牌 (含 ♠10, ♠5, ♠3)
      const ownHand = parseCards([
        '10S', '5S', '3S',
        'KH', '9H', '4H', '3H',
        '8C', '6C', '2C',
        '9D', '2D',
      ]);
      const currentRound = [
        { seat: 0, card: c('AS') }, // 对手庄家出 AS 稳赢
        { seat: 1, card: c('4S') }, // 搭档南跟 4S
        { seat: 2, card: c('7S') }, // 对手西跟 7S
      ];
      return {
        ...createPlayingObservation({
          seat: 3,
          ownHand,
          trump: 'S',
          declarer: 0,
          bid: 75,
          leader: 0,
          roundNumber: 1,
          currentRound,
        }),
        seat: 3,
      };
    },
    expectedCriteria: (report: BaseEvaluationReport) => {
      const playRep = report as PlayEvaluationReport;
      return report.isLegal && playRep.cardId === '3S';
    },
  },
  {
    id: 'play-slough-ruff-for-points',
    name: '出牌-垫牌绝门用小主毙杀吃大分',
    phase: 'playing',
    category: '主牌毙杀',
    description: '首家领出 ♥8，下家跟 ♥10，第三家出 ♥A (池内已有20分！)；自己第4手 ♥ 绝门，持小主 ♠3，果断杀牌收分',
    optimalActionDesc: '出小主 ♠2 (2S) 或 ♠3 (3S) 毙杀截获 20 分',
    setup: () => {
      // 自身手牌无任何红桃（绝门），持 12 张完整手牌
      const ownHand = parseCards([
        '3S', '9S', '7S', '6S', '4S', '2S',
        '8C', '6C', '4C',
        'QD', '6D', '2D',
      ]);
      const currentRound = [
        { seat: 2, card: c('8H') },
        { seat: 3, card: c('10H') }, // 10分
        { seat: 0, card: c('AH') },  // 10分
      ];
      return {
        ...createPlayingObservation({
          seat: 1,
          ownHand,
          trump: 'S',
          declarer: 1,
          bid: 75,
          leader: 2,
          roundNumber: 1,
          currentRound,
          voidSuits: [[], ['H'], [], []], // 1号座位红桃绝门
        }),
        seat: 1,
      };
    },
    expectedCriteria: (report: BaseEvaluationReport) => {
      const playRep = report as PlayEvaluationReport;
      return report.isLegal && (playRep.cardId === '2S' || playRep.cardId === '3S');
    },
  },
  {
    id: 'play-slough-feed-side-points',
    name: '出牌-垫牌搭档大主稳赢垫副牌大分',
    phase: 'playing',
    category: '跨花色垫分',
    description: '首家出 ♣，搭档出大主 ♠K 稳赢(历史已确证 ♠A 已出)；自己 ♣ 绝门，持副牌 ♦10/♦3，果断垫 ♦10 送分',
    optimalActionDesc: '垫出 ♦10 (10D) 助攻搭档',
    setup: () => {
      // 自身梅花绝门，手牌 11 张 (第 2 轮)
      const ownHand = parseCards([
        '10D', '9D', '7D', '3D', '2D',
        'KH', '9H', '7H', '6H', '4H', '2H',
      ]);
      const completedRounds = [
        {
          trickNumber: 1,
          winner: 2,
          points: 10,
          cards: [
            { seat: 2, card: c('AS') }, // 对手西领出 AS 赢下第 1 墩！♠K 成为场上绝对最大主牌！
            { seat: 3, card: c('2S') },
            { seat: 0, card: c('4S') },
            { seat: 1, card: c('8S') },
          ],
        },
      ];
      const currentRound = [
        { seat: 2, card: c('4C') }, // 上墩赢家西继续领出 4C
        { seat: 3, card: c('KS') }, // 搭档北出 KS 主牌毙杀稳赢！
        { seat: 0, card: c('7C') }, // 对手东跟 7C
      ];
      return {
        ...createPlayingObservation({
          seat: 1,
          ownHand,
          trump: 'S',
          declarer: 0,
          bid: 75,
          leader: 2,
          roundNumber: 2,
          currentRound,
          completedRounds,
          declarerPoints: 10,
          defenderPoints: 0, // 座位 2 与庄家 0 同队，上墩 10 分属于庄家方
          voidSuits: [[], ['C'], [], []], // 1号位梅花绝门
        }),
        seat: 1,
      };
    },
    expectedCriteria: (report: BaseEvaluationReport) => {
      const playRep = report as PlayEvaluationReport;
      return report.isLegal && playRep.cardId === '10D';
    },
  },
  {
    id: 'play-overruff-opponent',
    name: '出牌-大主超毙夺回高分墩',
    phase: 'playing',
    category: '超毙技术',
    description: '桌面领出 ♥10 (10分)，对手东用小主 ♠3 毙杀企图偷分；自己持 ♠10、♠8，必须用大主超毙夺回 10 分',
    optimalActionDesc: '出 ♠10 (10S) 或 ♠8 (8S) 大主超毙',
    setup: () => {
      const ownHand = parseCards([
        '10S', '8S', '2S',
        'KC', '9C', '3C',
        'AD', 'KD', '8D', '6D', '2D',
      ]);
      const completedRounds = [
        {
          trickNumber: 1,
          winner: 2,
          points: 10,
          cards: [
            { seat: 2, card: c('AC') }, // 对手西领出 AC 赢下第 1 墩 10 分
            { seat: 3, card: c('8C') },
            { seat: 0, card: c('4C') },
            { seat: 1, card: c('7C') },
          ],
        },
      ];
      const currentRound = [
        { seat: 2, card: c('10H') }, // 上墩赢家西继续领出 10H (10分)
        { seat: 3, card: c('4H') },  // 搭档北跟 4H
        { seat: 0, card: c('3S') },  // 对手东用 3S 毙杀！
      ];
      return {
        ...createPlayingObservation({
          seat: 1,
          ownHand,
          trump: 'S',
          declarer: 0,
          bid: 75,
          leader: 2,
          roundNumber: 2,
          currentRound,
          completedRounds,
          declarerPoints: 10,
          defenderPoints: 0,
          voidSuits: [[], ['H'], [], []],
        }),
        seat: 1,
      };
    },
    expectedCriteria: (report: BaseEvaluationReport) => {
      const playRep = report as PlayEvaluationReport;
      return report.isLegal && (playRep.cardId === '10S' || playRep.cardId === '8S');
    },
  },
  {
    id: 'play-second-hand-low',
    name: '出牌-第二手走小保护大牌',
    phase: 'playing',
    category: '防守铁律',
    description: '庄家首攻领出副牌小牌 ♦3，自己为第2手持 ♦K2 双张。严禁盲目冲出 ♦K 被第3手 A 杀，必须出小 ♦2 让第四手搭档应对',
    optimalActionDesc: '跟出 ♦2 (2D)',
    setup: () => {
      const ownHand = parseCards([
        'KD', '2D',
        'AS', '10S', '8S', '4S',
        'KH', '7H', '3H',
        '8C', '4C', '2C',
      ]);
      const currentRound = [
        { seat: 0, card: c('3D') }, // 庄家东领出 3D
      ];
      return {
        ...createPlayingObservation({
          seat: 1,
          ownHand,
          trump: 'S',
          declarer: 0,
          bid: 75,
          leader: 0,
          roundNumber: 1,
          currentRound,
          declarerPoints: 0,
          defenderPoints: 0,
        }),
        seat: 1,
      };
    },
    expectedCriteria: (report: BaseEvaluationReport) => {
      const playRep = report as PlayEvaluationReport;
      return report.isLegal && playRep.cardId === '2D';
    },
  },
  {
    id: 'play-third-hand-high',
    name: '出牌-第三手争大逼出大牌',
    phase: 'playing',
    category: '积极争大',
    description: '搭档北领出 ♣3 小牌，东跟 ♣7；自己为第3手持 ♣KQ4。必须出大牌 ♣Q/♣K 争夺牌权或逼出西家 A，严禁消极出 ♣4 走小',
    optimalActionDesc: '出 ♣Q (QC) 或 ♣K (KC)',
    setup: () => {
      const ownHand = parseCards([
        'KC', 'QC', '4C',
        '8S', '4S', '2S',
        'KH', '9H', '3H',
        '8D', '6D', '2D',
      ]);
      const currentRound = [
        { seat: 3, card: c('3C') }, // 搭档北领出 3C
        { seat: 0, card: c('7C') }, // 对手东跟 7C
      ];
      return {
        ...createPlayingObservation({
          seat: 1,
          ownHand,
          trump: 'S',
          declarer: 0,
          bid: 75,
          leader: 3,
          roundNumber: 1,
          currentRound,
          declarerPoints: 0,
          defenderPoints: 0,
        }),
        seat: 1,
      };
    },
    expectedCriteria: (report: BaseEvaluationReport) => {
      const playRep = report as PlayEvaluationReport;
      return report.isLegal && (playRep.cardId === 'QC' || playRep.cardId === 'KC');
    },
  },
  {
    id: 'play-feed-partner-void',
    name: '出牌-兑现已升高大牌或领搭档绝门',
    phase: 'playing',
    category: '配合飞将',
    description: '搭档北梅花绝门，但是否仍持主牌未知；♦A 已打出，自己持同门最大 ♦K。兑现 ♦K 或领 ♣3 尝试给搭档将吃，均属合理候选',
    optimalActionDesc: '领出 ♦K (KD) 兑现或 ♣3 (3C) 尝试搭档将吃',
    setup: () => {
      const ownHand = parseCards([
        '7S', '4S',
        '3C',
        '8H', '6H', '4H',
        'KD', '8D', '6D', '2D',
      ]);
      const completedRounds = [
        {
          trickNumber: 1,
          winner: 0,
          points: 20,
          cards: [
            { seat: 0, card: c('AH') },
            { seat: 1, card: c('2H') },
            { seat: 2, card: c('7H') },
            { seat: 3, card: c('10H') },
          ],
        },
        {
          trickNumber: 2,
          winner: 1,
          points: 10,
          cards: [
            { seat: 0, card: c('9D') },
            { seat: 1, card: c('AD') },
            { seat: 2, card: c('4D') },
            { seat: 3, card: c('3D') },
          ],
        },
      ];
      return {
        ...createPlayingObservation({
          seat: 1,
          ownHand,
          trump: 'S',
          declarer: 0,
          bid: 75,
          leader: 1,
          roundNumber: 3,
          currentRound: [],
          completedRounds,
          declarerPoints: 20,
          defenderPoints: 10,
          voidSuits: [[], [], [], ['C']], // 搭档北梅花绝门
        }),
        seat: 1,
      };
    },
    expectedCriteria: (report: BaseEvaluationReport) => {
      const playRep = report as PlayEvaluationReport;
      return report.isLegal && (playRep.cardId === '3C' || playRep.cardId === 'KD');
    },
  },
  {
    id: 'play-safe-exit',
    name: '出牌-安全脱手张防送大分',
    phase: 'playing',
    category: '安全脱手',
    description: '自身领牌且无绝对赢张，持 ♦10(10分危险牌) 与 ♦4、4S 等 0 分杂牌。对手身后坐庄持大牌，严禁领出 ♦10 送分，必须出 0 分小牌安全脱手',
    optimalActionDesc: '出 ♦4 或小杂牌安全脱手 (严禁出 10D 送分)',
    setup: () => {
      const ownHand = parseCards([
        '10D', '4D',
        '4S', '3S',
        '8H', '6H', '4H', '2H',
        '8C', '2C',
      ]);
      const completedRounds = [
        {
          trickNumber: 1,
          winner: 0,
          points: 20,
          cards: [
            { seat: 0, card: c('AS') },
            { seat: 1, card: c('2S') },
            { seat: 2, card: c('7S') },
            { seat: 3, card: c('10S') },
          ],
        },
        {
          trickNumber: 2,
          winner: 1,
          points: 20,
          cards: [
            { seat: 0, card: c('5D') },
            { seat: 1, card: c('AD') },
            { seat: 2, card: c('5C') },
            { seat: 3, card: c('2D') },
          ],
        },
      ];
      return {
        ...createPlayingObservation({
          seat: 1,
          ownHand,
          trump: 'S',
          declarer: 0,
          bid: 75,
          leader: 1,
          roundNumber: 3,
          currentRound: [],
          completedRounds,
          declarerPoints: 20,
          defenderPoints: 20,
        }),
        seat: 1,
      };
    },
    expectedCriteria: (report: BaseEvaluationReport) => {
      const playRep = report as PlayEvaluationReport;
      return report.isLegal && playRep.cardId !== '10D';
    },
  },
];

export const ALL_BENCHMARK_SCENARIOS: EvalScenario[] = [
  ...BIDDING_SCENARIOS,
  ...TRUMP_SCENARIOS,
  ...BURY_SCENARIOS,
  ...PLAYING_SCENARIOS,
];
