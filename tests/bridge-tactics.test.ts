import { describe, expect, it } from 'vitest';
import { makeCard } from '@yaozifen/game-core/cards';
import { PlayerObservation } from '@yaozifen/ai-core/optimized/contracts';
import {
  compressEquivalentCards,
  evaluateBridgeTactics,
} from '@yaozifen/ai-core/bridge/heuristics';

function createObservation(overrides: Partial<PlayerObservation> = {}): PlayerObservation {
  const c = makeCard;
  const defaultHand = [c('D', 'K'), c('D', '2')];
  return {
    seat: 0, // 东家
    ownHand: defaultHand,
    handCounts: [2, 2, 2, 2],
    declarer: 2, // 西家做庄 (与东家是搭档)
    bid: 70,
    trump: 'D', // 方块为主牌
    leader: 2, // 西家领出
    roundNumber: 11,
    currentRound: [],
    completedRounds: [],
    voidSuits: [[], [], [], []],
    declarerPoints: 50,
    defenderPoints: 20,
    kittySize: 4,
    ruleId: 'basic-v1',
    ...overrides,
  };
}

describe('桥牌专家战术规则系统 (Bridge Expert Tactics)', () => {
  it('做庄领出拔主：庄家主牌优势且副牌有赢张待兑现时，优先领出大主拔主', () => {
    const c = makeCard;
    // 西家庄家，持有 ♦A, ♦K, ♦5, 以及副牌 ♠A
    const hand = [c('D', 'A'), c('D', 'K'), c('D', '5'), c('S', 'A')];
    const obs = createObservation({
      seat: 2,
      declarer: 2,
      ownHand: hand,
      currentRound: [],
      leader: 2,
    });

    const advice = evaluateBridgeTactics(obs, hand);
    expect(advice.intent).toBe('draw_trumps');
    expect(advice.card.suit).toBe('D');
    expect(advice.card.rank).toBe('A');
  });

  it('领出坚强副牌赢张：未见更大牌且对手无缺门杀牌威胁，主动兑现', () => {
    const c = makeCard;
    // 手持 ♠A, ♣8, ♣3，无主牌
    const hand = [c('S', 'A'), c('C', '8'), c('C', '3')];
    const obs = createObservation({
      seat: 0,
      ownHand: hand,
      currentRound: [],
      leader: 0,
    });

    const advice = evaluateBridgeTactics(obs, hand);
    expect(advice.intent).toBe('cash_winner');
    expect(advice.card.suit).toBe('S');
    expect(advice.card.rank).toBe('A');
  });

  it('第二手出小原则：面对小牌领出，第二手跟同门最小牌保牌', () => {
    const c = makeCard;
    // 领出 ♥3，第二手持 ♥K 与 ♥2
    const hand = [c('H', 'K'), c('H', '2')];
    const obs = createObservation({
      seat: 1, // 南家
      ownHand: hand,
      leader: 0,
      currentRound: [{ seat: 0, card: c('H', '3') }],
    });

    const advice = evaluateBridgeTactics(obs, hand);
    expect(advice.intent).toBe('second_hand_low');
    expect(advice.card.rank).toBe('2');
    expect(advice.card.suit).toBe('H');
  });

  it('第四手安全喂分：搭档已稳赢时，垫出手中分牌入账', () => {
    const c = makeCard;
    // 第一手搭档西家(2)出 ♦A (主牌最大牌)，北家跟 ♦3，南家跟 ♦2
    // 东家(0)是搭档，第四手持 ♦10 (分牌) 与 ♦4
    const hand = [c('D', '10'), c('D', '4')];
    const obs = createObservation({
      seat: 0,
      ownHand: hand,
      leader: 2,
      currentRound: [
        { seat: 2, card: c('D', 'A') },
        { seat: 3, card: c('D', '3') },
        { seat: 1, card: c('D', '2') },
      ],
    });

    const advice = evaluateBridgeTactics(obs, hand);
    expect(advice.intent).toBe('feed_points');
    expect(advice.card.rank).toBe('10');
  });

  it('第四手便宜拿墩：对手大时以最小能赢的牌吃下', () => {
    const c = makeCard;
    // 西家(2,对手)领出 ♥10 (当前最大)，北家(3,搭档)跟 ♥2，东家(0,对手)跟 ♥4
    // 南家(1)第四手持 ♥K 与 ♥A，都能压过西家 ♥10
    const hand = [c('H', 'A'), c('H', 'K')];
    const obs = createObservation({
      seat: 1,
      defenderPoints: 0,
      ownHand: hand,
      leader: 2,
      currentRound: [
        { seat: 2, card: c('H', '10') },
        { seat: 3, card: c('H', '2') },
        { seat: 0, card: c('H', '4') },
      ],
    });

    const advice = evaluateBridgeTactics(obs, hand);
    // 应以最小能赢的牌 (♥K) 赢下对手
    expect(advice.intent).toBe('fourth_cheap_win');
    expect(advice.card.rank).toBe('K');
  });

  it('第四手胜负锁定：吃下该轮直接达成叫分时触发 lock_victory', () => {
    const c = makeCard;
    // 庄家叫 70 分，当前已吃 55 分，距离获胜还差 15 分
    // 场上已有 10 分 (北家对手出 ♠10 处于领先)，东家庄家(0)第四手出 ♠A 亲自吃下 25 分直接成局！
    const hand = [c('S', 'A'), c('S', '4')];
    const obs = createObservation({
      seat: 0,
      declarer: 0,
      bid: 70,
      declarerPoints: 55,
      ownHand: hand,
      leader: 3,
      currentRound: [
        { seat: 3, card: c('S', '10') }, // 对手北家(3)领出 ♠10 (当前占先)
        { seat: 1, card: c('S', '5') },  // 对手南家(1)跟 ♠5 (已有15分)
        { seat: 2, card: c('S', '2') },  // 搭档西家(2)跟 ♠2
      ],
    });

    const advice = evaluateBridgeTactics(obs, hand);
    // 出 ♠A 压过对手吃下本轮 25 分，累计 80 分锁定胜局
    expect(advice.intent).toBe('lock_victory');
    expect(advice.card.rank).toBe('A');
  });

  it('等价牌压缩：同门连续 0 分牌正确压缩', () => {
    const c = makeCard;
    const candidates = [c('C', '9'), c('C', '8'), c('C', '10')];
    // 场上没有 C 介于 9 和 8 之间的牌
    const unseen = [c('C', 'A'), c('C', '2')];
    const compressed = compressEquivalentCards(candidates, unseen);
    // 10是分牌必须保留，9和8中只保留较小的8
    expect(compressed).toHaveLength(2);
    expect(compressed.some((x) => x.rank === '10')).toBe(true);
    expect(compressed.some((x) => x.rank === '8')).toBe(true);
    expect(compressed.some((x) => x.rank === '9')).toBe(false);
  });
});
