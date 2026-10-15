import { describe, expect, it } from 'vitest';
import { Card, cardId, makeCard } from '@yaozifen/game-core/cards';
import { observeBidding, observeBury, observeTrump } from '@yaozifen/game-view/decisionObservation';
import { LlmPromptBuilder, LlmResponseParser } from '@yaozifen/ai-core/engines/index';
import { ALL_BENCHMARK_SCENARIOS } from '@yaozifen/ai-eval/scenarios';
import { PlayerObservation } from '@yaozifen/ai-core/optimized/contracts';

const payload = (messages: ReturnType<typeof LlmPromptBuilder.buildBiddingMessages>) => JSON.parse(messages[1].content);
const scenario = (id: string) => ALL_BENCHMARK_SCENARIOS.find(s => s.id === id)!.setup();

function playObservation(overrides: Partial<PlayerObservation> = {}): PlayerObservation {
  return {
    seat: 1, ownHand: [makeCard('D', '10'), makeCard('D', '2')], handCounts: [2, 2, 2, 2],
    declarer: 0, bid: 80, trump: 'S', leader: 3, roundNumber: 1,
    currentRound: [{ seat: 3, card: makeCard('D', 'A') }, { seat: 0, card: makeCard('D', '3') }],
    completedRounds: [], voidSuits: [[], [], ['D'], []], declarerPoints: 0, defenderPoints: 0,
    kittySize: 4, ruleId: 'basic-v1', ...overrides,
  };
}

describe('LLM 提示词事实与建议边界', () => {
  it('叫分消融移除整个专家建议，但手牌、公开叫分与所有客观特征相同', () => {
    const x = scenario('bid-extreme-long-suit');
    const o = observeBidding(x.state!, x.seat);
    const normal = payload(LlmPromptBuilder.buildBiddingMessages(o));
    const noAdvice = payload(LlmPromptBuilder.buildBiddingMessages(o, { disableBidAdvice: true }));
    expect(normal.bidAdvice.source).toBe('heuristic');
    const { bidAdvice, ...facts } = normal;
    expect(noAdvice).toEqual(facts);
    expect(noAdvice).not.toHaveProperty('bidAdvice');
    expect(noAdvice).not.toHaveProperty('strengthScore');
  });

  it('定主事实区分长套与连续顶张，不把分牌加权成控制力', () => {
    const x = scenario('trump-solid-vs-fragile-length');
    const p = payload(LlmPromptBuilder.buildTrumpMessages(observeTrump(x.state!, x.seat)));
    expect(p.suitsSummary.S).toMatchObject({ count: 5, points: 20, topRunFromAce: 5 });
    expect(p.suitsSummary.H).toMatchObject({ count: 6, points: 0, topRunFromAce: 0 });
    expect(p.suitsSummary.S).not.toHaveProperty('strengthScore');
  });

  it('扣底机会标记控制张代价，候选合法不等于推荐扣掉', () => {
    const x = scenario('bury-protect-trapped-king');
    const p = payload(LlmPromptBuilder.buildBuryMessages(observeBury(x.state!, x.seat)));
    expect(p.candidates.some((c: { cardId: string }) => c.cardId === 'KC')).toBe(true);
    expect(p.candidatesBySuit.C).toMatchObject({ canFormVoid: true, controlCards: ['KC'], totalCardsInSuit: 2 });
    expect(p.voidCreationAdvice.find((s: string) => s.startsWith('♣'))).toContain('KC');
  });

  it('已绝门与五张废牌门不被误标成能用四张额度扣空的新绝门', () => {
    const ownHand: Card[] = ['A', 'K', 'Q', 'J', '10', '9', '8', '7', '6', '5', '4'].map(rank => makeCard('S', rank as Card['rank']));
    ownHand.push(...['9', '8', '7', '6', '4'].map(rank => makeCard('D', rank as Card['rank'])));
    const p = payload(LlmPromptBuilder.buildBuryMessages({ phase: 'bury', seat: 0, ownHand,
      handCounts: [16, 12, 12, 12], kittySize: 4, ruleId: 'basic-v1', trump: 'S' }));
    expect(p.candidatesBySuit.H).toMatchObject({ alreadyVoid: true, canFormVoid: false });
    expect(p.candidatesBySuit.D).toMatchObject({ alreadyVoid: false, canFormVoid: false });
  });

  it('搭档副牌A当前领先但后手对手可将吃，不能标记稳赢', () => {
    const o = playObservation();
    const p = payload(LlmPromptBuilder.buildPlayMessages(o, o.ownHand));
    expect(p.current_trick_status).toMatchObject({ isPartnerCurrentlyWinning: true,
      isPartnerGuaranteedWinning: false, opponentSeatsYetToPlay: [2], isLastToPlay: false });
    expect(p.candidates.every((c: { winnerIfPlayed: number }) => c.winnerIfPlayed === 3)).toBe(true);
  });

  it('第四手安全喂分的候选保留搭档赢家，并给出己方合同目标', () => {
    const x = scenario('play-follow-feed-points');
    const p = payload(LlmPromptBuilder.buildPlayMessages(x.observation!, x.candidates!));
    expect(p.current_trick_status.isPartnerGuaranteedWinning).toBe(true);
    expect(p.current_trick_status.opponentSeatsYetToPlay).toEqual([]);
    expect(p.candidates.find((c: { cardId: string }) => c.cardId === '10D').winnerIfPlayed).toBe(3);
    expect(p.contract_status).toEqual({ isDeclarerSide: false, declarerPointsNeeded: 75, defenderPointsNeeded: 30 });
  });

  it('候选大主改变当前赢家，小主不改变；不会把当前赢张表述为最终赢墩', () => {
    const x = scenario('play-overruff-opponent');
    const p = payload(LlmPromptBuilder.buildPlayMessages(x.observation!, x.candidates!));
    expect(p.candidates.find((c: { cardId: string }) => c.cardId === '8S').winnerIfPlayed).toBe(x.seat);
    expect(p.candidates.find((c: { cardId: string }) => c.cardId === '2S').winnerIfPlayed).not.toBe(x.seat);
  });

  it('防守视角把庄家搭档公开手牌标成对手，并保留座位；不伪称本人搭档', () => {
    const o = playObservation({ bid: 100, revealedHand: { seat: 2, cards: [makeCard('H', 'K'), makeCard('C', '2')] } });
    const p = payload(LlmPromptBuilder.buildPlayMessages(o, o.ownHand));
    expect(p.revealed_hand).toEqual({ seat: 2, isOpponent: true, isPartner: false, cards: ['KH', '2C'] });
    expect(p).not.toHaveProperty('revealed_partner_hand');
    expect(p.known_buried_cards).toBeNull();
  });

  it('方块A已出后K标记为该门最大，未知大牌不被假定打出或属于某座位', () => {
    const x = scenario('play-feed-partner-void');
    const p = payload(LlmPromptBuilder.buildPlayMessages(x.observation!, x.candidates!));
    expect(p.candidates.find((c: { cardId: string }) => c.cardId === 'KD').isHighestRemainingInSuit).toBe(true);
    expect(p.candidates.find((c: { cardId: string }) => c.cardId === '2D').isHighestRemainingInSuit).toBe(false);
  });

  it('保留庄家已知扣牌用于记牌，其他座位没有该信息', () => {
    const o = playObservation({ seat: 0, leader: 0, currentRound: [],
      knownBuriedCards: [makeCard('C', '4'), makeCard('C', '3'), makeCard('C', '2'), makeCard('H', '2')] });
    const p = payload(LlmPromptBuilder.buildPlayMessages(o, o.ownHand));
    expect(p.known_buried_cards).toEqual(['4C', '3C', '2C', '2H']);
    expect(p.current_trick_status.currentWinnerSeat).toBeNull();
    expect(p.current_trick_status.isPartnerGuaranteedWinning).toBe(false);
  });

  it('四阶段输出契约仍可通过原解析器，所有35场景都可生成带版本的请求', () => {
    for (const s of ALL_BENCHMARK_SCENARIOS) {
      const x = s.setup();
      let p: any;
      if (s.phase === 'bidding') {
        const o = observeBidding(x.state!, x.seat);
        p = payload(LlmPromptBuilder.buildBiddingMessages(o));
        expect(LlmResponseParser.parseBid(JSON.stringify({ bid: null, thinking: '风险偏高', conclusion: '不叫' }), [...p.legalBids]).bid).toBeNull();
      } else if (s.phase === 'trump') {
        p = payload(LlmPromptBuilder.buildTrumpMessages(observeTrump(x.state!, x.seat)));
        expect(LlmResponseParser.parseTrump(JSON.stringify({ trump: p.options[0] })).trump).toBe(p.options[0]);
      } else if (s.phase === 'bury') {
        const o = observeBury(x.state!, x.seat);
        p = payload(LlmPromptBuilder.buildBuryMessages(o));
        const ids = p.candidates.slice(0, 4).map((c: { cardId: string }) => c.cardId);
        expect(LlmResponseParser.parseBury(JSON.stringify({ cards: ids }), [...o.ownHand]).cards.map(cardId)).toEqual(ids);
      } else {
        p = payload(LlmPromptBuilder.buildPlayMessages(x.observation!, x.candidates!));
        const id = p.candidates[0].cardId;
        expect(cardId(LlmResponseParser.parsePlay(JSON.stringify({ cardId: id }), x.candidates!).card)).toBe(id);
      }
      expect(p.promptVersion).toBe('2.0.0');
      expect(p.phase).toBe(s.phase);
      expect(p).not.toHaveProperty('seed');
      expect(p).not.toHaveProperty('hands');
    }
  });
});
