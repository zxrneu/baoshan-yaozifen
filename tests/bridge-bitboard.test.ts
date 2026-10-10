import { describe, expect, it } from 'vitest';
import { cardValue, freshDeck, makeCard, Suit } from '../src/cards';
import { trickWinner } from '../src/engine';
import {
  bitboardLegalMoves,
  bitboardTrickWinner,
  cardToMask,
  handToBitboard,
  highestRank,
  lowestRank,
  maskPoints,
  maskToCards,
  popcount,
} from '../src/ai/bridge/bitboard';
import { SUIT_INDEX } from '../src/ai/bridge/types';

describe('位棋盘基础操作与吃墩计算 (Bitboard Operations)', () => {
  it('popcount 与 rank 提取准确无误', () => {
    expect(popcount(0)).toBe(0);
    // 2 (bit 0) + A (bit 12) = 1 + 4096 = 4097
    const mask = (1 << 0) | (1 << 12);
    expect(popcount(mask)).toBe(2);
    expect(highestRank(mask)).toBe(12); // A
    expect(lowestRank(mask)).toBe(0);  // 2
  });

  it('maskPoints 查表分值与 cardPoints 严格一致', () => {
    // 5: bit 3 (5分), 10: bit 8 (10分), A: bit 12 (10分)
    const m5 = 1 << 3;
    const m10 = 1 << 8;
    const mA = 1 << 12;
    expect(maskPoints(m5)).toBe(5);
    expect(maskPoints(m10)).toBe(10);
    expect(maskPoints(mA)).toBe(10);
    expect(maskPoints(m5 | m10 | mA)).toBe(25);
    // 0 分牌 (如 K, Q, J)
    expect(maskPoints((1 << 11) | (1 << 10) | (1 << 9))).toBe(0);
  });

  it('Card 与位掩码双向转换完全保真', () => {
    const deck = freshDeck();
    for (const card of deck) {
      const { suitIdx, rankVal, mask } = cardToMask(card);
      expect(suitIdx).toBe(SUIT_INDEX[card.suit]);
      expect(rankVal).toBe(cardValue(card));
      const restored = maskToCards(suitIdx, mask);
      expect(restored).toHaveLength(1);
      expect(restored[0].suit).toBe(card.suit);
      expect(restored[0].rank).toBe(card.rank);
    }
  });

  it('吃墩赢家判定与规则引擎 trickWinner 100% 一致', () => {
    const c = makeCard;
    const trumps: Suit[] = ['S', 'H', 'D', 'C'];

    for (const trump of trumps) {
      const trumpIdx = SUIT_INDEX[trump];
      // 场景 1：同门比较，无主牌
      const t1 = [
        { seat: 0, card: c('H', '10') },
        { seat: 1, card: c('H', 'K') },
        { seat: 2, card: c('H', 'A') },
        { seat: 3, card: c('H', '2') },
      ];
      const win1Engine = trickWinner(t1, trump);
      const bbT1 = t1.map((t) => ({
        seat: t.seat,
        suitIdx: SUIT_INDEX[t.card.suit],
        rankVal: cardValue(t.card),
      }));
      const win1Bb = bitboardTrickWinner(bbT1, trumpIdx);
      expect(win1Bb.winnerSeat).toBe(win1Engine.seat);
      expect(win1Bb.points).toBe(20); // 10 + A = 20分

      // 场景 2：缺门杀牌（方块为主，出红桃被杀）
      const t2 = [
        { seat: 0, card: c('H', 'A') }, // 10分
        { seat: 1, card: c('H', '10') }, // 10分
        { seat: 2, card: c('D', '2') }, // 主牌杀
        { seat: 3, card: c('H', '5') }, // 5分
      ];
      const win2Engine = trickWinner(t2, 'D');
      const bbT2 = t2.map((t) => ({
        seat: t.seat,
        suitIdx: SUIT_INDEX[t.card.suit],
        rankVal: cardValue(t.card),
      }));
      const win2Bb = bitboardTrickWinner(bbT2, SUIT_INDEX['D']);
      expect(win2Bb.winnerSeat).toBe(win2Engine.seat);
      expect(win2Bb.winnerSeat).toBe(2);
      expect(win2Bb.points).toBe(25); // A + 10 + 5 = 25分
    }
  });

  it('bitboardLegalMoves 满足有同门必跟与缺门规则', () => {
    const c = makeCard;
    const handCards = [c('H', 'A'), c('H', '2'), c('S', 'K')];
    const handBb = handToBitboard(handCards);

    // 领出红桃：必须跟红桃
    const followH = bitboardLegalMoves(handBb, SUIT_INDEX['H']);
    expect(followH).toHaveLength(1);
    expect(followH[0].suitIdx).toBe(SUIT_INDEX['H']);
    expect(popcount(followH[0].mask)).toBe(2);

    // 领出方块（手牌缺方块）：允许所有非空门
    const voidD = bitboardLegalMoves(handBb, SUIT_INDEX['D']);
    expect(voidD).toHaveLength(2); // S and H
  });
});
