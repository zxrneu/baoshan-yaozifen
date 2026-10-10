/**
 * 快速推演策略（SRP：只负责“给定世界”下各家的走子，不做采样 / 回溯 / 决策）。
 *
 * 这是蒙特卡洛推演中的默认策略（default policy），要求：
 * - 速度快（O(手牌数)，无采样、无递归）；
 * - 角色正确（搭档领先时避免抢赢本轮，赢则省、输则送）；
 * - 与 evaluation 模块的纯函数配合，可独立单测。
 *
 * SOLID：RolloutPolicy 是小接口（ISP），search 只依赖它（DIP），
 * 想换更强的推演（如带记牌）只需新实现，不用改 search。
 */
import { Card, cardPoints, cardValue } from '../cards';
import {
  basicScoring, GameState, currentSeat, legalMoves, playCard, revealedPartnerSeat,
} from '../engine';
import { currentTrickPoints, isPartnerWinning, wouldWinTrick } from './evaluation';
import { observePlayer } from './optimized/observation';
import { observationPolicy } from './optimized/policy';

export interface RolloutPolicy {
  chooseCard(state: GameState, seat: number): Card;
}

const byValueAsc = (a: Card, b: Card) => cardValue(a) - cardValue(b);
const byPointsDescValueAsc = (a: Card, b: Card) =>
  cardPoints(b) - cardPoints(a) || cardValue(a) - cardValue(b);

/** 在不抢搭档的前提下，能给搭档喂的最大分牌（跟花色约束内） */
function bestFeed(legal: Card[], state: GameState, seat: number): Card | null {
  const nonOvertaking = legal.filter((c) => !wouldWinTrick(state, seat, c));
  if (nonOvertaking.length === 0) return null;
  return [...nonOvertaking].sort(byPointsDescValueAsc)[0];
}

/** 能赢下当前轮的最便宜牌；无则返回 null */
function cheapestWinner(legal: Card[], state: GameState, seat: number): Card | null {
  const winners = legal.filter((c) => wouldWinTrick(state, seat, c));
  if (winners.length === 0) return null;
  // 能赢本轮的牌里优先用 0 分小牌，避免用 A/10 去赢低分的一轮
  winners.sort(
    (a, b) => cardPoints(a) - cardPoints(b) || cardValue(a) - cardValue(b),
  );
  return winners[0];
}

/**
 * 角色正确的快速走子：
 * - 领出：A 先行（只领非主 A，避免送主 A 被杀的弱智情况由 search 纠正），否则长门小牌；
 * - 跟牌且搭档领先：只喂分、不超车；
 * - 跟牌且对手领先：有分则用最便宜的牌抢，无分则丢最小；
 * - 缺门且搭档领先：喂最大分，绝不杀；
 * - 缺门且对手领先：本轮有分牌则用最小可赢主杀，否则丢最小损失。
 */
export function fastChooseCard(state: GameState, seat: number): Card {
  if (revealedPartnerSeat(state) !== null && state.rules.scoring === basicScoring
    && state.rules.handSize === 12 && state.rules.kittySize === 4) {
    return observationPolicy.chooseCard(observePlayer(state, seat));
  }
  const legal = legalMoves(state, seat);
  if (legal.length === 1) return legal[0];
  const trump = state.trump!;
  const hand = state.hands[seat];

  if (state.trick.length === 0) {
    const nonTrumpAces = legal
      .filter((c) => c.rank === 'A' && c.suit !== trump)
      .sort(byValueAsc);
    if (nonTrumpAces.length > 0) return nonTrumpAces[0];
    const counts = new Map<string, number>();
    for (const c of hand) counts.set(c.suit, (counts.get(c.suit) ?? 0) + 1);
    return [...legal].sort(
      (a, b) =>
        (counts.get(b.suit) ?? 0) - (counts.get(a.suit) ?? 0) ||
        cardValue(a) - cardValue(b),
    )[0];
  }

  const led = state.trick[0].card.suit;
  const mustFollow = legal[0].suit === led;
  const pts = currentTrickPoints(state);
  const partnerWins = isPartnerWinning(state, seat);

  if (mustFollow) {
    if (partnerWins) {
      // 搭档已大：喂分。注意 v1 的 bug 是这里反而去抢搭档。
      return bestFeed(legal, state, seat) ?? [...legal].sort(byValueAsc)[0];
    }
    const win = cheapestWinner(legal, state, seat);
    if (win && (pts > 0 || state.trick.length === 3)) return win;
    // 赢不了 / 不值得赢：丢分损失最小的牌
    return [...legal].sort((a, b) => cardPoints(a) - cardPoints(b) || cardValue(a) - cardValue(b))[0];
  }

  // 缺门
  if (partnerWins) {
    // 搭档领先时杀就是抢分：只垫。优先喂分牌。
    const feeds = [...legal].sort(byPointsDescValueAsc);
    // 避免把主牌 A/K 当喂牌浪费：非主分优先
    const nonTrumpFeeds = feeds.filter((c) => c.suit !== trump);
    if (nonTrumpFeeds.length > 0) return nonTrumpFeeds[0];
    // 被迫出主（满手是主）：选不超车的最小主，实在都超车才认栽
    const nonOvertakingTrump = legal
      .filter((c) => !wouldWinTrick(state, seat, c))
      .sort(byValueAsc);
    return nonOvertakingTrump[0] ?? [...legal].sort(byValueAsc)[0];
  }
  const trumps = legal.filter((c) => c.suit === trump).sort(byValueAsc);
  if (trumps.length > 0 && pts > 0) {
    const kill = trumps.find((c) => wouldWinTrick(state, seat, c));
    if (kill) return kill;
  }
  return [...legal].sort((a, b) => cardPoints(a) - cardPoints(b) || cardValue(a) - cardValue(b))[0];
}

export const fastRolloutPolicy: RolloutPolicy = {
  chooseCard: fastChooseCard,
};

/** 用给定策略把一局从当前状态走完（到达 handEnd / matchEnd），返回终局状态 */
export function rolloutToEnd(
  state: GameState,
  policy: RolloutPolicy = fastRolloutPolicy,
  guard = 200,
): GameState {
  let s = state;
  let steps = 0;
  while (s.phase === 'playing' && steps++ < guard) {
    const seat = currentSeat(s);
    s = playCard(s, seat, policy.chooseCard(s, seat));
  }
  return s;
}
