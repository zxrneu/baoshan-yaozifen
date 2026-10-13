/** P1.2 独立验收抽查：100 分明牌只在成交且扣底完成后公开，未成交/未扣底阶段不泄露。 */
import { describe, expect, it } from 'vitest';
import { bid as applyBid, bury as applyBury, createGame, currentSeat, declareTrump as applyTrump, partnerOf } from '../src/engine';
import { cardPoints } from '../src/cards';
import { observeDecision } from '../src/ai/decisionObservation';

/** 四座依次不叫，最后回到 0 座叫 100 成交。 */
function handWithBid(bid: number | null) {
  let state = createGame(4242, { minBid: 70, bidStep: 5, maxBid: 100 });
  for (let i = 0; i < 4; i++) {
    const seat = currentSeat(state);
    state = applyBid(state, seat, seat === 0 ? bid : null);
    if (state.phase !== 'bidding') break;
  }
  return state;
}

describe('P1.2 明牌阶段边界', () => {
  it('叫 100 但尚未扣底时，任何座位的阶段观察都看不到搭档手牌', () => {
    const state = handWithBid(100);
    expect(state.highestBid).toBe(100);
    expect(state.declarer).toBe(0);
    expect(state.phase).toBe('trump');
    state.declarer !== null && expect(partnerOf(state.declarer)).toBe(2);
    const trumpPhase = applyTrump(state, state.declarer!, 'S');
    expect(trumpPhase.phase).toBe('bury');
    for (const phase of [state, trumpPhase]) for (let seat = 0; seat < 4; seat++) {
      const observation = observeDecision(phase, seat);
      expect(observation).not.toHaveProperty('revealedHand');
      expect(observation).not.toHaveProperty('seed');
    }
  });

  it('未叫到 100 的正常成交在出牌阶段同样不公开搭档手牌', () => {
    const state = handWithBid(85);
    expect(state.highestBid).toBe(85);
    expect(observeDecision(state, 0)).not.toHaveProperty('revealedHand');
  });

  it('叫 100 且扣底成功后，出牌阶段才按座位公开叫分方搭档手牌', () => {
    const bidding = handWithBid(100);
    const trump = applyTrump(bidding, bidding.declarer!, 'S');
    const hand = trump.hands[trump.declarer!];
    const junk = hand.filter(card => cardPoints(card) === 0).slice(0, trump.rules.kittySize);
    expect(junk).toHaveLength(trump.rules.kittySize);
    const buried = applyBury(trump, trump.declarer!, junk);
    expect(buried.phase).toBe('playing');
    const mate = partnerOf(buried.declarer!);
    for (let seat = 0; seat < 4; seat++) {
      const observation = observeDecision(buried, seat) as { revealedHand?: unknown };
      expect(observation.revealedHand).toEqual({ seat: mate, cards: buried.hands[mate] });
    }
    expect(buried.kitty).toHaveLength(buried.rules.kittySize);
  });
});
