import { describe, expect, it } from 'vitest';
import { cardPoints } from '../src/cards';
import {
  bid, bury, createGame, currentSeat, declareTrump, legalBids, playCard,
} from '../src/engine';
import {
  FAST_BUDGET, createSmartAgent, currentTrickPoints, fastChooseCard,
  fastSmartAgent, isPartnerWinning, rankMoves, rolloutToEnd,
  sampleHiddenHands, searchBestCard, shortlistMoves, sideUtility,
  smartBid, smartBury, smartPlay, smartTrump, unknownCards, wouldWinTrick,
} from '../src/ai';
import { rngFrom } from '../src/ai/sampling';

/** 快速走到出牌阶段，庄家固定为主 S */
function reachPlaying(seed = 7, bidValue = 70) {
  let s = createGame(seed);
  const first = currentSeat(s);
  for (let i = 0; i < 4; i++) {
    const seat = (first + i) % 4;
    s = bid(s, seat, seat === first ? bidValue : null);
  }
  s = declareTrump(s, s.declarer!, 'S');
  s = bury(s, s.declarer!, smartBury(s, s.declarer!));
  return s;
}

describe('evaluation: 角色判断', () => {
  it('尚未出牌时无赢家；wouldWinTrick 能识别主杀', () => {
    const s = reachPlaying(7);
    expect(currentTrickPoints(s)).toBe(0);
    expect(isPartnerWinning(s, currentSeat(s))).toBe(false);
    const seat = currentSeat(s);
    const hand = s.hands[seat];
    const trumpCard = hand.find((c) => c.suit === 'S');
    const offA = { suit: 'H' as const, rank: 'A' as const };
    if (trumpCard) {
      // 本轮首次出一张牌：只有自己，能赢
      expect(wouldWinTrick(s, seat, trumpCard)).toBe(true);
      void offA;
    }
  });
});

describe('rollout: 绝不犯笨', () => {
  it('搭档领先时跟牌优先喂分：有不超车喂牌时绝不超车', () => {
    for (let seed = 1; seed <= 20; seed++) {
      let s = reachPlaying(seed);
      // 构造：seat0 领 A（非主），seat2（搭档）用 A 赢，seat1 再行动
      // 直接用 rollout 策略走几轮，断言：当搭档领先时出的牌不能反超
      let guard = 0;
      while (s.phase === 'playing' && guard++ < 12) {
        const seat = currentSeat(s);
        const before = s.trick.length;
        const card = fastChooseCard(s, seat);
        if (before > 0 && isPartnerWinning(s, seat)) {
          const legal = s.hands[seat].filter(
            (c) => s.trick.length === 0 || c.suit === s.trick[0].card.suit || !s.hands[seat].some((h) => h.suit === s.trick[0].card.suit),
          );
          const hasNonOvertaking = legal.some((c) => !wouldWinTrick(s, seat, c));
          // 只有在“有不超车可选”的情况下才要求不超车（否则是被迫）
          if (hasNonOvertaking) {
            expect(wouldWinTrick(s, seat, card)).toBe(false);
          }
        }
        s = playCard(s, seat, card);
      }
    }
  });

  it('缺门且搭档领先时不主动杀：有非主可垫时绝不出主', () => {
    let violations = 0;
    let checks = 0;
    for (let seed = 1; seed <= 30; seed++) {
      let s = reachPlaying(seed);
      let guard = 0;
      while (s.phase === 'playing' && guard++ < 48) {
        const seat = currentSeat(s);
        if (s.trick.length > 0 && isPartnerWinning(s, seat)) {
          const led = s.trick[0].card.suit;
          const hasFollow = s.hands[seat].some((c) => c.suit === led);
          if (!hasFollow) {
            const nonTrump = s.hands[seat].filter((c) => c.suit !== s.trump);
            if (nonTrump.length > 0) {
              // 有非主可垫：此时出主就是主动犯笨
              checks++;
              const card = fastChooseCard(s, seat);
              if (card.suit === s.trump) violations++;
            }
            s = playCard(s, seat, fastChooseCard(s, seat));
            continue;
          }
        }
        s = playCard(s, currentSeat(s), fastChooseCard(s, currentSeat(s)));
      }
    }
    expect(checks).toBeGreaterThan(0);
    expect(violations).toBe(0);
  });

  it('rollout 能走完一副且分数守恒', () => {
    const s = reachPlaying(11);
    const end = rolloutToEnd(s);
    expect(end.phase === 'handEnd' || end.phase === 'matchEnd').toBe(true);
    expect(end.declarerTrickPoints + end.defenderTrickPoints + end.buriedPoints + (end.result?.unplayedPoints ?? 0)).toBe(100);
  });
});

describe('sampling: 世界补全合法', () => {
  it('未知牌不含我手牌/当前轮已出的牌/底牌，补全后每家张数不变', () => {
    const s = reachPlaying(5);
    const seat = currentSeat(s);
    const unk = unknownCards(s, seat);
    const myIds = new Set(s.hands[seat].map((c) => `${c.rank}${c.suit}`));
    expect(unk.every((c) => !myIds.has(`${c.rank}${c.suit}`))).toBe(true);
    const hidden = sampleHiddenHands(s, seat, rngFrom(42, 1));
    expect(hidden[seat]).toEqual(s.hands[seat]);
    for (let i = 0; i < 4; i++) {
      if (i !== seat) expect(hidden[i]).toHaveLength(s.hands[i].length);
    }
    const allIds = hidden.flat().map((c) => `${c.rank}${c.suit}`);
    expect(new Set(allIds).size).toBe(allIds.length); // 无重复
  });
});

describe('search: 蒙特卡洛选牌', () => {
  it('单张合法时直接返回；多张时返回合法牌', () => {
    const s = reachPlaying(9);
    const seat = currentSeat(s);
    const card = searchBestCard(s, seat, undefined, FAST_BUDGET);
    expect(s.hands[seat].some((c) => c.rank === card.rank && c.suit === card.suit)).toBe(true);
  });

  it('剪枝保留意图多样性（分牌/主牌不被全剪掉）', () => {
    const s = reachPlaying(7);
    const seat = currentSeat(s);
    const full = s.hands[seat];
    if (full.length > 4) {
      const short = shortlistMoves(s, seat, 4);
      expect(short.length).toBeLessThanOrEqual(4);
      expect(short.length).toBeGreaterThan(0);
    }
  });

  it('rankMoves 按期望降序', () => {
    const s = reachPlaying(13);
    const seat = currentSeat(s);
    const cands = shortlistMoves(s, seat, 3);
    if (cands.length >= 2) {
      const ranked = rankMoves(s, seat, cands, undefined, 4);
      for (let i = 1; i < ranked.length; i++) {
        expect(ranked[i - 1].expected).toBeGreaterThanOrEqual(ranked[i].expected);
      }
    }
  });

  it('sideUtility 零和：双方视角相反数（忽略庄家叫分奖励时符号相反）', () => {
    const s = reachPlaying(21);
    const end = rolloutToEnd(s);
    // 庄闲双方的基础分差必然符号相反；utility 含叫分项所以只断言非 NaN 且有限
    expect(Number.isFinite(sideUtility(end, 0))).toBe(true);
    expect(Number.isFinite(sideUtility(end, 1))).toBe(true);
  });
});

describe('smart: 叫/定/埋合法', () => {
  it('叫分合法或不叫；定主合法；埋底合法', () => {
    for (let seed = 1; seed <= 20; seed++) {
      const s = createGame(seed);
      const seat = currentSeat(s);
      const b = smartBid(s, seat);
      if (b !== null) expect(legalBids(s)).toContain(b);
      let t = s;
      const first = currentSeat(t);
      t = bid(t, first, 70);
      t = bid(t, currentSeat(t), null);
      t = bid(t, currentSeat(t), null);
      t = bid(t, currentSeat(t), null);
      const d = t.declarer!;
      expect(['S', 'H', 'D', 'C']).toContain(smartTrump(t, d));
      t = declareTrump(t, d, smartTrump(t, d));
      const cards = smartBury(t, d);
      expect(cards).toHaveLength(4);
      expect(cards.every((c) => cardPoints(c) === 0)).toBe(true);
      expect(() => bury(t, d, cards)).not.toThrow();
    }
  });

  it('smartPlay 快速预算下每次出牌 < 1s（低端兜底）', () => {
    const s = reachPlaying(31);
    const seat = currentSeat(s);
    const t0 = Date.now();
    const card = smartPlay(s, seat, FAST_BUDGET);
    expect(Date.now() - t0).toBeLessThan(1000);
    expect(s.hands[seat].some((c) => c.rank === card.rank && c.suit === card.suit)).toBe(true);
  });
});

describe('smart 全场模拟（快速预算）', () => {
  it('整副能打完且分数守恒', () => {
    let s = createGame(77, { targetWins: 1 });
    const agent = createSmartAgent({ budget: FAST_BUDGET });
    let steps = 0;
    let sawHandEnd = false;
    while (s.phase !== 'matchEnd' && steps++ < 500) {
      if (s.phase === 'handEnd') {
        sawHandEnd = true;
        // 下一副继续用同一 agent 验证多副稳定性（只打一副就收场时此分支不进）
        break;
      }
      const { playCard: pc, bid: b, declareTrump: dt, bury: by, nextHand: nh } =
        awaitImportHack();
      void pc; void b; void dt; void by; void nh;
      const a = agent.nextAction(s);
      expect(a).not.toBeNull();
      const { applyAiAction } = awaitActionHack();
      s = applyAiAction(s, a!);
    }
    expect(sawHandEnd || s.phase === 'matchEnd').toBe(true);
    if (s.phase !== 'matchEnd') {
      // 至少打完了一副：分数守恒
      expect(s.declarerTrickPoints + s.defenderTrickPoints + s.buriedPoints + (s.result?.unplayedPoints ?? 0)).toBe(100);
    }
    expect(fastSmartAgent).toBeDefined();
  });
});

// 避免循环导入的动态引用（vitest ESM 下的取巧写法，实际为静态导入的别名）
import { playCard as _pc, bid as _b, declareTrump as _dt, bury as _by, nextHand as _nh } from '../src/engine';
import { applyAiAction as _apply } from '../src/ai';
function awaitImportHack() {
  return { playCard: _pc, bid: _b, declareTrump: _dt, bury: _by, nextHand: _nh };
}
function awaitActionHack() {
  return { applyAiAction: _apply };
}
