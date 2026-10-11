/**
 * LLM 提示词与上下文构造服务 (SOLID - SRP 原则)。
 * 负责组装全员一致的 System Prompt (包含保山幺子分完整规则与特级大师实战牌理)，
 * 并按严格的非公开信息隔离原则为 4 个决策动作（叫分、定主、扣底、出牌）组装结构化消息列表。
 */
import { Card, cardId, cardLabel, cardPoints, SUITS } from '../../../cards';
import { GameState, SEAT_NAMES } from '../../../engine';
import { PlayerObservation } from '../../optimized/contracts';

/**
 * 保山幺子分全员统一的 System Prompt (硬规则 + 专家经验)。
 * 所有 4 位玩家加载完全相同的内容，作为底层认知基准。
 */
export const SYSTEM_PROMPT_CORE = `你是一个顶级的云南保山幺子分（腰子分）纸牌特级大师与高维博弈决策 AI。

【基础规则与核心机制】
1. 人员与阵营：四人对局，东西一方 vs 南北一方（搭档隔座相对）。
2. 牌副与分牌：一副 52 张标准扑克（无大小王）。每门花色含 25 分（A=10分, 10=10分, 5=5分），全副牌总分恰好 100 分。K、Q、J 为 0 分控制牌。
3. 牌力顺序（同花色内）：A > K > Q > J > 10 > 9 > 8 > 7 > 6 > 5 > 4 > 3 > 2。主牌绝对大于任何非主牌。同为非主牌且不同花色不可互相压制。
4. 阶段流转：发牌(各12张,留4底牌) -> 轮流叫分(起叫70~最高100) -> 庄家定主 -> 庄家拿底并扣底(4张) -> 12轮出牌 -> 吃分结算。
5. 胜负与锁定线：庄家方(吃分+底牌分) ≥ 叫分即成局；闲家方吃分达到 (105 - 叫分) 则提前锁定胜局。叫满 100 分且成功扣底后，庄家搭档手牌必须对所有人明牌公开。
6. 不完全信息铁律：每个选手在决策时，绝对无法知晓他人的暗手牌，未亮明底牌不可偷看。严禁臆测他人私有信息，必须严格基于自身私有手牌与牌桌公开物理事件流进行合规决策。

【高水平实战经验与行牌哲学】
1. 【叫分经验】：
   - 基础起叫(70-75分)：手牌至少有 1 门 5 张以上长套带关键控制张(A/K)，手牌有基础分牌。
   - 高分争庄(80-95分)：拥有双大套、强控牌（多张A），副牌短门具备断门毙杀吃大分潜力。
   - 满分100分：单手牌极强或断门极好，且需结合“搭档手牌强制明牌”的双明手战术优势规划全场打法。牌力不足请果断放弃 (pass/null)。
2. 【定主经验】：
   - 绝不定短门为主！必须优先选择张数最多（通常 ≥ 5张）且牌力结构完整（有A、K控场）的花色为主牌，确保后续行牌具备拔大清主和绝对控场权。
3. 【扣底经验（庄家保底绝技）】：
   - 铁律红线：分牌（A、10、5）严禁扣底！违者直接判负！必须且仅能扣 4 张非分牌。
   - “扣短不扣长，造绝门用主杀”：副牌中仅有 1~2 张小牌的短门是绝佳扣牌目标，将该门直接扣空（造成绝门），一旦对手引出该门即可立即用主牌毙杀吃大分！
   - 保留副牌长套中的高阶保护张，绝不能无故削弱自身控制力。
4. 【出牌实战经验（搭档配合与记牌算牌）】：
   - 记牌铁律：时刻监控 4 张 10、4 张 A、4 张 5 的消耗与留存；时刻根据历史出牌记录各家“断门/绝门”花色。
   - 搭档协同原则：当搭档出的牌已确定稳赢本轮时：
     * 手中有分牌且安全时，果断【喂分】（跟出同门10/5或垫其他门大分送入己方账目）；
     * 手中无分牌时，【出最小0分牌保牌】（如2、3、4），严禁无意义消耗己方高控制牌（如K、Q）。
   - 防守原则：对手大牌稳赢时，绝不主动送分，尽量跟小牌或保留主牌控制力。
   - 领出策略：庄家优势时优先“拔大牌清主牌”；劣势防守时“冲副牌赢张”或“逼庄家耗主”。

【输出格式规范】
请严格输出标准 JSON 格式，不要包含多余寒暄。
- 出牌阶段输出字段："cardId" (来自 candidates), "thinking", "conclusion", "confidence" (0~1), 可选 "reason"
- 叫分阶段输出字段："bid" (来自 legalBids 或 null), "thinking", "conclusion"
- 定主阶段输出字段："trump" ("S"|"H"|"C"|"D"), "thinking", "conclusion"
- 扣底阶段输出字段："cards" (恰好 4 张非分牌 cardId 数组), "thinking", "conclusion"
`;

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

/**
 * LLM 提示词组装服务 (符合单一职责原则)
 */
export class LlmPromptBuilder {
  /**
   * 组装叫分阶段的消息列表
   */
  static buildBiddingMessages(state: GameState, seat: number, legalBids: number[]): ChatMessage[] {
    const hand = state.hands[seat] ?? [];
    const bidHistory = state.bidding.map((b) => ({
      seat: b.seat,
      seatName: SEAT_NAMES[b.seat],
      bid: b.bid === null ? '不叫(Pass)' : `${b.bid}分`,
    }));

    const userPayload = {
      phase: 'bidding',
      seat,
      seatName: SEAT_NAMES[seat],
      hand: hand.map((c) => cardLabel(c)),
      highestBid: state.highestBid > 0 ? state.highestBid : null,
      highestBidder: state.highestBidder !== null ? SEAT_NAMES[state.highestBidder] : null,
      legalBids,
      bidHistory,
    };

    return [
      { role: 'system', content: SYSTEM_PROMPT_CORE },
      { role: 'user', content: JSON.stringify(userPayload) },
    ];
  }

  /**
   * 组装定主阶段的消息列表
   */
  static buildTrumpMessages(state: GameState, seat: number): ChatMessage[] {
    const hand = state.hands[seat] ?? [];
    const suitsSummary: Record<string, { count: number; labels: string[]; hasA: boolean; hasK: boolean }> = {};

    for (const suit of SUITS) {
      const inSuit = hand.filter((c) => c.suit === suit);
      suitsSummary[suit] = {
        count: inSuit.length,
        labels: inSuit.map((c) => cardLabel(c)),
        hasA: inSuit.some((c) => c.rank === 'A'),
        hasK: inSuit.some((c) => c.rank === 'K'),
      };
    }

    const userPayload = {
      phase: 'trump',
      seat,
      seatName: SEAT_NAMES[seat],
      winningBid: state.highestBid,
      hand: hand.map((c) => cardLabel(c)),
      suitsSummary,
      options: ['S', 'H', 'C', 'D'],
    };

    return [
      { role: 'system', content: SYSTEM_PROMPT_CORE },
      { role: 'user', content: JSON.stringify(userPayload) },
    ];
  }

  /**
   * 组装扣底阶段的消息列表
   */
  static buildBuryMessages(state: GameState, seat: number): ChatMessage[] {
    const hand = state.hands[seat] ?? [];
    const nonPointCards = hand.filter((c) => cardPoints(c) === 0);
    const pointCards = hand.filter((c) => cardPoints(c) > 0);

    const userPayload = {
      phase: 'bury',
      seat,
      seatName: SEAT_NAMES[seat],
      trump: state.trump,
      hand_16: hand.map((c) => cardLabel(c)),
      pointCardsMustKeep: pointCards.map((c) => `${cardId(c)}(${cardLabel(c)})`),
      candidates: nonPointCards.map((c) => ({
        cardId: cardId(c),
        label: cardLabel(c),
        suit: c.suit,
        rank: c.rank,
      })),
      rule: '必须且仅能扣 4 张牌！分牌（A、10、5）绝对严禁扣底！请从 candidates 中选出 4 张 cardId。',
    };

    return [
      { role: 'system', content: SYSTEM_PROMPT_CORE + '\n当前任务仅为扣底决策。必须主动从候选中选择四张不同的非分牌，返回 {"cards":["cardId","cardId","cardId","cardId"],"thinking":"简短依据","conclusion":"扣底结论"}。cardId 必须使用输入 candidates 中的真实编号。不要复述输入局面或返回 hand_16、candidates、rule 字段。' },
      { role: 'user', content: JSON.stringify(userPayload) },
    ];
  }

  /**
   * 组装出牌阶段的消息列表（支持历史出牌明细、已知断门、明牌公开与当前墩）
   */
  static buildPlayMessages(
    observation: PlayerObservation,
    candidates: readonly Card[],
  ): ChatMessage[] {
    const candidateOptions = candidates.map((c) => ({
      cardId: cardId(c),
      label: cardLabel(c),
      points: cardPoints(c),
    }));

    // 结构化历史出牌明细（完整保留前序每轮的公开事件）
    const completedTricks = (observation.completedRounds ?? []).map((round, idx) => ({
      trickNumber: idx + 1,
      cards: round.cards.map((entry) => ({
        seat: entry.seat,
        seatName: SEAT_NAMES[entry.seat],
        card: cardLabel(entry.card),
        points: cardPoints(entry.card),
      })),
      winner: round.winner,
      winnerName: SEAT_NAMES[round.winner],
      pointsWon: round.points,
    }));

    const userPayload = {
      seat: observation.seat,
      seatName: SEAT_NAMES[observation.seat],
      hand: observation.ownHand.map((c) => cardLabel(c)),
      revealed_partner_hand: observation.revealedHand
        ? observation.revealedHand.cards.map((c) => cardLabel(c))
        : null,
      trump: observation.trump,
      declarer: observation.declarer,
      bid: observation.bid,
      declarerPoints: observation.declarerPoints,
      defenderPoints: observation.defenderPoints,
      completed_tricks: completedTricks,
      known_voids: observation.voidSuits.map((suits, s) => ({
        seat: s,
        seatName: SEAT_NAMES[s],
        voidSuits: suits,
      })),
      current_trick: observation.currentRound.map((entry) => ({
        seat: entry.seat,
        seatName: SEAT_NAMES[entry.seat],
        card: cardLabel(entry.card),
      })),
      candidates: candidateOptions,
    };

    return [
      { role: 'system', content: SYSTEM_PROMPT_CORE },
      { role: 'user', content: JSON.stringify(userPayload) },
    ];
  }
}
