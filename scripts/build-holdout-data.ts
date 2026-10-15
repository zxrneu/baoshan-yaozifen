/**
 * 独立保留集生成与物理/等价性严密校验脚本
 */
import fs from 'node:fs';
import path from 'node:path';
import { getScenarioCanonicalKey } from '../src/ai/eval/canonicalScenario';
import { ALL_BENCHMARK_SCENARIOS } from '../src/ai/eval/scenarios';
import { loadScenarios } from '../src/ai/eval/scenarioLoader';

// 8个完全独立的叫分场景
const holdoutBidding = [
  {
    id: "holdout-bid-east-balanced-strong-open",
    name: "保留集-叫分-东家16分均型标准起叫75",
    phase: "bidding",
    category: "起叫标准",
    description: "东家首轮行动，手握 16 HCP (AS, KS, AH, KD, AC)，4-3-3-2 均型大牌充足，平稳起叫 75 分",
    optimalActionDesc: "起叫 75",
    setup: {
      seat: 0,
      hand: ["AS", "KS", "7S", "4S", "AH", "9H", "3H", "KD", "8D", "2D", "AC", "6C"]
    },
    expected: {
      minBid: 70,
      maxBid: 80
    }
  },
  {
    id: "holdout-bid-east-flat-weak-pass",
    name: "保留集-叫分-东家纯弱牌坚决不叫",
    phase: "bidding",
    category: "消极放弃",
    description: "东家首轮行动，手牌 3-3-3-3 均型，仅有 KC 一张大牌，毫无进攻能力，坚决 Pass",
    optimalActionDesc: "不叫 (Pass)",
    setup: {
      seat: 0,
      hand: ["8S", "6S", "3S", "9H", "7H", "4H", "8D", "6D", "3D", "KC", "8C", "3C"]
    },
    expected: {
      bids: [null]
    }
  },
  {
    id: "holdout-bid-south-extreme-two-suiter",
    name: "保留集-叫分-南家红桃黑桃两色强套直上80",
    phase: "bidding",
    category: "双套强牌",
    description: "东家不叫，南家手持 6 张红桃带 AK 与 5 张黑桃带 AK，单张梅花方块绝门，直接起叫 80 分抢庄",
    optimalActionDesc: "起叫 80",
    setup: {
      seat: 1,
      hand: ["AS", "KS", "QS", "8S", "4S", "AH", "KH", "10H", "8H", "6H", "2H", "3C"],
      history: [{ seat: 0, bid: null }]
    },
    expected: {
      minBid: 80,
      maxBid: 85
    }
  },
  {
    id: "holdout-bid-south-compete-over-75",
    name: "保留集-叫分-南家持六张方块强套顶叫80",
    phase: "bidding",
    category: "竞争叫分",
    description: "东家叫 75 分，南家手持 6 张方块 (AD, KD, 10D, 8D, 6D, 3D) 与黑桃 AS，有充足赢张与长套，加叫 80 分竞争",
    optimalActionDesc: "加叫 80",
    setup: {
      seat: 1,
      hand: ["AS", "8S", "3S", "7H", "4H", "AD", "KD", "10D", "8D", "6D", "3D", "2C"],
      highestBid: 75,
      highestBidder: 0,
      history: [{ seat: 0, bid: 75 }]
    },
    expected: {
      bids: [80]
    }
  },
  {
    id: "holdout-bid-west-support-partner-pass",
    name: "保留集-叫分-西家搭档叫75中等牌力不盲目抬价",
    phase: "bidding",
    category: "搭档配合",
    description: "东家搭档叫 75 分，南家不叫，西家持有 9 HCP 中庸牌力，不应盲目抬高自家叫分线，坚决 Pass 守住 75",
    optimalActionDesc: "不叫 (Pass)",
    setup: {
      seat: 2,
      hand: ["QS", "8S", "2S", "KH", "8H", "4H", "JD", "9D", "4D", "AC", "7C", "3C"],
      highestBid: 75,
      highestBidder: 0,
      history: [
        { seat: 0, bid: 75 },
        { seat: 1, bid: null }
      ]
    },
    expected: {
      bids: [null]
    }
  },
  {
    id: "holdout-bid-west-long-minor-preempt",
    name: "保留集-叫分-西家7张梅花长套起叫70",
    phase: "bidding",
    category: "长套起叫",
    description: "东家南家均不叫，西家持有 7 张梅花长套 (KC, QC, 10C, 8C, 6C, 4C, 2C) 且黑桃绝门，符合长套破格起叫条件，叫 70 分",
    optimalActionDesc: "起叫 70",
    setup: {
      seat: 2,
      hand: ["9H", "6H", "3H", "AD", "8D", "KC", "QC", "10C", "8C", "6C", "4C", "2C"],
      history: [
        { seat: 0, bid: null },
        { seat: 1, bid: null }
      ]
    },
    expected: {
      minBid: 70,
      maxBid: 75
    }
  },
  {
    id: "holdout-bid-north-fourth-seat-balance",
    name: "保留集-叫分-北家第四手平衡叫分70",
    phase: "bidding",
    category: "平衡叫分",
    description: "前三家均不叫，北家在第四手手持 13 HCP 与 5 张优质黑桃 (AS, KS, JS, 9S, 3S)，起叫 70 分争取定约",
    optimalActionDesc: "起叫 70",
    setup: {
      seat: 3,
      hand: ["AS", "KS", "JS", "9S", "3S", "KH", "7H", "2H", "QD", "8D", "4D", "3C"],
      history: [
        { seat: 0, bid: null },
        { seat: 1, bid: null },
        { seat: 2, bid: null }
      ]
    },
    expected: {
      minBid: 70,
      maxBid: 75
    }
  },
  {
    id: "holdout-bid-north-heavy-defense-trap",
    name: "保留集-叫分-北家面对85高分重防守纪律Pass",
    phase: "bidding",
    category: "防守纪律",
    description: "对手东家一路叫至 85 分，北家手握 4-4-2-2 均型带三张 A，最长套仅 4 张，缺少单门控场能力，遵守纪律坚决 Pass 设置防守陷阱",
    optimalActionDesc: "不叫 (Pass)",
    setup: {
      seat: 3,
      hand: ["AS", "10S", "8S", "3S", "AH", "9H", "6H", "2H", "KD", "4D", "AC", "7C"],
      highestBid: 85,
      highestBidder: 0,
      history: [
        { seat: 0, bid: 85 },
        { seat: 1, bid: null },
        { seat: 2, bid: null }
      ]
    },
    expected: {
      bids: [null]
    }
  }
];

// 8个完全独立的定主场景
const holdoutTrump = [
  {
    id: "holdout-trump-east-solid-six-hearts",
    name: "保留集-定主-东家6张坚固红桃定主",
    phase: "trump",
    category: "单一长套",
    description: "东家叫到 75 分，手持 6 张红桃 (AH, KH, QH, 10H, 8H, 3H) 具有绝对主牌深度与大牌，唯一正确定主为红桃",
    optimalActionDesc: "定红桃 (H)",
    setup: {
      seat: 0,
      winningBid: 75,
      hand: ["8S", "3S", "AH", "KH", "QH", "10H", "8H", "3H", "AD", "7D", "KC", "4C"]
    },
    expected: {
      suits: ["H"]
    }
  },
  {
    id: "holdout-trump-east-two-equal-suits-quality",
    name: "保留集-定主-东家五五开长套选大牌密集花色",
    phase: "trump",
    category: "双套抉择",
    description: "东家持有 5 张黑桃 (AS, KS, 10S, 8S, 2S) 与 5 张方块 (KD, QD, JD, 9D, 4D)，黑桃兼具顶张与深度控制，选黑桃为主牌",
    optimalActionDesc: "定黑桃 (S)",
    setup: {
      seat: 0,
      winningBid: 75,
      hand: ["AS", "KS", "10S", "8S", "2S", "9H", "4H", "KD", "QD", "JD", "9D", "4D"]
    },
    expected: {
      suits: ["S"]
    }
  },
  {
    id: "holdout-trump-south-long-minor-diamonds",
    name: "保留集-定主-南家7张方块超长套定主",
    phase: "trump",
    category: "超长套",
    description: "南家手握 7 张方块 (AD, KD, JD, 9D, 7D, 4D, 2D)，副牌零散，必须利用超长方块控局定方块为主",
    optimalActionDesc: "定方块 (D)",
    setup: {
      seat: 1,
      winningBid: 75,
      hand: ["8S", "3S", "AH", "9H", "AD", "KD", "JD", "9D", "7D", "4D", "2D", "4C"]
    },
    expected: {
      suits: ["D"]
    }
  },
  {
    id: "holdout-trump-south-length-beats-strength",
    name: "保留集-定主-南家6张草花深套优先于3张大黑桃",
    phase: "trump",
    category: "长度优先",
    description: "南家持有 6 张草花 (JC, 10C, 8C, 6C, 4C, 2C) 与 3 张黑桃顶张 (AS, KS, QS)，在幺子分规则下，必须由 6 张草花作主才能防范失控",
    optimalActionDesc: "定草花 (C)",
    setup: {
      seat: 1,
      winningBid: 70,
      hand: ["AS", "KS", "QS", "9H", "4H", "8D", "JC", "10C", "8C", "6C", "4C", "2C"]
    },
    expected: {
      suits: ["C"]
    }
  },
  {
    id: "holdout-trump-west-five-four-hearts",
    name: "保留集-定主-西家5张红桃强套压过4张黑桃",
    phase: "trump",
    category: "长短对比",
    description: "西家手握 5 张红桃 (AH, QH, JH, 8H, 4H) 与 4 张黑桃 (KS, 10S, 7S, 3S)，红桃不仅张数占优且大牌连贯，定红桃为主",
    optimalActionDesc: "定红桃 (H)",
    setup: {
      seat: 2,
      winningBid: 75,
      hand: ["KS", "10S", "7S", "3S", "AH", "QH", "JH", "8H", "4H", "AD", "8C", "2C"]
    },
    expected: {
      suits: ["H"]
    }
  },
  {
    id: "holdout-trump-west-extreme-monosuite",
    name: "保留集-定主-西家8张巨型梅花独门控场",
    phase: "trump",
    category: "独门巨套",
    description: "西家手握 8 张梅花 (AC, KC, QC, 10C, 9C, 7C, 5C, 2C)，拥有绝对主控，毫无悬念定梅花为主",
    optimalActionDesc: "定梅花 (C)",
    setup: {
      seat: 2,
      winningBid: 85,
      hand: ["AS", "4S", "KH", "3D", "AC", "KC", "QC", "10C", "9C", "7C", "5C", "2C"]
    },
    expected: {
      suits: ["C"]
    }
  },
  {
    id: "holdout-trump-north-spades-with-void",
    name: "保留集-定主-北家5张黑桃带红桃绝门",
    phase: "trump",
    category: "带绝门定主",
    description: "北家手握 5 张黑桃 (AS, KS, 9S, 6S, 2S)，红桃缺门，方块草花各 4-3 分布，黑桃兼具赢张与绝门将吃潜力，选黑桃为主",
    optimalActionDesc: "定黑桃 (S)",
    setup: {
      seat: 3,
      winningBid: 75,
      hand: ["AS", "KS", "9S", "6S", "2S", "KD", "9D", "7D", "3D", "AC", "8C", "4C"]
    },
    expected: {
      suits: ["S"]
    }
  },
  {
    id: "holdout-trump-north-diamonds-power",
    name: "保留集-定主-北家6张豪华方块定主",
    phase: "trump",
    category: "豪华单套",
    description: "北家手持 6 张方块 (AD, KD, 10D, 9D, 6D, 3D) 附带 3 个顶张，定方块为主能迅速清光防家主牌",
    optimalActionDesc: "定方块 (D)",
    setup: {
      seat: 3,
      winningBid: 80,
      hand: ["AS", "7S", "AH", "8H", "AD", "KD", "10D", "9D", "6D", "3D", "KC", "2C"]
    },
    expected: {
      suits: ["D"]
    }
  }
];

// 8个完全独立的扣底场景
const holdoutBury = [
  {
    id: "holdout-bury-east-double-void-clubs-diamonds",
    name: "保留集-扣底-东家双扣短门做成梅花方块双绝门",
    phase: "bury",
    category: "双短门扣空",
    description: "东家主牌红桃 7 张，副牌梅花有 3C, 7C (双张)，方块有 4D, 8D (双张)，黑桃有 AS, KS 控制。扣除 3C, 7C, 4D, 8D 制造双绝门",
    optimalActionDesc: "扣 3C 7C 4D 8D",
    setup: {
      seat: 0,
      trump: "H",
      hand16: [
        "AH", "KH", "QH", "10H", "8H", "6H", "2H",
        "AS", "KS",
        "4D", "8D",
        "3C", "7C",
        "9S", "8S", "4S"
      ]
    },
    expected: {
      zeroPointsBuried: true,
      trumpsPreserved: true,
      includeCards: ["3C", "7C", "4D", "8D"],
      minVoidsCreated: 2
    }
  },
  {
    id: "holdout-bury-east-protect-unsupported-king",
    name: "保留集-扣底-东家保带护张的死K全扣4张方块废牌",
    phase: "bury",
    category: "保护副牌K",
    description: "东家主牌黑桃 6 张，梅花持 KC, 4C 双张，方块恰好 4 张纯小杂牌 (9D, 8D, 6D, 2D)。必须整门扣空方块，严禁拆扣 4C 留下孤立死 K",
    optimalActionDesc: "扣 2D 6D 8D 9D",
    setup: {
      seat: 0,
      trump: "S",
      hand16: [
        "AS", "KS", "10S", "8S", "7S", "3S",
        "AH", "10H", "5H",
        "KC", "4C",
        "9D", "8D", "6D", "2D",
        "QH"
      ]
    },
    expected: {
      zeroPointsBuried: true,
      trumpsPreserved: true,
      includeCards: ["2D", "6D", "8D", "9D"],
      excludeCards: ["4C"],
      minVoidsCreated: 1
    }
  },
  {
    id: "holdout-bury-south-clear-four-hearts",
    name: "保留集-扣底-南家扣尽4张红桃废牌做绝门",
    phase: "bury",
    category: "拔除长废牌",
    description: "南家草花为主牌 6 张，副牌红桃恰好 4 张无分废牌 (9H, 8H, 6H, 3H)，黑桃与方块均有 AK 顶张，扣空 4 张红桃制造红桃绝门",
    optimalActionDesc: "扣 3H 6H 8H 9H",
    setup: {
      seat: 1,
      trump: "C",
      hand16: [
        "AC", "KC", "10C", "8C", "6C", "2C",
        "AS", "10S", "4S",
        "KD", "10D", "5D",
        "9H", "8H", "6H", "3H"
      ]
    },
    expected: {
      zeroPointsBuried: true,
      trumpsPreserved: true,
      includeCards: ["3H", "6H", "8H", "9H"],
      minVoidsCreated: 1
    }
  },
  {
    id: "holdout-bury-south-keep-tenace-aq",
    name: "保留集-扣底-南家保留黑桃AQ叉子扣4张梅花",
    phase: "bury",
    category: "保留叉子",
    description: "南家方块为主牌 7 张，黑桃持 AS, QS, 4S (AQ 叉子控制)，梅花有 4 张零分废牌 (9C, 8C, 7C, 3C)，扣光梅花保住黑桃叉子",
    optimalActionDesc: "扣 3C 7C 8C 9C",
    setup: {
      seat: 1,
      trump: "D",
      hand16: [
        "AD", "KD", "10D", "8D", "6D", "4D", "2D",
        "AS", "QS", "4S",
        "KH", "10H",
        "9C", "8C", "7C", "3C"
      ]
    },
    expected: {
      zeroPointsBuried: true,
      trumpsPreserved: true,
      includeCards: ["3C", "7C", "8C", "9C"],
      minVoidsCreated: 1
    }
  },
  {
    id: "holdout-bury-west-preserve-all-trumps",
    name: "保留集-扣底-西家8张大主牌一张不扣",
    phase: "bury",
    category: "保护主牌深度",
    description: "西家黑桃为主牌 8 张，副牌有充足零分杂牌，必须保留全部 8 张黑桃主控，严禁扣主，从副牌选出 4 张杂牌扣入底牌",
    optimalActionDesc: "扣 4 张副牌杂牌保留全主",
    setup: {
      seat: 2,
      trump: "S",
      hand16: [
        "AS", "KS", "QS", "10S", "8S", "6S", "4S", "2S",
        "AH", "8H", "3H",
        "KD", "7D",
        "9C", "6C", "3C"
      ]
    },
    expected: {
      zeroPointsBuried: true,
      trumpsPreserved: true,
      includeCards: ["8H", "3H", "6C", "3C"]
    }
  },
  {
    id: "holdout-bury-west-protect-guarded-queens",
    name: "保留集-扣底-西家保梅花QJ保护张扣4张方块",
    phase: "bury",
    category: "保护将力与控制",
    description: "西家红桃为主牌 6 张，梅花持有 QC, JC, 2C 完整保护，方块为 8D, 7D, 6D, 3D 四张纯杂牌。扣光 4 张方块做绝门且保留梅花保护",
    optimalActionDesc: "扣 3D 6D 7D 8D",
    setup: {
      seat: 2,
      trump: "H",
      hand16: [
        "AH", "KH", "10H", "8H", "6H", "3H",
        "AS", "10S", "5S",
        "QC", "JC", "2C",
        "8D", "7D", "6D", "3D"
      ]
    },
    expected: {
      zeroPointsBuried: true,
      trumpsPreserved: true,
      includeCards: ["3D", "6D", "7D", "8D"],
      minVoidsCreated: 1
    }
  },
  {
    id: "holdout-bury-north-void-single-and-triple",
    name: "保留集-扣底-北家单张黑桃与三张梅花合扣做双绝门",
    phase: "bury",
    category: "双花色绝门组合",
    description: "北家方块为主 6 张，黑桃仅 3S 单张，梅花仅 9C, 7C, 4C 三张，红桃大牌充足。扣除 3S 及三张梅花刚好 4 张，达成双绝门",
    optimalActionDesc: "扣 3S 4C 7C 9C",
    setup: {
      seat: 3,
      trump: "D",
      hand16: [
        "AD", "KD", "10D", "8D", "6D", "4D", "2D",
        "AH", "KH", "10H", "5H", "2H",
        "3S",
        "9C", "7C", "4C"
      ]
    },
    expected: {
      zeroPointsBuried: true,
      trumpsPreserved: true,
      includeCards: ["3S", "4C", "7C", "9C"],
      minVoidsCreated: 2
    }
  },
  {
    id: "holdout-bury-north-eliminate-middle-suit",
    name: "保留集-扣底-北家扣空4张红桃废牌控场",
    phase: "bury",
    category: "拔除中门杂牌",
    description: "北家梅花为主 6 张，手中有 8H, 6H, 4H, 2H 四张纯红桃废牌，方块带 AD, KD, 10D 强力套，扣空红桃四张达到绝对绝门",
    optimalActionDesc: "扣 2H 4H 6H 8H",
    setup: {
      seat: 3,
      trump: "C",
      hand16: [
        "AC", "KC", "10C", "8C", "7C", "3C",
        "KS", "10S", "5S",
        "AD", "KD", "10D",
        "8H", "6H", "4H", "2H"
      ]
    },
    expected: {
      zeroPointsBuried: true,
      trumpsPreserved: true,
      includeCards: ["2H", "4H", "6H", "8H"],
      minVoidsCreated: 1
    }
  }
];

// 16个完全独立、具有不同战术主题的出牌场景
const holdoutPlaying = [
  // --- 东家 (Seat 0) 4 题 ---
  {
    id: "holdout-play-east-lead-cash-side-ace",
    name: "保留集-出牌-东家首发兑现副牌大A抓分",
    phase: "playing",
    category: "领出拔分",
    description: "第 3 轮主牌已被部分清理，东家庄家领出副牌绝对赢张 ♦A 拔分立威，确保底牌分入账",
    optimalActionDesc: "出 ♦A (AD)",
    setup: {
      seat: 0,
      trump: "S",
      declarer: 0,
      bid: 75,
      leader: 0,
      roundNumber: 3,
      currentRound: [],
      declarerPoints: 30,
      defenderPoints: 0,
      ownHand: ["AD", "KD", "8D", "4D", "AC", "10C", "8H", "4H", "KS", "8S"],
      completedRounds: [
        {
          trickNumber: 1,
          winner: 0,
          points: 10,
          cards: [
            { seat: 0, card: "AS" },
            { seat: 1, card: "2S" },
            { seat: 2, card: "3S" },
            { seat: 3, card: "4S" }
          ]
        },
        {
          trickNumber: 2,
          winner: 0,
          points: 20,
          cards: [
            { seat: 0, card: "AH" },
            { seat: 1, card: "2H" },
            { seat: 2, card: "3H" },
            { seat: 3, card: "10H" }
          ]
        }
      ]
    },
    expected: {
      cards: ["AD"]
    }
  },
  {
    id: "holdout-play-east-second-hand-split-honors",
    name: "保留集-出牌-东家第二手面对小牌不出独K",
    phase: "playing",
    category: "第二手走小",
    description: "第 2 轮北家领出红桃小牌 3H，东家作为第二手持 KH, 4H，搭档西家尚未行动，绝不冲动打出孤立的 KH 被下家 A 杀，出 4H 走小",
    optimalActionDesc: "出 4H",
    setup: {
      seat: 0,
      trump: "S",
      declarer: 1,
      bid: 75,
      leader: 3,
      roundNumber: 2,
      currentRound: [{ seat: 3, card: "3H" }],
      declarerPoints: 0,
      defenderPoints: 0,
      ownHand: ["KH", "4H", "AS", "8S", "7S", "QD", "8D", "2D", "KC", "8C", "3C"],
      completedRounds: [
        {
          trickNumber: 1,
          winner: 3,
          points: 0,
          cards: [
            { seat: 1, card: "2S" },
            { seat: 2, card: "3S" },
            { seat: 3, card: "KS" },
            { seat: 0, card: "6S" }
          ]
        }
      ]
    },
    expected: {
      cards: ["4H"]
    }
  },
  {
    id: "holdout-play-east-third-hand-finesse-queen",
    name: "保留集-出牌-东家第三手大Q争墩逼A",
    phase: "playing",
    category: "第三手争大",
    description: "第 3 轮西家搭档领出方块小牌 3D，北家跟 7D，东家作为第三手手持 QD, 4D，必须出 QD 积极争夺牌权或逼出南家大牌",
    optimalActionDesc: "出 QD",
    setup: {
      seat: 0,
      trump: "S",
      declarer: 0,
      bid: 75,
      leader: 2,
      roundNumber: 3,
      currentRound: [
        { seat: 2, card: "3D" },
        { seat: 3, card: "7D" }
      ],
      declarerPoints: 20,
      defenderPoints: 0,
      ownHand: ["QD", "4D", "KS", "10S", "8S", "AH", "8H", "AC", "10C", "6C"],
      completedRounds: [
        {
          trickNumber: 1,
          winner: 0,
          points: 10,
          cards: [
            { seat: 0, card: "AS" },
            { seat: 1, card: "2S" },
            { seat: 2, card: "3S" },
            { seat: 3, card: "4S" }
          ]
        },
        {
          trickNumber: 2,
          winner: 2,
          points: 10,
          cards: [
            { seat: 0, card: "9H" },
            { seat: 1, card: "2H" },
            { seat: 2, card: "KH" },
            { seat: 3, card: "10H" }
          ]
        }
      ]
    },
    expected: {
      cards: ["QD"]
    }
  },
  {
    id: "holdout-play-east-fourth-hand-duck-safe",
    name: "保留集-出牌-东家第四手对手A稳赢绝不送分",
    phase: "playing",
    category: "防守垫牌",
    description: "南家领出主牌 ♠A 稳赢，西家跟 2S，北家跟 4S，东家作为第四手持 ♠10, ♠5, ♠2，必须出 ♠2 绝不主动向对手送分",
    optimalActionDesc: "出 2S",
    setup: {
      seat: 0,
      trump: "S",
      declarer: 1,
      bid: 80,
      leader: 1,
      roundNumber: 1,
      currentRound: [
        { seat: 1, card: "AS" },
        { seat: 2, card: "3S" },
        { seat: 3, card: "4S" }
      ],
      declarerPoints: 0,
      defenderPoints: 0,
      ownHand: ["10S", "5S", "2S", "KH", "8H", "3H", "AD", "8D", "4D", "KC", "8C", "3C"],
      completedRounds: []
    },
    expected: {
      cards: ["2S"]
    }
  },

  // --- 南家 (Seat 1) 4 题 ---
  {
    id: "holdout-play-south-lead-cash-queen-master",
    name: "保留集-出牌-南家领出升级为最大主的Q兑现",
    phase: "playing",
    category: "兑现大牌",
    description: "第 4 轮主牌 A 与 K 均已出过，南家手中 ♠Q 成为全场最大控制牌，领出 ♠Q 清除敌方残余主牌",
    optimalActionDesc: "出 ♠Q (QS)",
    setup: {
      seat: 1,
      trump: "S",
      declarer: 1,
      bid: 75,
      leader: 1,
      roundNumber: 4,
      currentRound: [],
      declarerPoints: 35,
      defenderPoints: 0,
      ownHand: ["QS", "8S", "AH", "9H", "3H", "KD", "8D", "2D", "AC"],
      completedRounds: [
        {
          trickNumber: 1,
          winner: 1,
          points: 10,
          cards: [
            { seat: 1, card: "AS" },
            { seat: 2, card: "2S" },
            { seat: 3, card: "3S" },
            { seat: 0, card: "4S" }
          ]
        },
        {
          trickNumber: 2,
          winner: 1,
          points: 5,
          cards: [
            { seat: 1, card: "KS" },
            { seat: 2, card: "7S" },
            { seat: 3, card: "6S" },
            { seat: 0, card: "5S" }
          ]
        },
        {
          trickNumber: 3,
          winner: 1,
          points: 20,
          cards: [
            { seat: 1, card: "10S" },
            { seat: 2, card: "2C" },
            { seat: 3, card: "10C" },
            { seat: 0, card: "2H" }
          ]
        }
      ]
    },
    expected: {
      cards: ["QS"]
    }
  },
  {
    id: "holdout-play-south-second-hand-cover-honor",
    name: "保留集-出牌-南家第二手以大K盖Q防偷渡",
    phase: "playing",
    category: "第二手盖大",
    description: "东家庄家领出方块 QD 企图偷过，南家作为第二手持有 KD, 2D，必须盖出 KD 逼出庄家或争夺控制，绝不能让 QD 便宜溜过",
    optimalActionDesc: "出 KD",
    setup: {
      seat: 1,
      trump: "S",
      declarer: 0,
      bid: 75,
      leader: 0,
      roundNumber: 2,
      currentRound: [{ seat: 0, card: "QD" }],
      declarerPoints: 10,
      defenderPoints: 0,
      ownHand: ["KD", "2D", "JS", "8S", "AH", "8H", "4H", "KC", "9C", "6C", "3C"],
      completedRounds: [
        {
          trickNumber: 1,
          winner: 0,
          points: 10,
          cards: [
            { seat: 0, card: "AS" },
            { seat: 1, card: "2S" },
            { seat: 2, card: "3S" },
            { seat: 3, card: "4S" }
          ]
        }
      ]
    },
    expected: {
      cards: ["KD"]
    }
  },
  {
    id: "holdout-play-south-third-hand-guaranteed-feed",
    name: "保留集-出牌-南家第三手搭档稳赢喂分10",
    phase: "playing",
    category: "搭档稳赢喂分",
    description: "北家搭档领出主牌 ♠A，东家跟 ♠2，南家为第三手持 ♠10, ♠5, ♠3，搭档出主牌 A 已绝对稳赢，南家安全喂出 ♠10",
    optimalActionDesc: "出 10S",
    setup: {
      seat: 1,
      trump: "S",
      declarer: 3,
      bid: 75,
      leader: 3,
      roundNumber: 1,
      currentRound: [
        { seat: 3, card: "AS" },
        { seat: 0, card: "2S" }
      ],
      declarerPoints: 0,
      defenderPoints: 0,
      ownHand: ["10S", "5S", "3S", "AH", "9H", "4H", "KD", "8D", "AC", "8C", "4C", "2C"],
      completedRounds: []
    },
    expected: {
      cards: ["10S"]
    }
  },
  {
    id: "holdout-play-south-fourth-hand-ruff-high-threat",
    name: "保留集-出牌-南家第四手绝门用主牌截杀15分高分墩",
    phase: "playing",
    category: "绝门毙杀",
    description: "西家领出 10H，北家跟 5H，东家出 4H，池内已有 15 分，南家红桃绝门持小主 ♠8 与 ♠3，用小主 ♠3 毙杀将 15 分收归己方",
    optimalActionDesc: "出 3S",
    setup: {
      seat: 1,
      trump: "S",
      declarer: 0,
      bid: 75,
      leader: 2,
      roundNumber: 2,
      currentRound: [
        { seat: 2, card: "10H" },
        { seat: 3, card: "5H" },
        { seat: 0, card: "4H" }
      ],
      declarerPoints: 10,
      defenderPoints: 0,
      ownHand: ["8S", "3S", "AD", "KD", "8D", "4D", "10C", "8C", "6C", "5C", "7C"],
      completedRounds: [
        {
          trickNumber: 1,
          winner: 2,
          points: 10,
          cards: [
            { seat: 0, card: "2C" },
            { seat: 1, card: "3C" },
            { seat: 2, card: "AC" },
            { seat: 3, card: "4C" }
          ]
        }
      ]
    },
    expected: {
      cards: ["3S", "8S"]
    }
  },

  // --- 西家 (Seat 2) 4 题 ---
  {
    id: "holdout-play-west-lead-trump-exit",
    name: "保留集-出牌-西家安全脱手打出中性小主牌",
    phase: "playing",
    category: "安全脱手",
    description: "第 3 轮西家无好牌可出，副牌出危险牌容易送分，打出零分小主 3S 安全脱手转移牌权",
    optimalActionDesc: "出 3S",
    setup: {
      seat: 2,
      trump: "S",
      declarer: 0,
      bid: 75,
      leader: 2,
      roundNumber: 3,
      currentRound: [],
      declarerPoints: 30,
      defenderPoints: 0,
      ownHand: ["4S", "5S", "8H", "4H", "10D", "8D", "2D", "10C", "7C", "4C"],
      completedRounds: [
        {
          trickNumber: 1,
          winner: 2,
          points: 10,
          cards: [
            { seat: 0, card: "2S" },
            { seat: 1, card: "3S" },
            { seat: 2, card: "AS" },
            { seat: 3, card: "7S" }
          ]
        },
        {
          trickNumber: 2,
          winner: 2,
          points: 20,
          cards: [
            { seat: 2, card: "AH" },
            { seat: 3, card: "2H" },
            { seat: 0, card: "3H" },
            { seat: 1, card: "10H" }
          ]
        }
      ]
    },
    expected: {
      cards: ["4S", "5S"]
    }
  },
  {
    id: "holdout-play-west-second-hand-fly-ace-capture",
    name: "保留集-出牌-西家第二手飞A捕杀对手出牌的K",
    phase: "playing",
    category: "飞A抓大牌",
    description: "南家领出方块 KD (分牌 10 分)，西家持有 AD, 3D，立即飞出 AD 夺下关键 10 分并拿下首攻权",
    optimalActionDesc: "出 AD",
    setup: {
      seat: 2,
      trump: "S",
      declarer: 1,
      bid: 75,
      leader: 1,
      roundNumber: 2,
      currentRound: [{ seat: 1, card: "KD" }],
      declarerPoints: 10,
      defenderPoints: 0,
      ownHand: ["AD", "3D", "QS", "KS", "8S", "AH", "9H", "3H", "AC", "8C", "2C"],
      completedRounds: [
        {
          trickNumber: 1,
          winner: 1,
          points: 10,
          cards: [
            { seat: 1, card: "AS" },
            { seat: 2, card: "2S" },
            { seat: 3, card: "3S" },
            { seat: 0, card: "4S" }
          ]
        }
      ]
    },
    expected: {
      cards: ["AD"]
    }
  },
  {
    id: "holdout-play-west-third-hand-partner-winning-preserve",
    name: "保留集-出牌-西家第三手搭档已大出小牌保K",
    phase: "playing",
    category: "保大牌控制",
    description: "东家搭档领出红桃 AH，南家跟 4H，西家手持 KH, 2H，搭档 AH 已经稳赢，西家绝不出 KH 撞车，出 2H 保留 KH 后续控制",
    optimalActionDesc: "出 2H",
    setup: {
      seat: 2,
      trump: "S",
      declarer: 0,
      bid: 75,
      leader: 0,
      roundNumber: 2,
      currentRound: [
        { seat: 0, card: "AH" },
        { seat: 1, card: "4H" }
      ],
      declarerPoints: 10,
      defenderPoints: 0,
      ownHand: ["KH", "2H", "KS", "10S", "8S", "4S", "AD", "8D", "4D", "AC", "8C"],
      completedRounds: [
        {
          trickNumber: 1,
          winner: 0,
          points: 10,
          cards: [
            { seat: 0, card: "AS" },
            { seat: 1, card: "2S" },
            { seat: 2, card: "3S" },
            { seat: 3, card: "7S" }
          ]
        }
      ]
    },
    expected: {
      cards: ["2H"]
    }
  },
  {
    "id": "holdout-play-west-fourth-hand-discard-garbage",
    "name": "保留集-出牌-西家第四手将吃抢分",
    "phase": "playing",
    "category": "将吃抢分",
    "description": "北家领9C，东家跟2C，南家AC暂时领先。西家草花绝门，第四手可用任意一张手中主牌确定赢下含10分的该墩；优先用7S节省大主，其他赢墩主牌也接受。",
    "optimalActionDesc": "用主牌将吃，优先7S",
    "setup": {
      "seat": 2,
      "trump": "S",
      "declarer": 3,
      "bid": 75,
      "leader": 3,
      "roundNumber": 2,
      "currentRound": [
        {
          "seat": 3,
          "card": "9C"
        },
        {
          "seat": 0,
          "card": "2C"
        },
        {
          "seat": 1,
          "card": "AC"
        }
      ],
      "declarerPoints": 10,
      "defenderPoints": 0,
      "ownHand": [
        "2D",
        "4D",
        "8D",
        "QS",
        "KS",
        "8S",
        "7S",
        "AH",
        "9H",
        "6H",
        "3H"
      ],
      "completedRounds": [
        {
          "trickNumber": 1,
          "winner": 3,
          "points": 10,
          "cards": [
            {
              "seat": 3,
              "card": "AS"
            },
            {
              "seat": 0,
              "card": "2S"
            },
            {
              "seat": 1,
              "card": "3S"
            },
            {
              "seat": 2,
              "card": "4S"
            }
          ]
        }
      ]
    },
    "expected": {
      "cards": [
        "7S",
        "8S",
        "QS",
        "KS"
      ]
    }
  },

  // --- 北家 (Seat 3) 4 题 ---
  {
    "id": "holdout-play-north-lead-attack-short-suit",
    "name": "保留集-出牌-北家敌主已清兑现副牌A",
    "phase": "playing",
    "category": "兑现赢张",
    "description": "第3轮北家领出，前两轮已打出8张主牌，其余5张主牌都在自己手中。敌方已无主牌，红桃A与草花A均为公开可证明的赢张，可安全兑现10分；不依赖未知的搭档缺门或剩余主牌。",
    "optimalActionDesc": "出 AH 或 AC 兑现10分",
    "setup": {
      "seat": 3,
      "trump": "S",
      "declarer": 3,
      "bid": 75,
      "leader": 3,
      "roundNumber": 3,
      "currentRound": [],
      "declarerPoints": 25,
      "defenderPoints": 0,
      "ownHand": [
        "KS",
        "QS",
        "JS",
        "9S",
        "8S",
        "AH",
        "9H",
        "AC",
        "10C",
        "3D"
      ],
      "completedRounds": [
        {
          "trickNumber": 1,
          "winner": 3,
          "points": 10,
          "cards": [
            {
              "seat": 3,
              "card": "AS"
            },
            {
              "seat": 0,
              "card": "2S"
            },
            {
              "seat": 1,
              "card": "3S"
            },
            {
              "seat": 2,
              "card": "4S"
            }
          ]
        },
        {
          "trickNumber": 2,
          "winner": 3,
          "points": 15,
          "cards": [
            {
              "seat": 3,
              "card": "10S"
            },
            {
              "seat": 0,
              "card": "7S"
            },
            {
              "seat": 1,
              "card": "6S"
            },
            {
              "seat": 2,
              "card": "5S"
            }
          ]
        }
      ]
    },
    "expected": {
      "cards": [
        "AH",
        "AC"
      ]
    }
  },
  {
    id: "holdout-play-north-second-hand-duck-tenace",
    name: "保留集-出牌-北家第二手持AQ飞张放小牌",
    phase: "playing",
    category: "飞张放小",
    description: "西家领出红桃小牌 4H，北家第二手手握 AH, QH, 2H 完美叉子，出 2H 飞牌埋伏下家东家的大K",
    optimalActionDesc: "出 2H",
    setup: {
      seat: 3,
      trump: "S",
      declarer: 0,
      bid: 75,
      leader: 2,
      roundNumber: 2,
      currentRound: [{ seat: 2, card: "4H" }],
      declarerPoints: 10,
      defenderPoints: 0,
      ownHand: ["2H", "AH", "QH", "KS", "8S", "3S", "AD", "8D", "4D", "KC", "8C"],
      completedRounds: [
        {
          trickNumber: 1,
          winner: 2,
          points: 10,
          cards: [
            { seat: 2, card: "AS" },
            { seat: 3, card: "6S" },
            { seat: 0, card: "4S" },
            { seat: 1, card: "2S" }
          ]
        }
      ]
    },
    expected: {
      cards: ["2H"]
    }
  },
  {
    id: "holdout-play-north-third-hand-force-ace",
    name: "保留集-出牌-北家第三手出大K强行逼A",
    phase: "playing",
    category: "逼出敌方大牌",
    description: "南家搭档领出方块 10D，西家出 4D，北家第三手持 KD, 3D，必须打出 KD 强行争夺或逼出东家 AD",
    optimalActionDesc: "出 KD",
    setup: {
      seat: 3,
      trump: "S",
      declarer: 3,
      bid: 75,
      leader: 1,
      roundNumber: 2,
      currentRound: [
        { seat: 1, card: "10D" },
        { seat: 2, card: "4D" }
      ],
      declarerPoints: 10,
      defenderPoints: 0,
      ownHand: ["KD", "3D", "AS", "8S", "4S", "AH", "9H", "3H", "AC", "10C", "6C"],
      completedRounds: [
        {
          trickNumber: 1,
          winner: 1,
          points: 10,
          cards: [
            { seat: 1, card: "KS" },
            { seat: 2, card: "3S" },
            { seat: 3, card: "2S" },
            { seat: 0, card: "10S" }
          ]
        }
      ]
    },
    expected: {
      cards: ["KD"]
    }
  },
  {
    id: "holdout-play-north-fourth-hand-overruff",
    name: "保留集-出牌-北家第四手大主超杀抢回15分",
    phase: "playing",
    category: "大主超毙",
    description: "东家领出 10H，南家跟 5H，西家方块绝门用小主 ♠6 毙杀企图夺分，北家第四手持 ♠Q 与 ♠3，必须用 ♠Q 超毙将 15 分收归己方",
    optimalActionDesc: "出 QS",
    setup: {
      seat: 3,
      trump: "S",
      declarer: 0,
      bid: 75,
      leader: 0,
      roundNumber: 2,
      currentRound: [
        { seat: 0, card: "10H" },
        { seat: 1, card: "5H" },
        { seat: 2, card: "6S" }
      ],
      declarerPoints: 10,
      defenderPoints: 0,
      ownHand: ["QS", "3S", "AD", "8D", "4D", "2D", "AC", "10C", "8C", "4C", "2C"],
      completedRounds: [
        {
          trickNumber: 1,
          winner: 0,
          points: 10,
          cards: [
            { seat: 0, card: "AS" },
            { seat: 1, card: "2S" },
            { seat: 2, card: "7S" },
            { seat: 3, card: "4S" }
          ]
        }
      ]
    },
    expected: {
      cards: ["QS"]
    }
  }
];

console.log("Validating scenarios...");

// 验证叫分
holdoutBidding.forEach(s => {
  if (s.setup.hand.length !== 12) throw new Error(`${s.id} hand !== 12`);
});

// 验证定主
holdoutTrump.forEach(s => {
  if (s.setup.hand.length !== 12) throw new Error(`${s.id} hand !== 12`);
});

// 验证扣底
holdoutBury.forEach(s => {
  if (s.setup.hand16.length !== 16) throw new Error(`${s.id} hand16 !== 16`);
});

// 验证全部 40 组场景通过 schema 与物理守恒检验
const allHoldout = [...holdoutBidding, ...holdoutTrump, ...holdoutBury, ...holdoutPlaying];
loadScenarios(allHoldout as any);

console.log("All 40 scenarios passed physical validation!");

// 检查规范型互斥
const devKeys = new Map<string, string>();
ALL_BENCHMARK_SCENARIOS.forEach(s => {
  devKeys.set(getScenarioCanonicalKey(s), s.id);
});

const crossDuplicates: Array<{ holdoutId: string; devId: string | undefined }> = [];
allHoldout.forEach(h => {
  const k = getScenarioCanonicalKey(h as any);
  if (devKeys.has(k)) {
    crossDuplicates.push({ holdoutId: h.id, devId: devKeys.get(k) });
  }
});

console.log("Cross duplicates with dev:", crossDuplicates);

// 检查保留集内部唯一性
for (const [name, list] of [
  ["bidding", holdoutBidding],
  ["trump", holdoutTrump],
  ["bury", holdoutBury],
  ["playing", holdoutPlaying]
] as const) {
  const keys = new Set(list.map(s => getScenarioCanonicalKey(s as any)));
  console.log(`Holdout ${name} unique canonical keys: ${keys.size} / ${list.length}`);
  if (keys.size !== list.length) {
    throw new Error(`Holdout ${name} has duplicates internally!`);
  }
}

if (crossDuplicates.length === 0) {
  console.log("Writing to data/evaluation/holdout/*.json...");
  const baseDir = path.resolve(process.cwd(), "data/evaluation/holdout");
  fs.writeFileSync(path.join(baseDir, "bidding.json"), JSON.stringify(holdoutBidding, null, 2) + "\n");
  fs.writeFileSync(path.join(baseDir, "trump.json"), JSON.stringify(holdoutTrump, null, 2) + "\n");
  fs.writeFileSync(path.join(baseDir, "bury.json"), JSON.stringify(holdoutBury, null, 2) + "\n");
  fs.writeFileSync(path.join(baseDir, "playing.json"), JSON.stringify(holdoutPlaying, null, 2) + "\n");
  console.log("Done!");
} else {
  console.error("Cross duplicates found, not writing!");
}
