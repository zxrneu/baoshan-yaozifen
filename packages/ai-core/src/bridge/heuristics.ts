/**
 * 桥牌专家启发式规则系统 (Bridge Expert Tactics & Heuristics)。
 * 严格实现：领出清主、兑现坚强赢张、第二手出小、第三手出大与喂分、第四手便宜拿墩。
 */
import { Card, cardPoints, cardValue, Suit } from '@yaozifen/game-core/cards';
import { partnerOf, sideOf, trickWinner } from '@yaozifen/game-core';
import { PlayerObservation } from '../optimized/contracts';
import { isPartnerGuaranteedWinning, pruneCandidates, unseenCards } from '../tactics';
import { BridgeHeuristicAdvice } from './types';

/**
 * 判断一张牌是否为当前花色未出牌中的绝对最大牌（Master Card）
 */
function isMasterCard(card: Card, unseen: readonly Card[]): boolean {
  return !unseen.some((c) => c.suit === card.suit && cardValue(c) > cardValue(card));
}

/**
 * 压缩同门等价 0 分牌（Rank Equivalence Compression）：
 * 若手牌中两张同门牌均为 0 分，且场上未见牌中不存在介于它们之间的点数，则两者等价，只保留较小的一张。
 */
export function compressEquivalentCards(
  candidates: readonly Card[],
  unseen: readonly Card[],
): Card[] {
  if (candidates.length <= 1) return [...candidates];

  const bySuit = new Map<Suit, Card[]>();
  for (const c of candidates) {
    const list = bySuit.get(c.suit) ?? [];
    list.push(c);
    bySuit.set(c.suit, list);
  }

  const result: Card[] = [];
  for (const [suit, list] of bySuit.entries()) {
    if (list.length <= 1) {
      result.push(...list);
      continue;
    }
    // 按点数升序排列
    list.sort((a, b) => cardValue(a) - cardValue(b));
    const kept: Card[] = [];

    for (let i = 0; i < list.length; i++) {
      const cur = list[i];
      // 分牌不可压缩
      if (cardPoints(cur) > 0) {
        kept.push(cur);
        continue;
      }
      // 检查是否与已保留的上一张 0 分牌等价
      const prev = kept[kept.length - 1];
      if (prev && cardPoints(prev) === 0) {
        const vMin = cardValue(prev);
        const vMax = cardValue(cur);
        // 检查未见牌中是否有介于两者之间的同门牌
        const hasIntervening = unseen.some(
          (c) => c.suit === suit && cardValue(c) > vMin && cardValue(c) < vMax,
        );
        if (!hasIntervening) {
          // 两者完全等价，保留较小的 prev 即可，跳过 cur
          continue;
        }
      }
      kept.push(cur);
    }
    result.push(...kept);
  }

  return result;
}

/**
 * 桥牌专家启发式决策引擎主函数
 */
export function evaluateBridgeTactics(
  observation: PlayerObservation,
  rawLegal: readonly Card[],
): BridgeHeuristicAdvice {
  if (rawLegal.length === 0) throw new Error('合法出牌不能为空');

  // 1. 战术候选精简（搭档稳赢时排除高牌消耗）
  const legal = pruneCandidates(observation, rawLegal);
  if (legal.length === 1) {
    return {
      card: legal[0],
      intent: 'fallback',
      score: 100,
      reason: '唯一精简候选牌',
    };
  }

  const unseen = unseenCards(observation);
  const mySide = sideOf(observation.seat);
  const isDeclarerSide = mySide === sideOf(observation.declarer);
  const trump = observation.trump;
  // 己方距锁定线还差多少分。闲家线 105 - bid 是精确阈值（分值粒度为 5，
  // 见 engine/game.ts 提前结算处推导），此处用作"还需吃多少分"的剩余量。
  const targetPoints = isDeclarerSide
    ? observation.bid - observation.declarerPoints
    : 105 - observation.bid - observation.defenderPoints;

  const trickLength = observation.currentRound.length;
  const currentTrickPoints = observation.currentRound.reduce(
    (sum, t) => sum + cardPoints(t.card),
    0,
  );

  // -------------------------------------------------------------
  // 第四手决策 (Fourth Hand Resolution)
  // -------------------------------------------------------------
  if (trickLength === 3) {
    const bestSoFar = trickWinner([...observation.currentRound], trump);
    const partnerWon = sideOf(bestSoFar.seat) === mySide;

    if (partnerWon) {
      // 搭档已经拿下本轮！
      // 策略：安全喂分 (A > 10 > 5)，若无分牌则出最小 0 分牌
      const pointCards = legal.filter((c) => cardPoints(c) > 0);
      if (pointCards.length > 0) {
        // 优先垫 10 和 5，把分牌安全喂给搭档入账
        pointCards.sort((a, b) => cardPoints(b) - cardPoints(a));
        return {
          card: pointCards[0],
          intent: 'feed_points',
          score: 95 + cardPoints(pointCards[0]),
          reason: `第四手搭档稳赢，安全喂分 ${pointCards[0].rank}${pointCards[0].suit}`,
        };
      }
      // 无分牌，垫同门/非主最小牌
      const sortedByVal = [...legal].sort((a, b) => cardValue(a) - cardValue(b));
      return {
        card: sortedByVal[0],
        intent: 'fourth_pitch',
        score: 80,
        reason: '第四手搭档稳赢，垫出最小牌保牌',
      };
    } else {
      // 对手当前大：
      // 寻找能够压过的牌
      const winningCards = legal.filter((c) => {
        const trial = [...observation.currentRound, { seat: observation.seat, card: c }];
        return trickWinner(trial, trump).seat === observation.seat;
      });

      if (winningCards.length > 0) {
        // 能赢！检查本轮吃分是否能直接锁定胜局
        winningCards.sort((a, b) => cardValue(a) - cardValue(b));
        for (const c of winningCards) {
          const totalPoints = currentTrickPoints + cardPoints(c);
          if (totalPoints >= targetPoints && targetPoints > 0) {
            return {
              card: c,
              intent: 'lock_victory',
              score: 200,
              reason: `第四手吃下 ${totalPoints} 分锁定本局胜利！`,
            };
          }
        }
        // 便宜拿墩：用最小可赢的牌赢下
        const cheapestWin = winningCards[0];
        const gain = currentTrickPoints + cardPoints(cheapestWin);
        // 如果本轮有分，或者代价较小，果断赢下
        if (gain > 0 || cheapestWin.suit !== trump || cardValue(cheapestWin) < 8) {
          return {
            card: cheapestWin,
            intent: 'fourth_cheap_win',
            score: 90 + gain,
            reason: `第四手便宜拿墩，吃进 ${gain} 分`,
          };
        }
      }
      // 无法赢下或代价不值，弃最小牌
      const zeroCards = legal.filter((c) => cardPoints(c) === 0);
      const discardPool = zeroCards.length > 0 ? zeroCards : legal;
      const sortedAsc = [...discardPool].sort((a, b) => cardValue(a) - cardValue(b));
      return {
        card: sortedAsc[0],
        intent: 'fourth_pitch',
        score: 50,
        reason: '第四手无法赢下或弃牌更优，垫最小无用牌',
      };
    }
  }

  // -------------------------------------------------------------
  // 第三手决策 (Third Hand: Third Hand High & Feeding)
  // -------------------------------------------------------------
  if (trickLength === 2) {
    const bestSoFar = trickWinner([...observation.currentRound], trump);
    const partnerSeat = partnerOf(observation.seat);
    const partnerIsBest = bestSoFar.seat === partnerSeat;

    if (partnerIsBest) {
      // 检查搭档是否确定不被第四手压过
      const partnerGuaranteed = isPartnerGuaranteedWinning(observation);
      if (partnerGuaranteed) {
        // 安全喂分
        const pointCards = legal.filter((c) => cardPoints(c) > 0);
        if (pointCards.length > 0) {
          pointCards.sort((a, b) => cardPoints(b) - cardPoints(a));
          return {
            card: pointCards[0],
            intent: 'feed_points',
            score: 95 + cardPoints(pointCards[0]),
            reason: '第三手搭档已稳赢，安全送出分牌',
          };
        }
        const sortedMin = [...legal].sort((a, b) => cardValue(a) - cardValue(b));
        return {
          card: sortedMin[0],
          intent: 'fourth_pitch',
          score: 80,
          reason: '第三手搭档已稳赢，跟最小牌保牌',
        };
      }
    }

    // 对手大，或者搭档牌不够大（有被第四手盖吃的风险）：
    // 第三手出大 (Third Hand High)
    const ledSuit = observation.currentRound[0].card.suit;
    if (legal[0].suit === ledSuit) {
      // 跟同门：尝试用大牌争夺
      const winners = legal.filter((c) => {
        const trial = [...observation.currentRound, { seat: observation.seat, card: c }];
        return trickWinner(trial, trump).seat === observation.seat;
      });
      if (winners.length > 0) {
        // 出能压过的牌中最大的保护牌，或最小赢牌
        winners.sort((a, b) => cardValue(b) - cardValue(a));
        return {
          card: winners[0],
          intent: 'third_hand_high',
          score: 85,
          reason: '第三手出大牌保护墩或逼出对手更大牌',
        };
      }
      // 无法压过：跟最小牌
      const sorted = [...legal].sort((a, b) => cardValue(a) - cardValue(b));
      return {
        card: sorted[0],
        intent: 'fallback',
        score: 40,
        reason: '第三手无法压过，跟同门最小牌',
      };
    } else {
      // 缺门杀牌或垫牌
      const trumps = legal.filter((c) => c.suit === trump);
      if (trumps.length > 0 && currentTrickPoints >= 10) {
        trumps.sort((a, b) => cardValue(a) - cardValue(b));
        return {
          card: trumps[0],
          intent: 'third_hand_high',
          score: 90,
          reason: '第三手本轮有大分，用主牌杀下争夺吃分',
        };
      }
      const safeZero = legal.filter((c) => cardPoints(c) === 0);
      const pool = safeZero.length > 0 ? safeZero : legal;
      const sorted = [...pool].sort((a, b) => cardValue(a) - cardValue(b));
      return {
        card: sorted[0],
        intent: 'fourth_pitch',
        score: 45,
        reason: '第三手无分不盲目动主，垫非分小牌',
      };
    }
  }

  // -------------------------------------------------------------
  // 第二手决策 (Second Hand Low)
  // -------------------------------------------------------------
  if (trickLength === 1) {
    const ledSuit = observation.currentRound[0].card.suit;
    if (legal[0].suit === ledSuit) {
      // 同门：第二手出小 (Second hand low)
      // 除非我们持有该门最大牌且本轮有分，或者手持 KQ 试探出 Q
      const sortedAsc = [...legal].sort((a, b) => cardValue(a) - cardValue(b));
      const myMax = sortedAsc[sortedAsc.length - 1];

      if (isMasterCard(myMax, unseen) && currentTrickPoints >= 10) {
        return {
          card: myMax,
          intent: 'cash_winner',
          score: 88,
          reason: '第二手本轮已有大分，以最大牌直接截获',
        };
      }
      return {
        card: sortedAsc[0],
        intent: 'second_hand_low',
        score: 75,
        reason: '第二手出小原则：保留大牌给第三/四手应对',
      };
    } else {
      // 缺门：第二手面对领出缺门，只有高分轮才动小主，否则垫废牌
      const trumps = legal.filter((c) => c.suit === trump);
      if (trumps.length > 0 && currentTrickPoints >= 15) {
        trumps.sort((a, b) => cardValue(a) - cardValue(b));
        return {
          card: trumps[0],
          intent: 'third_hand_high',
          score: 85,
          reason: '第二手高分轮动用小主截获',
        };
      }
      const zeroCards = legal.filter((c) => cardPoints(c) === 0 && c.suit !== trump);
      const pool = zeroCards.length > 0 ? zeroCards : legal;
      const sorted = [...pool].sort((a, b) => cardValue(a) - cardValue(b));
      return {
        card: sorted[0],
        intent: 'second_hand_low',
        score: 60,
        reason: '第二手缺门不轻易送主，垫非主小牌',
      };
    }
  }

  // -------------------------------------------------------------
  // 第一手决策 (Leader / Opening Lead: Drawing Trumps & Cashing)
  // -------------------------------------------------------------
  // 1. 做庄/主牌优势方拔主规划 (Drawing Trumps)
  const myTrumps = legal.filter((c) => c.suit === trump);
  const oppUnseenTrumps = unseen.filter((c) => c.suit === trump).length;

  if (myTrumps.length > 0 && isDeclarerSide && oppUnseenTrumps > 0) {
    // 检查是否有副牌高分赢张待兑现
    const sideWinners = legal.filter(
      (c) => c.suit !== trump && cardPoints(c) > 0 && isMasterCard(c, unseen),
    );
    // 己方主牌占优，拔主防止副牌被杀
    if (sideWinners.length > 0 || myTrumps.length >= oppUnseenTrumps) {
      myTrumps.sort((a, b) => cardValue(b) - cardValue(a));
      return {
        card: myTrumps[0],
        intent: 'draw_trumps',
        score: 92,
        reason: '做庄拔主原则：出大主肃清防守方主牌，保护副牌赢张安全兑现',
      };
    }
  }

  // 2. 兑现坚强副牌赢张 (Cashing Established Winners)
  const masterSideCards = legal.filter((c) => c.suit !== trump && isMasterCard(c, unseen));
  if (masterSideCards.length > 0) {
    // 检查是否有对手可能绝门杀牌
    masterSideCards.sort((a, b) => cardPoints(b) - cardPoints(a) || cardValue(b) - cardValue(a));
    for (const master of masterSideCards) {
      // 检查对手是否已有确定的该门缺门且可能存主
      const enemies = [0, 1, 2, 3].filter((s) => sideOf(s) !== mySide);
      const hasVoidEnemy = enemies.some(
        (s) => observation.voidSuits[s].includes(master.suit) && oppUnseenTrumps > 0,
      );
      if (!hasVoidEnemy) {
        return {
          card: master,
          intent: 'cash_winner',
          score: 90 + cardPoints(master),
          reason: `领出坚强赢张 ${master.rank}${master.suit}，抢先兑现分牌`,
        };
      }
    }
  }

  // 3. 长套树立或安全脱手 (Promotion & Safe Exit)
  // 避免领出孤张 10 或 5（容易送分给敌方大牌）
  const safeNonPoint = legal.filter((c) => cardPoints(c) === 0);
  const pool = safeNonPoint.length > 0 ? safeNonPoint : legal;

  // 统计各花色长度，优先出长套
  const lengths = new Map<Suit, number>();
  for (const c of observation.ownHand) lengths.set(c.suit, (lengths.get(c.suit) ?? 0) + 1);

  const sortedLead = [...pool].sort(
    (a, b) =>
      (lengths.get(b.suit) ?? 0) - (lengths.get(a.suit) ?? 0) || cardValue(a) - cardValue(b),
  );

  return {
    card: sortedLead[0],
    intent: 'safe_exit',
    score: 70,
    reason: `领出长门小牌 ${sortedLead[0].rank}${sortedLead[0].suit} 安全脱手并试探分布`,
  };
}
