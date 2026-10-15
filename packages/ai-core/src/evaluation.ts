/**
 * 评估模块（SRP：只负责局面打分，不做采样 / 搜索 / 决策）。
 *
 * SOLID 说明：
 * - 单一职责：所有函数都是纯函数，只把局面映射为数值；
 * - 开闭原则：想换效用（如加入抠底翻倍）只需新增函数，调用方依赖的是数值语义；
 * - 依赖倒置：search / rollout 只依赖这里的纯函数签名，不依赖具体 Agent。
 */
import { Card, cardPoints } from '@yaozifen/game-core/cards';
import { GameState, partnerOf, sideOf, trickWinner } from '@yaozifen/game-core';

/** 一组牌的分值合计 */
export function trickPointsOf(cards: readonly Card[]): number {
  return cards.reduce((a, c) => a + cardPoints(c), 0);
}

/** 当前轮已出牌的分值 */
export function currentTrickPoints(state: GameState): number {
  return trickPointsOf(state.trick.map((t) => t.card));
}

/** 本轮的领先座位；本轮尚未出牌时返回 null */
export function currentWinningSeat(state: GameState): number | null {
  if (state.trick.length === 0 || state.trump === null) return null;
  return trickWinner(state.trick, state.trump).seat;
}

/** 搭档当前是否领先该轮 */
export function isPartnerWinning(state: GameState, seat: number): boolean {
  const w = currentWinningSeat(state);
  return w !== null && w === partnerOf(seat);
}

/** 某张牌跟上当前轮后能否成为本轮新的领先者 */
export function wouldWinTrick(state: GameState, seat: number, card: Card): boolean {
  if (state.trump === null) return false;
  const trial = [...state.trick, { seat, card }];
  return trickWinner(trial, state.trump).seat === seat;
}

/**
 * 终局效用（零和）：从 perspectiveSeat 一方视角出发。
 * - 基础项：己方出牌得分 − 对方出牌得分；
 * - 庄家方额外项：围绕叫分线的余量奖励 / 惩罚，让庄家在接近叫分线时更稳健、
 *   让闲家以压低庄家总分为目标（等价于抬高己方出牌得分）。
 */
export function sideUtility(state: GameState, perspectiveSeat: number): number {
  const mySide = sideOf(perspectiveSeat);
  const declarerSide = sideOf(state.declarer ?? perspectiveSeat);
  const declarerTotal = state.declarerTrickPoints + state.buriedPoints;
  const defenderTotal = state.defenderTrickPoints;
  const mine = mySide === declarerSide ? declarerTotal : defenderTotal;
  const theirs = mySide === declarerSide ? defenderTotal : declarerTotal;
  let u = mine - theirs;
  if (mySide === declarerSide) {
    const gap = declarerTotal - state.highestBid;
    u += gap * 0.25 + (gap >= 0 ? 15 : -15);
  }
  return u;
}
