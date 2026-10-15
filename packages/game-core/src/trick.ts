/**
 * 轮内比较：纯函数，不涉及对局状态。
 */
import { Card, Suit, cardValue } from './cards';
import { TrickCard } from './types';

/** 比较两张牌在当前轮中的大小（a 能否压过 b） */
export function beats(a: Card, b: Card, trump: Suit): boolean {
  const aT = a.suit === trump;
  const bT = b.suit === trump;
  if (aT !== bT) return aT;
  if (a.suit !== b.suit) return false; // 同为非主且不同门：压不过
  return cardValue(a) > cardValue(b);
}

/** 计算当前轮赢家 */
export function trickWinner(trick: TrickCard[], trump: Suit): TrickCard {
  let best = trick[0];
  for (let i = 1; i < trick.length; i++) {
    if (beats(trick[i].card, best.card, trump)) best = trick[i];
  }
  return best;
}
