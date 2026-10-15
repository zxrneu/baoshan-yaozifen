/**
 * 聪明决策引擎启发式战术专项测试 (tests/smart-heuristics.test.ts)
 * 验证 A2.1 规划中的策略战术修复：
 * 1. 均型散分牌防陷阱 Pass，根除无脑叫 100 分；
 * 2. 5张套标准起叫与 7张特长套起叫平滑化 (70/75 分，杜绝虚高 85/90)；
 * 3. 起叫与竞争叫分分流：高位防守 Pass、对手先叫我持强套竞争加叫、搭档最高不抬庄；
 * 4. 扣底副牌 K 保护，严禁将副牌 K 扣入底牌；
 * 5. 扣底护张保护，严防扣掉 4C 留下单张死 KC 陷阱。
 */
import { describe, expect, it } from 'vitest';
import { Card, makeCard } from '@yaozifen/game-core/cards';
import { createGame, bid, currentSeat } from '@yaozifen/game-core';
import { observeBidding } from '@yaozifen/game-view/decisionObservation';
import { smartBid, bidFromObservation, smartTrump, smartBury, buryFromObservation } from '@yaozifen/ai-core/smart';

const c = makeCard;
const id = (card: Card) => `${card.rank}${card.suit}`;

describe('A2.1 叫分启发式战术修复 (Bidding Tactics)', () => {
  it('均型多分无套陷阱手坚决 Pass，严禁盲目叫高分甚至 100 分', () => {
    // 3-3-3-3 均匀分布，4张10 + 4张5 共 60 分，但 0 HCP，无 5 张套
    const hand: Card[] = [
      c('S', '10'), c('S', '5'), c('S', '2'),
      c('H', '10'), c('H', '5'), c('H', '2'),
      c('C', '10'), c('C', '5'), c('C', '2'),
      c('D', '10'), c('D', '5'), c('D', '2'),
    ];
    let state = createGame(1);
    state = { ...state, hands: state.hands.map((h, i) => (i === 1 ? [...hand] : h)) };

    const action = smartBid(state, 1);
    expect(action).toBeNull();
  });

  it('标准 5 张套带 AK 顶张平稳起叫 70 或 75 分，不虚高至 85/90', () => {
    // ♠AK1073 (20分) + ♥K82 + ♣104 (10分) + ♦92，总分 30，HCP 10
    const hand: Card[] = [
      c('S', 'A'), c('S', 'K'), c('S', '10'), c('S', '7'), c('S', '3'),
      c('H', 'K'), c('H', '8'), c('H', '2'),
      c('C', '10'), c('C', '4'),
      c('D', '9'), c('D', '2'),
    ];
    let state = createGame(1);
    state = { ...state, hands: state.hands.map((h, i) => (i === 1 ? [...hand] : h)) };

    const action = smartBid(state, 1);
    expect([70, 75]).toContain(action);
  });

  it('7 张弱套带单张绝门破格起叫 70 或 75 分，不虚高至 90', () => {
    // ♣AK98742 (10分) + ♠A6 (10分) + ♥83 + ♦2 单张
    const hand: Card[] = [
      c('C', 'A'), c('C', 'K'), c('C', '9'), c('C', '8'), c('C', '7'), c('C', '4'), c('C', '2'),
      c('S', 'A'), c('S', '6'),
      c('H', '8'), c('H', '3'),
      c('D', '2'),
    ];
    let state = createGame(1);
    state = { ...state, hands: state.hands.map((h, i) => (i === 1 ? [...hand] : h)) };

    const action = smartBid(state, 1);
    expect([70, 75]).toContain(action);
  });

  it('对手叫至 85 分时，中等牌力遵守防守纪律坚决 Pass', () => {
    // 中等 5 张套 25 分牌，不足以承担 90 分风险
    const hand: Card[] = [
      c('S', 'A'), c('S', '9'), c('S', '8'), c('S', '4'), c('S', '3'),
      c('H', 'K'), c('H', '10'), c('H', '2'),
      c('C', '5'), c('C', '2'),
      c('D', '8'), c('D', '4'),
    ];
    const obs = {
      seat: 1,
      ownHand: hand,
      legalBids: [90, 95, 100],
      minBid: 70,
      maxBid: 100,
      bidStep: 5,
      highestBid: 85,
      highestBidder: 0,
      bidHistory: [{ seat: 0, bid: 85 }],
    };

    const action = bidFromObservation(obs);
    expect(action).toBeNull();
  });

  it('[P2复现] 对手叫至 85 分时，最长套仅 4 张虽满分且高 HCP 亦严禁追叫 100，坚决 Pass', () => {
    // ♠AKQ10 (20分), ♥AKQ10 (20分), ♦A5 (15分), ♣52 (5分)
    // rawPts = 60, HCP = 22, 最长套仅 4 张
    const hand: Card[] = [
      c('S', 'A'), c('S', 'K'), c('S', 'Q'), c('S', '10'),
      c('H', 'A'), c('H', 'K'), c('H', 'Q'), c('H', '10'),
      c('D', 'A'), c('D', '5'),
      c('C', '5'), c('C', '2'),
    ];
    const obs = {
      seat: 1,
      ownHand: hand,
      legalBids: [90, 95, 100],
      minBid: 70,
      maxBid: 100,
      bidStep: 5,
      highestBid: 85,
      highestBidder: 0,
      bidHistory: [{ seat: 0, bid: 85 }],
    };

    const action = bidFromObservation(obs);
    expect(action).toBeNull();
  });

  it('对手叫至 75 后首次轮到自己，持六张强套竞争叫 80 或 85 并能合法提交', () => {
    const scenario = BIDDING_SCENARIOS.find((item) => item.id === 'bid-rebid-raise')!;
    const { state, seat } = scenario.setup();
    expect(state).toBeDefined();
    if (!state) throw new Error('叫分场景缺少牌局');

    expect(state.phase).toBe('bidding');
    expect(currentSeat(state)).toBe(seat);
    expect(state.bidding.some((note) => note.seat === seat)).toBe(false);

    // 从同一副牌的起叫状态重放历史，确保场景能够由真实状态机到达。
    const replayed = state.bidding.reduce<typeof state>(
      (current, note) => bid(current, note.seat, note.bid),
      { ...state, bidding: [], highestBid: 0, highestBidder: null },
    );
    expect(replayed.phase).toBe('bidding');
    expect(currentSeat(replayed)).toBe(seat);
    expect(replayed.highestBid).toBe(75);

    const action = bidFromObservation(observeBidding(replayed, seat));
    expect([80, 85]).toContain(action);
    const after = bid(replayed, seat, action);
    expect(after.highestBid).toBe(action);
    expect(after.highestBidder).toBe(seat);
  });

  it('搭档当前为最高叫分者时，原则上不盲目抬高自己方的叫分线', () => {
    // 南家(1)看到搭档北家(3)叫了 70 分，自己是标准 30 分 5 张套手牌
    const hand: Card[] = [
      c('S', 'A'), c('S', 'K'), c('S', '10'), c('S', '7'), c('S', '3'),
      c('H', 'K'), c('H', '8'), c('H', '2'),
      c('C', '10'), c('C', '4'),
      c('D', '9'), c('D', '2'),
    ];
    const obs = {
      seat: 1,
      ownHand: hand,
      legalBids: [75, 80, 85, 90, 95, 100],
      minBid: 70,
      maxBid: 100,
      bidStep: 5,
      highestBid: 70,
      highestBidder: 3, // 搭档北家
      bidHistory: [{ seat: 3, bid: 70 }],
    };

    const action = bidFromObservation(obs);
    expect(action).toBeNull();
  });

  it('[P1复现] createGame(5438) 四家使用 smartBid 应能推进至定主阶段，重发牌推进随机种子打破无限循环', () => {
    let state = createGame(5438);
    let steps = 0;
    while (state.phase === 'bidding' && steps < 100) {
      const currentSeat = state.bidOrder[state.bidding.length];
      const b = smartBid(state, currentSeat);
      state = bid(state, currentSeat, b);
      steps++;
    }
    expect(steps).toBeLessThan(100);
    expect(state.phase).not.toBe('bidding');
  });

  it('[P1回归] 连续全员 Pass 时，重发逻辑推进随机种子，避免固定周期循环重复相同牌面', () => {
    let state = createGame(100);
    const seenHandFingerprints = new Set<string>();
    // 连续 8 轮全员 Pass（共 32 次叫分，触发 8 次重新发牌）
    for (let round = 0; round < 8; round++) {
      const fingerprint = state.hands[0].map(c => `${c.suit}${c.rank}`).sort().join(',');
      expect(seenHandFingerprints.has(fingerprint)).toBe(false);
      seenHandFingerprints.add(fingerprint);
      for (let i = 0; i < 4; i++) {
        const seat = state.bidOrder[state.bidding.length];
        state = bid(state, seat, null);
      }
      expect(state.phase).toBe('bidding');
    }
    expect(seenHandFingerprints.size).toBe(8);
  });
});

describe('A2.1 扣底启发式战术修复 (Burying Tactics)', () => {
  it('扣底保留副牌关键大牌控制：有方块 4 张纯杂牌时，绝不把 ♣K 扣入底牌', () => {
    // 16张手牌：主牌 ♠6张，副牌持 ♥AH 10H 7H 3H、♣KC 3C、♦8D 7D 4D 2D
    const hand: Card[] = [
      c('S', 'A'), c('S', 'Q'), c('S', '10'), c('S', '8'), c('S', '6'), c('S', '4'),
      c('H', 'A'), c('H', '10'), c('H', '7'), c('H', '3'),
      c('C', 'K'), c('C', '3'),
      c('D', '8'), c('D', '7'), c('D', '4'), c('D', '2'),
    ];
    const buried = buryFromObservation({ ownHand: hand, trump: 'S', kittySize: 4 });
    const buriedIds = buried.map(id);

    // 严禁将 ♣K 扣入底牌
    expect(buriedIds).not.toContain('KC');
    // 应整门扣掉方块 4 张纯杂小牌
    expect(buriedIds).toEqual(expect.arrayContaining(['8D', '7D', '4D', '2D']));
  });

  it('严防单张死 K 陷阱：持 ♣K4 与 ♦9862 时，绝不扣 ♣4 留下孤立死 ♣K', () => {
    // 16张手牌：主牌 ♠6张，副牌持 ♣KC 4C、♦9D 8D 6D 2D、♥AH 7H 5H 2H
    const hand: Card[] = [
      c('S', 'A'), c('S', 'K'), c('S', 'Q'), c('S', '10'), c('S', '8'), c('S', '3'),
      c('C', 'K'), c('C', '4'),
      c('D', '9'), c('D', '8'), c('D', '6'), c('D', '2'),
      c('H', 'A'), c('H', '7'), c('H', '5'), c('H', '2'),
    ];
    const buried = buryFromObservation({ ownHand: hand, trump: 'S', kittySize: 4 });
    const buriedIds = buried.map(id);

    // 严禁扣 ♣4 造成 ♣K 单张死 K
    expect(buriedIds).not.toContain('4C');
    // 严禁扣 ♣K
    expect(buriedIds).not.toContain('KC');
    // 应扣掉方块 4 张纯杂小牌
    expect(buriedIds).toEqual(expect.arrayContaining(['9D', '8D', '6D', '2D']));
  });

  it('[P2复现] 多个可绝门花色竞争时按整组绝门评估，严禁拆散两门导致都未扣空', () => {
    // ♠AKQ1087 (6张主牌) + ♥AK105 (4张全分/大牌) + ♦2349 (4张杂牌) + ♣68 (2张杂牌)
    // 扣 4 张牌：绝不能扣 ♣6 + ♦234（留下 ♦9 和 ♣8 导致两门都未绝门）
    // 必须完全扣空一门（如扣 ♣68 + ♦23 绝梅花，或全扣 ♦2349 绝方块）
    const hand: Card[] = [
      c('S', 'A'), c('S', 'K'), c('S', 'Q'), c('S', '10'), c('S', '8'), c('S', '7'),
      c('H', 'A'), c('H', 'K'), c('H', '10'), c('H', '5'),
      c('D', '2'), c('D', '3'), c('D', '4'), c('D', '9'),
      c('C', '6'), c('C', '8'),
    ];
    const buried = buryFromObservation({ ownHand: hand, trump: 'S', kittySize: 4 });
    const remainingHand = hand.filter((c) => !buried.some((b) => b.suit === c.suit && b.rank === c.rank));
    const remainingSuits = new Set(remainingHand.map((c) => c.suit));

    // 严禁两门都不绝门（必须断梅花或断方块）
    const voidedSuits = (['D', 'C'] as const).filter((s) => !remainingSuits.has(s));
    expect(voidedSuits.length).toBeGreaterThanOrEqual(1);
    // 优先断短门梅花，留下方块长套
    expect(remainingSuits.has('C')).toBe(false);
    expect(buried.map(id)).toEqual(expect.arrayContaining(['6C', '8C']));

    // 并且绝不扣入分牌与主牌
    for (const b of buried) {
      expect(b.suit).not.toBe('S');
      expect(['A', '10', '5']).not.toContain(b.rank);
    }
  });
});

import { BIDDING_SCENARIOS, TRUMP_SCENARIOS, BURY_SCENARIOS } from '@yaozifen/ai-eval/scenarios';
import { LlmDecisionEvaluator } from '@yaozifen/ai-core/engines/llm/llmEvaluator';

describe('A2.1 基准场景全集收益检验 (29 组公开基准评测)', () => {
  const evaluator = new LlmDecisionEvaluator();

  it('叫分评测全量场景：通过率达 100%', () => {
    let passed = 0;
    const failures: string[] = [];

    for (const scenario of BIDDING_SCENARIOS) {
      const { state, seat } = scenario.setup();
      const chosenBid = smartBid(state!, seat);
      const rep = evaluator.evaluateBid(state!, seat, {
        action: { kind: 'bid', seat, bid: chosenBid },
        engineType: 'algorithm',
        latencyMs: 1,
      });
      const ok = scenario.expectedCriteria(rep, { action: { kind: 'bid', seat, bid: chosenBid } });
      if (ok) {
        passed++;
      } else {
        failures.push(`${scenario.id} (chosen: ${chosenBid}, optimal: ${scenario.optimalActionDesc})`);
      }
    }

    expect(failures).toEqual([]);
    expect(passed).toBe(BIDDING_SCENARIOS.length);
  });

  it('定主评测全量场景：通过率达 100%', () => {
    let passed = 0;
    const failures: string[] = [];

    for (const scenario of TRUMP_SCENARIOS) {
      const { state, seat } = scenario.setup();
      const chosenTrump = smartTrump(state!, seat);
      const rep = evaluator.evaluateTrump(state!, seat, {
        action: { kind: 'trump', seat, trump: chosenTrump },
        engineType: 'algorithm',
        latencyMs: 1,
      });
      const ok = scenario.expectedCriteria(rep, { action: { kind: 'trump', seat, trump: chosenTrump } });
      if (ok) {
        passed++;
      } else {
        failures.push(`${scenario.id} (chosen: ${chosenTrump}, optimal: ${scenario.optimalActionDesc})`);
      }
    }

    expect(failures).toEqual([]);
    expect(passed).toBe(TRUMP_SCENARIOS.length);
  });

  it('扣底评测全量场景：通过率达 100%', () => {
    let passed = 0;
    const failures: string[] = [];

    for (const scenario of BURY_SCENARIOS) {
      const { state, seat } = scenario.setup();
      const chosenCards = smartBury(state!, seat);
      const rep = evaluator.evaluateBury(state!, seat, {
        action: { kind: 'bury', seat, cards: chosenCards },
        engineType: 'algorithm',
        latencyMs: 1,
      });
      const ok = scenario.expectedCriteria(rep, { action: { kind: 'bury', seat, cards: chosenCards } });
      if (ok) {
        passed++;
      } else {
        failures.push(`${scenario.id} (chosen: ${chosenCards.map(id).join(' ')}, optimal: ${scenario.optimalActionDesc})`);
      }
    }

    expect(failures).toEqual([]);
    expect(passed).toBe(BURY_SCENARIOS.length);
  });
});
