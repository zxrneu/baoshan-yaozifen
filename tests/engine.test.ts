import { describe, expect, it } from 'vitest';
import { cardId, cardPoints } from '../src/cards';
import {
  DEFAULT_RULES, GameState, IllegalActionError, SEAT_NAMES,
  bid, bury, createGame, currentSeat, declareTrump, legalBids, legalMoves,
  nextHand, playCard, sideOf, trickWinner,
} from '../src/engine';

/** 让 0~3 号位按顺序叫到指定分数，快速走到定主阶段 */
function reachTrump(state: GameState, bids: (number | null)[]): GameState {
  let s = state;
  for (const b of bids) {
    s = bid(s, currentSeat(s), b);
  }
  return s;
}

function reachPlaying(seed = 7, bidValue: number = 80): GameState {
  let s = createGame(seed);
  // 找一个该 seed 下能叫到 bidValue 的庄家
  const bids: (number | null)[] = [];
  const first = currentSeat(s);
  for (let i = 0; i < 4; i++) {
    const seat = (first + i) % 4;
    bids.push(seat === first ? bidValue : null);
  }
  s = reachTrump(s, bids);
  s = declareTrump(s, s.declarer!, 'S');
  const buryCards = legalBury(s);
  s = bury(s, s.declarer!, buryCards);
  return s;
}

/** 选 4 张可扣的牌（非分牌） */
function legalBury(s: GameState): ReturnType<typeof pickBury> {
  return pickBury(s);
}

function pickBury(s: GameState) {
  const hand = s.hands[s.declarer!];
  return hand.filter((c) => cardPoints(c) === 0).slice(0, s.kitty.length);
}

describe('发牌', () => {
  it('每人 12 张，底牌 4 张，共 52 张', () => {
    const s = createGame(1);
    expect(s.phase).toBe('bidding');
    for (const h of s.hands) expect(h).toHaveLength(12);
    expect(s.kitty).toHaveLength(4);
    const all = s.hands.flat().concat(s.kitty).map(cardId);
    expect(new Set(all).size).toBe(52);
  });

  it('同种子可复现', () => {
    expect(createGame(123)).toEqual(createGame(123));
  });
});

describe('叫分', () => {
  it('从发牌者下家开始叫分', () => {
    const s = createGame(5);
    expect(currentSeat(s)).toBe((s.dealer + 1) % 4);
  });

  it('轮次外叫分抛错', () => {
    const s = createGame(5);
    const seat = currentSeat(s);
    expect(() => bid(s, (seat + 1) % 4, 70)).toThrow(IllegalActionError);
  });

  it('非法分数抛错（低于下限 / 不是步长档 / 超上限）', () => {
    const s = createGame(9);
    const seat = currentSeat(s);
    expect(() => bid(s, seat, 65)).toThrow(IllegalActionError);
    expect(() => bid(s, seat, 72)).toThrow(IllegalActionError);
    expect(() => bid(s, seat, 105)).toThrow(IllegalActionError);
  });

  it('必须叫得比当前最高分高', () => {
    let s = createGame(11);
    s = bid(s, currentSeat(s), 70);
    const seat = currentSeat(s);
    expect(() => bid(s, seat, 65)).toThrow(IllegalActionError);
    expect(() => bid(s, seat, 75)).not.toThrow();
  });

  it('最高分者成为庄家并进入定主', () => {
    let s = createGame(11);
    const first = currentSeat(s);
    s = bid(s, first, 70);
    s = bid(s, currentSeat(s), null);
    s = bid(s, currentSeat(s), 75);
    s = bid(s, currentSeat(s), null);
    expect(s.phase).toBe('trump');
    expect(s.declarer).toBe((first + 2) % 4);
    expect(s.highestBid).toBe(75);
  });

  it('四家不叫则重新发牌且庄家顺延', () => {
    let s = createGame(3);
    const oldDealer = s.dealer;
    for (let i = 0; i < 4; i++) s = bid(s, currentSeat(s), null);
    expect(s.phase).toBe('bidding');
    expect(s.dealer).toBe((oldDealer + 1) % 4);
    // 重新发的牌依然完整
    const all = s.hands.flat().concat(s.kitty).map(cardId);
    expect(new Set(all).size).toBe(52);
  });

  it('legalBids 反映下限与步长', () => {
    let s = createGame(21);
    expect(legalBids(s)).toContain(70);
    expect(legalBids(s)).not.toContain(65);
    s = bid(s, currentSeat(s), 75);
    const next = legalBids(s);
    expect(next[0]).toBe(80);
  });
});

describe('定主与扣底', () => {
  it('只有庄家能定主', () => {
    let s = createGame(11);
    s = bid(s, currentSeat(s), 70);
    s = bid(s, currentSeat(s), null);
    s = bid(s, currentSeat(s), null);
    s = bid(s, currentSeat(s), null);
    const notDeclarer = (s.declarer! + 1) % 4;
    expect(() => declareTrump(s, notDeclarer, 'H')).toThrow(IllegalActionError);
  });

  it('定主后庄家拿底牌到 16 张并进入扣底', () => {
    let s = createGame(11);
    s = bid(s, currentSeat(s), 70);
    s = bid(s, currentSeat(s), null);
    s = bid(s, currentSeat(s), null);
    s = bid(s, currentSeat(s), null);
    const declarer = s.declarer!;
    s = declareTrump(s, declarer, 'D');
    expect(s.trump).toBe('D');
    expect(s.phase).toBe('bury');
    expect(s.hands[declarer]).toHaveLength(16);
  });

  it('分牌不能扣回底牌', () => {
    let s = createGame(11);
    s = bid(s, currentSeat(s), 70);
    s = bid(s, currentSeat(s), null);
    s = bid(s, currentSeat(s), null);
    s = bid(s, currentSeat(s), null);
    const declarer = s.declarer!;
    s = declareTrump(s, declarer, 'D');
    const hand = s.hands[declarer];
    const pointCard = hand.find((c) => cardPoints(c) > 0);
    if (pointCard) {
      const others = hand.filter((c) => cardPoints(c) === 0).slice(0, 3);
      expect(() => bury(s, declarer, [pointCard, ...others])).toThrow(IllegalActionError);
    }
    // 数量不对 / 重复 / 不在手牌都抛错
    const zeros = hand.filter((c) => cardPoints(c) === 0);
    expect(() => bury(s, declarer, zeros.slice(0, 3))).toThrow(IllegalActionError);
    expect(() => bury(s, declarer, [zeros[0], zeros[0], zeros[1], zeros[2]])).toThrow(IllegalActionError);
    const foreign = { suit: 'C' as const, rank: '3' as const };
    if (!zeros.some((c) => c.suit === 'C' && c.rank === '3')) {
      expect(() => bury(s, declarer, [foreign, ...zeros.slice(0, 3)])).toThrow(IllegalActionError);
    }
  });

  it('扣底后手牌回到 12 张、底牌为 4 张非分牌，庄家首家出牌', () => {
    const s = reachPlaying(7);
    const declarer = s.declarer!;
    expect(s.hands[declarer]).toHaveLength(12);
    expect(s.kitty).toHaveLength(4);
    expect(s.kitty.every((c) => cardPoints(c) === 0)).toBe(true);
    expect(s.phase).toBe('playing');
    expect(currentSeat(s)).toBe(declarer);
  });
});

describe('出牌', () => {
  it('必须跟同门花色', () => {
    const s0 = reachPlaying(7);
    const seat = currentSeat(s0);
    const hand = s0.hands[seat];
    // 制造一个有同门可跟的局面：自己先领一张，第二家必须跟同门
    const first = hand[0];
    let s = playCard(s0, seat, first);
    const seat2 = currentSeat(s);
    const hand2 = s.hands[seat2];
    const followSuit = hand2.filter((c) => c.suit === first.suit);
    if (followSuit.length > 0) {
      const offSuit = hand2.find((c) => c.suit !== first.suit);
      if (offSuit) {
        expect(() => playCard(s, seat2, offSuit)).toThrow(IllegalActionError);
      }
      expect(() => playCard(s, seat2, followSuit[0])).not.toThrow();
    }
  });

  it('轮次外出牌抛错', () => {
    const s = reachPlaying(7);
    const seat = currentSeat(s);
    const other = (seat + 1) % 4;
    const card = s.hands[other][0];
    expect(() => playCard(s, other, card)).toThrow(IllegalActionError);
  });

  it('本轮牌最大的一家收分，四家出完自动结算', () => {
    const s = reachPlaying(7);
    const trump = s.trump!;
    const trick = [
      { seat: 0, card: { suit: 'S' as const, rank: '7' as const } },
      { seat: 1, card: { suit: 'H' as const, rank: 'A' as const } }, // 非主 A 压不过主 7
      { seat: 2, card: { suit: 'S' as const, rank: 'K' as const } },
      { seat: 3, card: { suit: 'C' as const, rank: '10' as const } },
    ];
    const win = trickWinner(trick, trump);
    // 主是 S 时 7 主被 K 主压过
    if (trump === 'S') {
      expect(win.seat).toBe(2);
    }
    // 非主花色互不能压
    expect(trickWinner(trick.slice(0, 2), 'D').seat).toBe(0);
  });

  it('主牌压过任何非主牌', () => {
    expect(trickWinner([
      { seat: 0, card: { suit: 'H', rank: 'A' } },
      { seat: 1, card: { suit: 'S', rank: '2' } },
    ], 'S').seat).toBe(1);
  });

  it('整副牌打完双方吃分合计 100，结算进入 handEnd', () => {
    let s = reachPlaying(7);
    let guard = 0;
    while (s.phase === 'playing' && guard++ < 100) {
      const seat = currentSeat(s);
      const card = legalMoves(s, seat)[0];
      s = playCard(s, seat, card);
    }
    expect(s.phase).toBe('handEnd');
    expect(s.declarerTrickPoints + s.defenderTrickPoints + s.buriedPoints).toBe(100);
    expect(s.result).not.toBeNull();
    const r = s.result!;
    expect(r.success).toBe(r.declarerPoints >= r.bid);
    expect(r.defenderPoints).toBe(s.defenderTrickPoints);
    // 胜方记分
    const expected: [number, number] = [0, 0];
    expected[r.winnerSide] = 1;
    expect(s.scores).toEqual(expected);
  });

  it('不成局则闲家方胜', () => {
    // 极端配置：庄家几乎不可能达成的高叫分
    let s = createGame(2, { minBid: 95, bidStep: 5 });
    const first = currentSeat(s);
    s = bid(s, first, 95);
    s = bid(s, currentSeat(s), null);
    s = bid(s, currentSeat(s), null);
    s = bid(s, currentSeat(s), null);
    s = declareTrump(s, s.declarer!, 'S');
    s = bury(s, s.declarer!, pickBury(s));
    let guard = 0;
    while (s.phase === 'playing' && guard++ < 100) {
      const seat = currentSeat(s);
      s = playCard(s, seat, legalMoves(s, seat)[0]);
    }
    expect(s.phase).toBe('handEnd');
    if (s.result && !s.result.success) {
      expect(s.result.winnerSide).toBe(1 - sideOf(s.declarer!));
    }
  });
});

describe('整场流程', () => {
  it('先胜 targetWins 副即结束整场；下一副庄家顺延', () => {
    let s = createGame(31, { targetWins: 2 });
    let steps = 0;
    while (s.phase !== 'matchEnd' && steps++ < 500) {
      if (s.phase === 'handEnd') {
        s = nextHand(s);
        continue;
      }
      const seat = currentSeat(s);
      if (seat < 0) throw new Error('无效座位');
      switch (s.phase) {
        case 'bidding':
          s = bid(s, seat, legalBids(s)[0] ?? null);
          break;
        case 'trump':
          s = declareTrump(s, seat, 'S');
          break;
        case 'bury':
          s = bury(s, seat, pickBury(s));
          break;
        case 'playing':
          s = playCard(s, seat, legalMoves(s, seat)[0]);
          break;
      }
    }
    expect(s.phase).toBe('matchEnd');
    expect(Math.max(...s.scores)).toBeGreaterThanOrEqual(2);
  });

  it('handEnd 前不能开始下一副', () => {
    const s = createGame(44);
    expect(() => nextHand(s)).toThrow(IllegalActionError);
  });

  it('座位名与搭档关系：东西 vs 南北', () => {
    expect(SEAT_NAMES).toEqual(['东', '南', '西', '北']);
    expect(sideOf(0)).toBe(sideOf(2));
    expect(sideOf(1)).toBe(sideOf(3));
    expect(sideOf(0)).not.toBe(sideOf(1));
    expect(DEFAULT_RULES.minBid).toBe(70);
  });
});
