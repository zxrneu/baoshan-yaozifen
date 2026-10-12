/**
 * LLM 提示词与上下文构造服务 (SOLID - SRP 原则)。
 * 分开表达规则、可见事实与策略建议，预计算牌张统计和当前墩状态。
 * thinking 字段只要求简短决策依据，不要求输出内部推理过程。
 */
import {
  Card,
  cardId,
  cardLabel,
  cardPoints,
  groupCardsBySuit,
  analyzeHandFeatures,
  sortHand,
  SUITS,
  SUIT_SYMBOL,
  SUIT_NAME,
  Suit,
} from '../../../cards';
import { partnerOf, sideOf, SEAT_NAMES, trickWinner, beats } from '../../../engine';
import { isPartnerGuaranteedWinning, unseenCards } from '../../tactics';
import { PlayerObservation } from '../../optimized/contracts';
import { BiddingObservation, TrumpObservation, BuryObservation } from '../../decisionObservation';
import { bidFromObservation } from '../../smart';

export interface TeamSeatInfo {
  mySeat: number;
  mySeatName: string;
  partnerSeat: number;
  partnerSeatName: string;
  opponentSeats: number[];
  opponentSeatNames: string[];
  relationship: string;
}

export function getTeamPayload(seat: number): TeamSeatInfo {
  const partner = partnerOf(seat);
  const mySide = sideOf(seat);
  const opponents = [0, 1, 2, 3].filter((s) => sideOf(s) !== mySide);
  return {
    mySeat: seat,
    mySeatName: SEAT_NAMES[seat],
    partnerSeat: partner,
    partnerSeatName: SEAT_NAMES[partner],
    opponentSeats: opponents,
    opponentSeatNames: opponents.map((s) => SEAT_NAMES[s]),
    relationship: `${SEAT_NAMES[seat]}与${SEAT_NAMES[partner]}为同一阵营（搭档），对抗${opponents.map((s) => SEAT_NAMES[s]).join('与')}（对手）`,
  };
}

/** 记录在请求正文中，便于追溯提示词变更；评测仍以源码指纹隔离。 */
export const LLM_PROMPT_VERSION = '2.0.0';

/** 所有阶段共用规则；策略建议不能覆盖合法动作与可见事实。 */
export const SYSTEM_PROMPT_CORE_BASE = `你负责云南保山幺子分的单次决策，目标是帮助本方赢副。输入 JSON 是当前可见局面。

【规则与信息边界】
- 一副 52 张标准扑克，无大小王；四人隔座搭档，东西对南北。
- A=10分、10=10分、5=5分，其他牌=0分；每门25分，全副100分。分值不等于牌力；同门 A>K>Q>J>10>9>8>7>6>5>4>3>2。
- 各发12张、留4张底牌；叫分70至100、每档5分，可Pass；庄家先定主，再拿底扣4张非分牌。
- 有领出花色必须跟牌；缺门可垫任意牌或用主牌将吃，没有强制将吃/超毙。主牌压副牌，其他副牌不能压领出门。
- 每墩赢家吃分并领出下一墩。庄家方得分达到叫分即胜，闲家方达到105减叫分即胜；完成一墩后可提前结算。扣底不允许分牌，因此本规则底分为0。
- 叫满 100 分并扣底后，庄家搭档手牌才公开；叫分时不能预知搭档或底牌。只能使用输入中的本人手牌、公开历史、已知绝门与规则明牌，推测不能写成事实。

【返回约定】
只返回一个 JSON 对象，不加 Markdown 或 JSON 外文字。动作字段先写，严格使用给定合法集合；cardId 为点数加花色（如 AS、10D），花色 S/H/C/D。不要复述输入局面；thinking 仅写一句决策依据，conclusion 简述同一动作，不展开推演或自查字数。`;

const BIDDING_GUIDANCE = `【叫分：成局风险优先】
- bid 只能是 legalBids 中的整数或 null；null 表示Pass。legalBids 只是规则允许，不表示牌力足够。手牌分值和HCP都不是最终吃分预测。
- 标准五张套有A/K控制和一定基础分时，优先从70/75考虑；有六七张长套并带控制张/副牌A，可低分破格起叫。长套不保证清空余主，不能仅凭长度升到90。
- 起叫和再叫分开：无竞价压力时，基础长套手选择70/75，不因争庄意愿跳至80以上。
- 强主长套带连续顶张、并有多个副牌A时，应考虑85至95的强牌档，不要把所有未知局面都压成70/75；高叫须来自额外控制与赢张，而不是单看自带分。100要求极强控制且几乎不能丢分，不能只为获得搭档明牌而叫满。
- 无长套、无A控制或四门均匀时应认真考虑Pass；即使很多10/5或K/Q，也可能缺乏拿墩能力。均匀牌型不是规则禁止起叫，但不要仅凭自带分/高HCP争庄。
- 竞叫/再叫独立评估新合同；只为超过对手而抬价不可取。如果最低合法档已超过可承担风险，Pass。
- 副牌短门可提供扣空潜力，但拿底可能补长该门，分牌不能扣，短门不保证将吃成功。不要把潜力当成已完成的绝门。
- bidAdvice 若存在，只是未校准启发式参考，可忽略；不得照抄 suggestedBid。最终以实际牌型、控制张和合同风险决定。
返回字段：bid、thinking、conclusion。`;

const TRUMP_GUIDANCE = `【定主：长度与控制共同判断】
- trump 从 options 中选择。先比较各门长度与A/K/Q/J的连续控制，再考虑副牌分牌保护与扣空潜力；suitsSummary 的 points 不是主牌控制分；topRunFromAce 是从A起连续持有的顶张数，只统计到10。
- 同长时通常选控制更完整的套。长度仅差一张时，坚固的AKQJ套可能优于全小牌长套；六七张套仍可有长度优势，不机械只看A或只选最长。
- 避免把仅有一两张高分牌的短门定主；四张强套也可以定主，不要求一定五张。未知底牌不能视作必然补强。
返回字段：trump、thinking、conclusion。`;

const BURY_GUIDANCE = `【扣底：合法组合与控制保护】
- cards 必须是 candidates 中恰好4个不同cardId。A/10/5不能扣；K/Q/J虽合法，仍可能是控制张，不能当普通废牌。
- 副牌足够扣4张且能保留控制时，优先保留全部主牌，不为留下副牌废牌而扣主牌Q或小主。有替代组合时保护副牌K、AQ及其垫张；不要只扣高牌保护张造成单K，也不要为造绝门自动扣掉整门控制张。
- 扣空副牌可争取将吃机会；也可以扣空恰好四张的无控废牌长门。比较整套组合扣后结构，兼顾绝门、余主和控制，不能机械只扣最短门。
- candidatesBySuit 的 canFormVoid 只说明该门可在4张额度内扣空；已有绝门不算新创造，存在K/Q等大牌的机会未必值得采用。voidCreationAdvice 是结构提示，不是必须执行的动作。
返回字段：cards、thinking、conclusion；conclusion 所列牌必须与 cards 一致。`;

const PLAY_GUIDANCE = `【出牌：真实赢家与后手风险】
- cardId 必须来自 candidates；候选已按规则校验。current_trick_status 描述当前墩；候选的 winnerIfPlayed 只表示出这张后当前赢家，不保证后手不能超车。
- isPartnerCurrentlyWinning 仅是当前领先。isPartnerGuaranteedWinning 为true且有分牌候选时，优先喂能安全入账的最大分牌（10分优先于5分），不要为了保留自己10/5而走0分牌；没有可喂分牌才走小保K/Q。超车拿领出权须有收益。
- 先查看候选winnerIfPlayed：有候选能改成己方领先，就不能把“对手当前领先”说成“无法争墩”。对手真正稳赢时尽量不送分；有价值的分墩用最低成本赢张将吃/超毙。
- 第二手面对对手领出小副牌，有低牌时通常走小，让第四手搭档处理，不因K能暂时压小牌就冲K。第三手搭档领出且尚未赢墩时，用足够大的低成本牌争大；第四手比较真实赢家和池分。合同将锁定等具体收益可改变这些经验。
- 领牌时比较清主、兑现已升高副牌与搭档配合。庄家主牌优势可拔大清主，主牌已受控时优先考虑可兑现副牌A/已升高K，别拿未升高K/Q替代确定顶张。isHighestRemainingInSuit 仅表示该门无更高未出牌，不排除将吃；搭档绝门也不证明还持主牌。
- revealed_hand 明确公开手牌的座位及阵营，可能属于对手。remaining_points_tracker 是全副未出分牌数，包含本人/公开手牌，不能全当作对手持有。优先赢合同，别为多吃无关分增加丢局风险。
返回字段：cardId、thinking、conclusion；confidence 可选，若提供须在0到1之间。`;

export const SYSTEM_PROMPT_BIDDING = `${SYSTEM_PROMPT_CORE_BASE}

${BIDDING_GUIDANCE}`;
export const SYSTEM_PROMPT_TRUMP = `${SYSTEM_PROMPT_CORE_BASE}

${TRUMP_GUIDANCE}`;
export const SYSTEM_PROMPT_BURY = `${SYSTEM_PROMPT_CORE_BASE}

${BURY_GUIDANCE}`;
export const SYSTEM_PROMPT_PLAY = `${SYSTEM_PROMPT_CORE_BASE}

${PLAY_GUIDANCE}`;

/** 兼容旧入口，复用相同阶段指引，避免维护两套矛盾策略。 */
export const SYSTEM_PROMPT_CORE = `${SYSTEM_PROMPT_CORE_BASE}

按输入phase应用对应指引：
${BIDDING_GUIDANCE}

${TRUMP_GUIDANCE}

${BURY_GUIDANCE}

${PLAY_GUIDANCE}`;

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

/**
 * LLM 提示词组装服务 (符合单一职责原则)
 */
export class LlmPromptBuilder {
  /**
   * 组装叫分阶段的消息列表 (含有序理牌、分花色分组与特征预计算)
   */
  static buildBiddingMessages(
    observation: BiddingObservation,
    options?: { disableBidAdvice?: boolean },
  ): ChatMessage[] {
    const { seat, ownHand: rawHand } = observation;
    const sortedHand = sortHand(rawHand);
    const handBySuit = groupCardsBySuit(sortedHand);
    const handSummary = analyzeHandFeatures(sortedHand);

    const bidHistory = observation.bidHistory.map((b) => ({
      seat: b.seat,
      seatName: SEAT_NAMES[b.seat],
      bid: b.bid === null ? '不叫(Pass)' : `${b.bid}分`,
    }));

    // 保留可选参考，但不把启发式分数伪装成最终吃分或强制起叫建议。
    const bidAdvice = options?.disableBidAdvice ? undefined : {
      source: 'heuristic',
      suggestedBid: handSummary.hasLongSuit ? bidFromObservation(observation) : null,
      note: '未校准参考，可能过高或过低；结合牌型与合同风险独立决定，可选择不同档位或Pass。',
    };

    const userPayload = {
      phase: 'bidding',
      promptVersion: LLM_PROMPT_VERSION,
      seat,
      seatName: SEAT_NAMES[seat],
      team: getTeamPayload(seat),
      // 保留手牌有序列表，保持 100% 向后兼容
      hand: sortedHand.map((c) => cardLabel(c)),
      // 结构化花色分组，免除 LLM 检索与挑牌
      handBySuit: {
        '♠黑桃': { cards: handBySuit.S.labels, count: handBySuit.S.count, points: handBySuit.S.points, honors: handBySuit.S.honors },
        '♥红桃': { cards: handBySuit.H.labels, count: handBySuit.H.count, points: handBySuit.H.points, honors: handBySuit.H.honors },
        '♣梅花': { cards: handBySuit.C.labels, count: handBySuit.C.count, points: handBySuit.C.points, honors: handBySuit.C.honors },
        '♦方块': { cards: handBySuit.D.labels, count: handBySuit.D.count, points: handBySuit.D.points, honors: handBySuit.D.honors },
      },
      // 特征快照，省去初等算术心算与统计
      handSummary: {
        totalPoints: handSummary.totalPoints,
        pointCards: handSummary.pointCards,
        suitCounts: handSummary.suitCounts,
        longestSuit: `${handSummary.longestSuit.symbol}${handSummary.longestSuit.name} (${handSummary.longestSuit.count}张)`,
        hasLongSuit: handSummary.hasLongSuit,
        hcp: handSummary.hcp,
        controlsCount: handSummary.controlsCount,
        shortSuits: handSummary.shortSuits.map((s) => `${s.symbol}${s.name}(${s.count}张)`),
      },
      // 消融时移除整个建议对象，保留同样的客观手牌特征。
      ...(bidAdvice ? { bidAdvice } : {}),
      highestBid: observation.highestBid > 0 ? observation.highestBid : null,
      highestBidder: observation.highestBidder !== null ? SEAT_NAMES[observation.highestBidder] : null,
      legalBids: observation.legalBids,
      bidHistory,
    };


    return [
      { role: 'system', content: SYSTEM_PROMPT_BIDDING },
      { role: 'user', content: JSON.stringify(userPayload) },
    ];
  }

  /**
   * 组装定主阶段的消息列表 (含排序、花色长度与连续顶张事实)
   */
  static buildTrumpMessages(observation: TrumpObservation): ChatMessage[] {
    const { seat, ownHand: rawHand } = observation;
    const sortedHand = sortHand(rawHand);
    const handBySuit = groupCardsBySuit(sortedHand);
    const handSummary = analyzeHandFeatures(sortedHand);

    const suitsSummary: Record<string, {
      count: number;
      labels: string[];
      points: number;
      hasA: boolean;
      hasK: boolean;
      honors: string[];
      topRunFromAce: number;
    }> = {};

    for (const suit of SUITS) {
      const g = handBySuit[suit];
      const topRanks = ['A', 'K', 'Q', 'J', '10'];
      const firstMissing = topRanks.findIndex(rank => !g.cards.some(card => card.rank === rank));
      const topRunFromAce = firstMissing < 0 ? topRanks.length : firstMissing;
      suitsSummary[suit] = {
        count: g.count,
        labels: g.labels,
        points: g.points,
        hasA: g.honors.includes('A'),
        hasK: g.honors.includes('K'),
        honors: g.honors,
        topRunFromAce,
      };
    }

    const userPayload = {
      phase: 'trump',
      promptVersion: LLM_PROMPT_VERSION,
      seat,
      seatName: SEAT_NAMES[seat],
      team: getTeamPayload(seat),
      winningBid: observation.winningBid,
      hand: sortedHand.map((c) => cardLabel(c)),
      handBySuit: {
        '♠黑桃': { cards: handBySuit.S.labels, count: handBySuit.S.count, points: handBySuit.S.points },
        '♥红桃': { cards: handBySuit.H.labels, count: handBySuit.H.count, points: handBySuit.H.points },
        '♣梅花': { cards: handBySuit.C.labels, count: handBySuit.C.count, points: handBySuit.C.points },
        '♦方块': { cards: handBySuit.D.labels, count: handBySuit.D.count, points: handBySuit.D.points },
      },
      handSummary: {
        longestSuit: `${handSummary.longestSuit.symbol}${handSummary.longestSuit.name} (${handSummary.longestSuit.count}张)`,
        totalPoints: handSummary.totalPoints,
        hcp: handSummary.hcp,
      },
      suitsSummary,
      options: ['S', 'H', 'C', 'D'],
    };

    return [
      { role: 'system', content: SYSTEM_PROMPT_TRUMP },
      { role: 'user', content: JSON.stringify(userPayload) },
    ];
  }

  /**
   * 组装扣底阶段的消息列表 (含排序、副牌短门绝门潜质标记与保主提示)
   */
  static buildBuryMessages(observation: BuryObservation): ChatMessage[] {
    const { seat, ownHand: rawHand } = observation;
    const sortedHand = sortHand(rawHand);
    const nonPointCards = sortHand(rawHand.filter((c) => cardPoints(c) === 0));
    const pointCards = sortHand(rawHand.filter((c) => cardPoints(c) > 0));

    // 按花色对可扣候选牌分组并分析绝门潜质
    const candidatesBySuit: Record<string, {
      suit: Suit;
      isTrump: boolean;
      totalCardsInSuit: number;
      candidateCards: Array<{ cardId: string; label: string; rank: string }>;
      canFormVoid: boolean;
      alreadyVoid: boolean;
      controlCards: string[];
    }> = {};

    for (const suit of SUITS) {
      const allInSuit = sortedHand.filter((c) => c.suit === suit);
      const candidatesInSuit = nonPointCards.filter((c) => c.suit === suit);
      const pointsInSuit = pointCards.filter((c) => c.suit === suit);
      const isTrump = suit === observation.trump;
      const canFormVoid = !isTrump && allInSuit.length > 0 && allInSuit.length <= 4
        && pointsInSuit.length === 0;

      candidatesBySuit[suit] = {
        suit,
        isTrump,
        totalCardsInSuit: allInSuit.length,
        candidateCards: candidatesInSuit.map((c) => ({ cardId: cardId(c), label: cardLabel(c), rank: c.rank })),
        canFormVoid,
        alreadyVoid: allInSuit.length === 0,
        controlCards: allInSuit.filter(c => ['A', 'K', 'Q', 'J'].includes(c.rank)).map(cardId),
      };
    }

    const voidOpportunities = Object.entries(candidatesBySuit)
      .filter(([_, v]) => v.canFormVoid)
      .map(([_, v]) => `${SUIT_SYMBOL[v.suit]}${SUIT_NAME[v.suit]}: 扣空需${v.candidateCards.length}张额度${v.controlCards.length ? `，会失去控制张${v.controlCards.join('/')}` : '，无A/K/Q/J控制张'}；是否值得取决于扣后结构。`);

    const userPayload = {
      phase: 'bury',
      promptVersion: LLM_PROMPT_VERSION,
      seat,
      seatName: SEAT_NAMES[seat],
      team: getTeamPayload(seat),
      trump: observation.trump,
      hand_16: sortedHand.map((c) => cardLabel(c)),
      pointCardsMustKeep: pointCards.map(cardId),
      candidates: nonPointCards.map((c) => ({
        cardId: cardId(c),
        label: cardLabel(c),
        suit: c.suit,
        rank: c.rank,
      })),
      candidatesBySuit,
      voidCreationAdvice: voidOpportunities.length > 0
        ? voidOpportunities
        : ['没有可用4张额度直接扣空的副牌门；比较合法组合，通常保主并保护副牌控制张。'],
      rule: '从 candidates 选4个不同cardId，分牌不能扣；保主和留控是策略取舍。',
    };

    return [
      { role: 'system', content: SYSTEM_PROMPT_BURY },
      { role: 'user', content: JSON.stringify(userPayload) },
    ];
  }

  /**
   * 组装出牌阶段的消息列表 (含排序、当前墩胜负/累积分、牌池分牌监控)
   */
  static buildPlayMessages(
    observation: PlayerObservation,
    candidates: readonly Card[],
  ): ChatMessage[] {
    const sortedHand = sortHand(observation.ownHand);
    const sortedCandidates = sortHand(candidates);
    const handBySuit = groupCardsBySuit(sortedHand);

    const currentRound = observation.currentRound ?? [];
    const currentBest = currentRound.length ? trickWinner([...currentRound], observation.trump) : null;
    const currentWinningSeat = currentBest?.seat ?? null;
    const pointsInCurrentTrick = currentRound.reduce((sum, entry) => sum + cardPoints(entry.card), 0);
    const isPartnerWinning = currentWinningSeat === partnerOf(observation.seat);
    const remainingCards = [...observation.ownHand, ...unseenCards(observation),
      ...(observation.revealedHand?.cards ?? [])];
    const candidateOptions = sortedCandidates.map(c => {
      const winner = trickWinner([...currentRound, { seat: observation.seat, card: c }], observation.trump);
      return {
        cardId: cardId(c),
        points: cardPoints(c),
        winnerIfPlayed: winner.seat,
        isHighestRemainingInSuit: !remainingCards.some(other =>
          other.suit === c.suit && beats(other, c, observation.trump)),
      };
    });

    // 统计场上已打出的分牌与剩余分牌
    const playedPointsCount = { A: 0, '10': 0, '5': 0 };
    for (const round of observation.completedRounds ?? []) {
      for (const entry of round.cards) {
        if (entry.card.rank === 'A') playedPointsCount.A++;
        if (entry.card.rank === '10') playedPointsCount['10']++;
        if (entry.card.rank === '5') playedPointsCount['5']++;
      }
    }
    for (const entry of currentRound) {
      if (entry.card.rank === 'A') playedPointsCount.A++;
      if (entry.card.rank === '10') playedPointsCount['10']++;
      if (entry.card.rank === '5') playedPointsCount['5']++;
    }
    const remainingPointsTracker = {
      A: 4 - playedPointsCount.A,
      '10': 4 - playedPointsCount['10'],
      '5': 4 - playedPointsCount['5'],
    };

    // 结构化历史出牌明细
    const completedTricks = (observation.completedRounds ?? []).map((round) => ({
      trickNumber: round.trickNumber,
      cards: round.cards.map((entry) => ({
        seat: entry.seat,
        card: cardLabel(entry.card),
      })),
      winner: round.winner,
      pointsWon: round.points,
    }));

    const currentTrickStatus = {
      trickCardsCount: currentRound.length,
      leadCard: currentRound[0] ? cardLabel(currentRound[0].card) : null,
      highestCard: currentBest ? cardLabel(currentBest.card) : null,
      pointsInTrick: pointsInCurrentTrick,
      currentWinnerSeat: currentWinningSeat,
      isPartnerCurrentlyWinning: isPartnerWinning,
      isPartnerGuaranteedWinning: isPartnerGuaranteedWinning(observation),
      opponentSeatsYetToPlay: Array.from({ length: Math.max(0, 3 - currentRound.length) }, (_, i) =>
        (observation.leader + currentRound.length + 1 + i) % 4)
        .filter(seat => sideOf(seat) !== sideOf(observation.seat)),
      isLastToPlay: currentRound.length === 3,
    };

    const userPayload = {
      phase: 'playing',
      promptVersion: LLM_PROMPT_VERSION,
      seat: observation.seat,
      seatName: SEAT_NAMES[observation.seat],
      team: getTeamPayload(observation.seat),
      handBySuit: {
        '♠黑桃': handBySuit.S.labels,
        '♥红桃': handBySuit.H.labels,
        '♣梅花': handBySuit.C.labels,
        '♦方块': handBySuit.D.labels,
      },
      revealed_hand: observation.revealedHand ? {
        seat: observation.revealedHand.seat,
        isPartner: observation.revealedHand.seat === partnerOf(observation.seat),
        isOpponent: sideOf(observation.revealedHand.seat) !== sideOf(observation.seat),
        cards: sortHand(observation.revealedHand.cards).map(cardId),
      } : null,
      known_buried_cards: observation.knownBuriedCards?.map(cardId) ?? null,
      handCounts: observation.handCounts,
      leader: observation.leader,
      roundNumber: observation.roundNumber,
      trump: observation.trump,
      declarer: observation.declarer,
      bid: observation.bid,
      declarerPoints: observation.declarerPoints,
      defenderPoints: observation.defenderPoints,
      contract_status: {
        isDeclarerSide: sideOf(observation.seat) === sideOf(observation.declarer),
        declarerPointsNeeded: Math.max(0, observation.bid - observation.declarerPoints),
        defenderPointsNeeded: Math.max(0, 105 - observation.bid - observation.defenderPoints),
      },
      current_trick_status: currentTrickStatus,
      remaining_points_tracker: remainingPointsTracker,
      completed_tricks: completedTricks,
      known_voids: observation.voidSuits.map((suits, s) => ({
        seat: s,
        voidSuits: suits,
      })),
      current_trick: currentRound.map((entry) => ({
        seat: entry.seat,
        card: cardLabel(entry.card),
      })),
      candidates: candidateOptions,
    };

    return [
      { role: 'system', content: SYSTEM_PROMPT_PLAY },
      { role: 'user', content: JSON.stringify(userPayload) },
    ];
  }
}
