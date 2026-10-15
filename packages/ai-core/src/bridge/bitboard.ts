/**
 * 64 位整型位棋盘操作与纳秒级吃墩计算（Bitboard Operations）。
 */
import { Card, RANKS, cardValue, makeCard } from '@yaozifen/game-core/cards';
import {
  CardMask,
  DealBitboard,
  HandBitboard,
  INDEX_TO_SUIT,
  SUIT_INDEX,
} from './types';

/**
 * 分牌掩码与常量：
 * 5: rank index 3 -> 1 << 3 = 8
 * 10: rank index 8 -> 1 << 8 = 256
 * A: rank index 12 -> 1 << 12 = 4096
 */
export const MASK_5 = 1 << 3;
export const MASK_10 = 1 << 8;
export const MASK_A = 1 << 12;
export const MASK_POINTS = MASK_5 | MASK_10 | MASK_A;

/**
 * 预计算 0..8191 的分值查找表 (LUT)，耗时 < 0.2ms
 */
const POINTS_LUT = new Uint8Array(8192);
for (let m = 0; m < 8192; m++) {
  let pts = 0;
  if (m & MASK_A) pts += 10;
  if (m & MASK_10) pts += 10;
  if (m & MASK_5) pts += 5;
  POINTS_LUT[m] = pts;
}

/**
 * 计算单个花色掩码内的分牌总分（查表 O(1)）
 */
export function maskPoints(mask: CardMask): number {
  return POINTS_LUT[mask & 0x1fff];
}

/**
 * 统计一个 13 位掩码内的手牌张数 (popcount)
 */
export function popcount(mask: number): number {
  let count = 0;
  let m = mask & 0x1fff;
  while (m > 0) {
    m &= m - 1;
    count++;
  }
  return count;
}

/**
 * 获取掩码中的最大点数索引（0..12），若为空返回 -1
 */
export function highestRank(mask: CardMask): number {
  if (mask === 0) return -1;
  return 31 - Math.clz32(mask);
}

/**
 * 获取掩码中的最小点数索引（0..12），若为空返回 -1
 */
export function lowestRank(mask: CardMask): number {
  if (mask === 0) return -1;
  const lsb = mask & -mask;
  return 31 - Math.clz32(lsb);
}

/**
 * Card 转掩码
 */
export function cardToMask(card: Card): { suitIdx: number; rankVal: number; mask: CardMask } {
  const suitIdx = SUIT_INDEX[card.suit];
  const rankVal = cardValue(card);
  const mask = 1 << rankVal;
  return { suitIdx, rankVal, mask };
}

/**
 * 掩码转 Card 列表
 */
export function maskToCards(suitIdx: number, mask: CardMask): Card[] {
  const suit = INDEX_TO_SUIT[suitIdx];
  const cards: Card[] = [];
  let m = mask & 0x1fff;
  while (m > 0) {
    const lsb = m & -m;
    const r = 31 - Math.clz32(lsb);
    cards.push(makeCard(suit, RANKS[r]));
    m ^= lsb;
  }
  return cards;
}

/**
 * 将手牌转为位棋盘
 */
export function handToBitboard(cards: readonly Card[]): HandBitboard {
  const bb: HandBitboard = [0, 0, 0, 0];
  for (let i = 0; i < cards.length; i++) {
    const c = cards[i];
    const s = SUIT_INDEX[c.suit];
    bb[s] |= 1 << cardValue(c);
  }
  return bb;
}

/**
 * 全场 4 家手牌转为 DealBitboard
 */
export function dealToBitboard(hands: readonly (readonly Card[])[]): DealBitboard {
  return [
    handToBitboard(hands[0] ?? []),
    handToBitboard(hands[1] ?? []),
    handToBitboard(hands[2] ?? []),
    handToBitboard(hands[3] ?? []),
  ];
}

/**
 * 克隆 HandBitboard
 */
export function cloneHand(hand: HandBitboard): HandBitboard {
  return [hand[0], hand[1], hand[2], hand[3]];
}

/**
 * 克隆 DealBitboard
 */
export function cloneDeal(deal: DealBitboard): DealBitboard {
  return [
    cloneHand(deal[0]),
    cloneHand(deal[1]),
    cloneHand(deal[2]),
    cloneHand(deal[3]),
  ];
}

/**
 * 纳秒级吃墩比大小（4家出牌完成后计算胜者座位）
 */
export function bitboardTrickWinner(
  cards: readonly { seat: number; suitIdx: number; rankVal: number }[],
  trumpIdx: number,
): { winnerSeat: number; points: number } {
  let best = cards[0];
  let points = 0;

  for (let i = 0; i < cards.length; i++) {
    const c = cards[i];
    // 累积分数
    if (c.rankVal === 12 || c.rankVal === 8) points += 10;
    else if (c.rankVal === 3) points += 5;

    if (i > 0) {
      const cTrump = c.suitIdx === trumpIdx;
      const bTrump = best.suitIdx === trumpIdx;
      if (cTrump !== bTrump) {
        if (cTrump) best = c;
      } else if (c.suitIdx === best.suitIdx) {
        if (c.rankVal > best.rankVal) best = c;
      }
    }
  }

  return { winnerSeat: best.seat, points };
}

/**
 * 生成某座位面对领出花色时的合法牌位掩码数组
 */
export function bitboardLegalMoves(
  hand: HandBitboard,
  ledSuitIdx: number, // -1 表示首家领出
): { suitIdx: number; mask: CardMask }[] {
  if (ledSuitIdx >= 0) {
    const follow = hand[ledSuitIdx];
    if (follow > 0) {
      return [{ suitIdx: ledSuitIdx, mask: follow }];
    }
  }
  // 领出或缺门垫牌/杀牌：所有非空花色均合法
  const moves: { suitIdx: number; mask: CardMask }[] = [];
  for (let s = 0; s < 4; s++) {
    if (hand[s] > 0) moves.push({ suitIdx: s, mask: hand[s] });
  }
  return moves;
}
