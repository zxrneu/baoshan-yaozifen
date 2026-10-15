/**
 * 战术判断与候选牌保牌精简（SRP：只负责搭档稳赢判定与无收益牌精简）。
 *
 * 核心逻辑：
 * 1. isPartnerGuaranteedWinning: 从玩家可见信息判断搭档是否确定赢下本轮（区分最大主牌、第四手、公开缺门与后手杀牌）。
 * 2. pruneCandidates: 当搭档确定稳赢时，将同门、零分、不能改变赢家的候选合并为最小牌（保留 2，排除无收益的 K 消耗；分牌与能改变领出权的牌继续评估）。
 */
import { Card, Suit, cardId, cardPoints, cardValue, freshDeck } from '@yaozifen/game-core/cards';
import { partnerOf, sideOf, trickWinner } from '@yaozifen/game-core';
import { PlayerObservation } from './optimized/contracts';

const deck = freshDeck();

export function unseenCards(observation: PlayerObservation): Card[] {
  const known = new Set(observation.ownHand.map(cardId));
  for (const round of observation.completedRounds) {
    for (const entry of round.cards) known.add(cardId(entry.card));
  }
  for (const entry of observation.currentRound) known.add(cardId(entry.card));
  observation.knownBuriedCards?.forEach((card) => known.add(cardId(card)));
  observation.revealedHand?.cards.forEach((card) => known.add(cardId(card)));
  return deck.filter((card) => !known.has(cardId(card)));
}

/**
 * 判断搭档是否确定赢下本轮。
 * 区分：
 * - 第四手：后手已无对手，只要自己不超车，搭档必赢。
 * - 最大主牌：搭档所出牌为未见牌中最大的主牌，无人能压过。
 * - 副牌领出：后手对手是否有同门更大牌，或公开缺门后手杀牌风险。
 */
export function isPartnerGuaranteedWinning(observation: PlayerObservation): boolean {
  if (observation.currentRound.length === 0) return false;

  const currentBest = trickWinner([...observation.currentRound], observation.trump);
  const partnerSeat = partnerOf(observation.seat);
  if (currentBest.seat !== partnerSeat) return false;

  const currentCount = observation.currentRound.length;
  // 第四手：当前已有 3 张出牌，自己是最后一家，后手无任何玩家
  if (currentCount === 3) return true;

  const unseen = unseenCards(observation);
  const bestCard = currentBest.card;
  const isTrump = bestCard.suit === observation.trump;

  // 最大主牌：搭档出主牌，且所有未见牌与已知对手明牌中没有比它更大的主牌
  if (isTrump) {
    const higherTrumpUnseen = unseen.some(
      (c) => c.suit === observation.trump && cardValue(c) > cardValue(bestCard),
    );
    if (!higherTrumpUnseen) {
      if (
        observation.revealedHand &&
        sideOf(observation.revealedHand.seat) !== sideOf(observation.seat)
      ) {
        const hasHigher = observation.revealedHand.cards.some(
          (c) => c.suit === observation.trump && cardValue(c) > cardValue(bestCard),
        );
        if (hasHigher) return false;
      }
      return true;
    }
    return false;
  }

  // 搭档出副牌：
  const ledSuit = observation.currentRound[0].card.suit;
  // 1. 同门未见牌中是否有更大的牌
  const higherSameSuit = unseen.some(
    (c) => c.suit === ledSuit && cardValue(c) > cardValue(bestCard),
  );
  if (higherSameSuit) return false;

  // 2. 检查后手待出牌的对手是否有杀牌风险
  const unseenTrumps = unseen.filter((c) => c.suit === observation.trump);
  for (let offset = currentCount + 1; offset < 4; offset++) {
    const seat = (observation.leader + offset) % 4;
    if (sideOf(seat) === sideOf(observation.seat)) continue; // 己方座位不构成威胁

    // 若对手为明牌
    if (observation.revealedHand?.seat === seat) {
      const oppCards = observation.revealedHand.cards;
      const follow = oppCards.filter((c) => c.suit === ledSuit);
      if (follow.length === 0 && oppCards.some((c) => c.suit === observation.trump)) {
        return false; // 明牌对手缺门且有主，能杀牌
      }
      if (follow.some((c) => cardValue(c) > cardValue(bestCard))) {
        return false;
      }
      continue;
    }

    // 若对手为暗牌：
    // 若场上还有未见主牌：
    if (unseenTrumps.length > 0) {
      // 若对手公开缺门（已证实缺门），且对手手牌不为空，存在杀牌威胁
      if (observation.voidSuits[seat].includes(ledSuit)) {
        return false;
      }
      // 若未出尽主牌且对手暗牌张数 > 0，无法百分之百排除后手杀牌
      return false;
    }
  }

  return true;
}

/**
 * 战术候选精简：
 * 当搭档确定稳赢时，将同门、零分、不能改变赢家的候选合并为最小牌。
 * 截图局面保留 ♦2，排除无收益的 ♦K 消耗；
 * 分牌（cardPoints > 0）和能改变领出权的牌继续保留评估。
 */
export function pruneCandidates(
  observation: PlayerObservation,
  legal: readonly Card[],
): Card[] {
  if (legal.length <= 1) return [...legal];
  if (!isPartnerGuaranteedWinning(observation)) return [...legal];

  const currentBest = trickWinner([...observation.currentRound], observation.trump);
  const keep: Card[] = [];
  const zeroPointNonOvertakingBySuit = new Map<Suit, Card[]>();

  for (const card of legal) {
    const trialRound = [...observation.currentRound, { seat: observation.seat, card }];
    const trialWinner = trickWinner(trialRound, observation.trump);
    const changesWinner = trialWinner.seat !== currentBest.seat;
    const isPointCard = cardPoints(card) > 0;

    if (changesWinner || isPointCard) {
      keep.push(card);
    } else {
      const list = zeroPointNonOvertakingBySuit.get(card.suit) ?? [];
      list.push(card);
      zeroPointNonOvertakingBySuit.set(card.suit, list);
    }
  }

  for (const list of zeroPointNonOvertakingBySuit.values()) {
    // 同门、零分、不能改变赢家：只保留点数最小的一张牌
    const minCard = list.reduce((min, c) => (cardValue(c) < cardValue(min) ? c : min));
    keep.push(minCard);
  }

  return keep;
}
