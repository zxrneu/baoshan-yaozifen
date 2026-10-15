import { describe, expect, it } from 'vitest';
import { Card, cardId, cardPoints, freshDeck, makeCard } from '@yaozifen/game-core/cards';
import {
  bid, bury, createGame, currentSeat, declareTrump, GameState, legalMoves,
  nextHand, partnerOf, playCard, revealedPartnerSeat,
} from '@yaozifen/game-core';
import { aiPlay, fastChooseCard, sampleHiddenHands, smartBury } from '@yaozifen/ai-core';
import { rngFrom, hiddenWorldSource, sampleHiddenWorld } from '@yaozifen/ai-core/sampling';
import {
  advanceSimulation, createBeliefSource, createOptimizedSelector, createSimulation,
  InconsistentObservationError, observationKey, observationPolicy, observePlayer,
  observeSimulation, PlayerObservation, seededSearchRandom, unlimitedGuard,
} from '@yaozifen/ai-core/optimized/index';

function trumpState(declarer = 1, amount = 100): GameState {
  let state = createGame(39);
  for (let i = 0; i < 4; i++) {
    const seat = currentSeat(state);
    state = bid(state, seat, seat === declarer ? amount : null);
    expect(revealedPartnerSeat(state)).toBeNull();
  }
  return state;
}

function playing(declarer = 1, amount = 100): GameState {
  const state = declareTrump(trumpState(declarer, amount), declarer, 'S');
  return bury(state, declarer, smartBury(state, declarer));
}

function cardIds(cards: readonly Card[]): string[] { return cards.map(cardId).sort(); }

describe('100 分搭档明牌规则', () => {
  it.each([0, 1, 2, 3])('庄家为 %i 时，仅在合法扣底成功后公开其搭档', (declarer) => {
    const trump = trumpState(declarer);
    const state = declareTrump(trump, declarer, 'S');
    expect(revealedPartnerSeat(state)).toBeNull();
    const invalid = [state.hands[declarer].find((c) => cardPoints(c) > 0)!,
      ...state.hands[declarer].filter((c) => cardPoints(c) === 0).slice(0, 3)];
    expect(() => bury(state, declarer, invalid)).toThrow();
    expect(revealedPartnerSeat(state)).toBeNull();
    const after = bury(state, declarer, smartBury(state, declarer));
    expect(revealedPartnerSeat(after)).toBe(partnerOf(declarer));
    expect(after.history.at(-1)).toContain('剩余手牌对所有人可见');
    expect(revealedPartnerSeat(trump)).toBeNull();
    expect(revealedPartnerSeat(state)).toBeNull();
  });

  it.each([70, 75, 80, 85, 90, 95])('叫 %i 分始终保持暗牌', (amount) => {
    let state = playing(1, amount);
    expect(revealedPartnerSeat(state)).toBeNull();
    while (state.phase === 'playing') {
      const seat = currentSeat(state);
      state = playCard(state, seat, legalMoves(state, seat)[0]);
    }
    expect(revealedPartnerSeat(state)).toBeNull();
  });

  it('明牌随出牌减少，100 分仍按原分数线结算，换副和重开恢复暗牌', () => {
    let state = playing();
    const revealed = revealedPartnerSeat(state)!;
    const original = state;
    for (let i = 0; i < 4; i++) {
      const seat = currentSeat(state);
      state = playCard(state, seat, legalMoves(state, seat)[0]);
    }
    expect(state.hands[revealed]).toHaveLength(11);
    expect(original.hands[revealed]).toHaveLength(12);
    while (state.phase === 'playing') {
      const seat = currentSeat(state);
      state = playCard(state, seat, legalMoves(state, seat)[0]);
    }
    expect(revealedPartnerSeat(state)).toBe(revealed);
    expect(state.result!.success).toBe(state.result!.declarerPoints === 100);
    expect(state.result!.declarerPoints + state.result!.defenderPoints + (state.result!.unplayedPoints ?? 0)).toBe(100);
    expect(revealedPartnerSeat(nextHand(state))).toBeNull();
    expect(revealedPartnerSeat(createGame(39))).toBeNull();
  });
});

describe('明牌 AI 的可见信息与采样', () => {
  it('四个观察者都能看明牌，仍不能读取其他暗牌、未知底牌或 seed', () => {
    const state = playing();
    const revealed = revealedPartnerSeat(state)!;
    for (let seat = 0; seat < 4; seat++) {
      const expected = observePlayer(state, seat);
      const hands = state.hands.map((hand, index) => index === seat || index === revealed ? hand : new Proxy(hand, {
        get(target, key) { if (key === 'length') return target.length; throw new Error('读取了暗牌'); },
      }));
      const kitty = seat === state.declarer ? state.kitty
        : new Proxy(state.kitty, { get() { throw new Error('读取了未知底牌'); } });
      const guarded = Object.defineProperty({ ...state, hands, kitty }, 'seed', {
        get() { throw new Error('读取了发牌 seed'); },
      });
      expect(observePlayer(guarded, seat)).toEqual(expected);
      expect(expected.revealedHand).toEqual({ seat: revealed, cards: state.hands[revealed] });
      expect(expected.revealedHand!.cards).not.toBe(state.hands[revealed]);
      expect(expected.knownBuriedCards).toEqual(seat === state.declarer ? state.kitty : undefined);
    }
  });

  it('每个观察者的约束采样都固定明牌、保持缺门和 52 张牌守恒', () => {
    let state = playing();
    for (let i = 0; i < 3 && state.phase === 'playing'; i++) {
      const seat = currentSeat(state);
      state = playCard(state, seat, observationPolicy.chooseCard(observePlayer(state, seat)));
    }
    for (let seat = 0; seat < 4; seat++) {
      const observation = observePlayer(state, seat);
      const source = createBeliefSource(observation);
      const random = seededSearchRandom(seat + 20);
      for (let i = 0; i < 6; i++) {
        const world = source.sample(random, unlimitedGuard);
        expect(world.hands.map((hand) => hand.length)).toEqual(observation.handCounts);
        expect(cardIds(world.hands[seat])).toEqual(cardIds(observation.ownHand));
        expect(cardIds(world.hands[observation.revealedHand!.seat])).toEqual(cardIds(observation.revealedHand!.cards));
        for (let s = 0; s < 4; s++) for (const card of world.hands[s]) {
          expect(observation.voidSuits[s]).not.toContain(card.suit);
        }
        const all = [...world.hands.flat(), ...world.kitty,
          ...observation.completedRounds.flatMap((round) => round.cards.map((entry) => entry.card)),
          ...observation.currentRound.map((entry) => entry.card)];
        expect(cardIds(all)).toEqual(cardIds(freshDeck()));
        expect(world.kitty.every((card) => cardPoints(card) === 0)).toBe(true);
      }
      const legacyHands = sampleHiddenHands(state, seat, rngFrom(42, seat));
      expect(cardIds(legacyHands[observation.revealedHand!.seat])).toEqual(cardIds(observation.revealedHand!.cards));
      const legacyWorld = sampleHiddenWorld(hiddenWorldSource(state, seat), rngFrom(42, seat));
      expect(cardIds([...legacyWorld.hands.flat(), ...legacyWorld.kitty,
        ...observation.completedRounds.flatMap(round => round.cards.map(entry => entry.card)),
        ...observation.currentRound.map(entry => entry.card)])).toEqual(cardIds(freshDeck()));
    }
  });

  it('矛盾的明牌归属、数量、自己的牌或缺门不能进入采样', () => {
    const state = playing();
    const observation = observePlayer(state, 0);
    const revealed = observation.revealedHand!;
    const invalid: PlayerObservation[] = [
      { ...observation, revealedHand: { ...revealed, seat: 2 } },
      { ...observation, revealedHand: { ...revealed, cards: revealed.cards.slice(1) } },
      { ...observation, revealedHand: { ...revealed, cards: revealed.cards.map(() => revealed.cards[0]) } },
      { ...observation, voidSuits: observation.voidSuits.map((suits, seat) => seat === revealed.seat ? ['S', 'H', 'C', 'D'] : suits) },
      { ...observePlayer(state, revealed.seat), revealedHand: { ...revealed, cards: state.hands[0] } },
    ];
    for (const value of invalid) expect(() => createBeliefSource(value)).toThrow(InconsistentObservationError);
  });

  it('改变暗牌归属不改变观察和搜索；改变明牌会改变观察键', () => {
    const state = playing();
    const seat = currentSeat(state);
    const changed = { ...state, hands: state.hands.map((hand) => [...hand]), seed: 981 };
    [changed.hands[0][0], changed.hands[2][0]] = [changed.hands[2][0], changed.hands[0][0]];
    const observation = observePlayer(state, seat);
    expect(observePlayer(changed, seat)).toEqual(observation);
    const selector = createOptimizedSelector({
      budget: { minWorlds: 2, maxWorlds: 2, timeLimitMs: Infinity, endgameNodeLimit: 0 },
      dependencies: { random: () => seededSearchRandom(19), now: () => 0 },
    });
    expect(selector.choose(observePlayer(changed, seat))).toEqual(selector.choose(observation));
    expect(selector.choose(observation).status).not.toBe('inconsistent');
    [changed.hands[0][0], changed.hands[3][0]] = [changed.hands[3][0], changed.hands[0][0]];
    expect(observationKey(observePlayer(changed, seat))).not.toBe(observationKey(observation));
    expect(observationKey({ ...observation, revealedHand: {
      ...observation.revealedHand!, cards: [...observation.revealedHand!.cards].reverse(),
    } })).toBe(observationKey(observation));
  });
});

describe('明牌推演和快速策略', () => {
  it('整副逐张推演向所有座位提供更新后的明牌，与引擎观察完全一致', () => {
    let state = playing();
    const simulation = createSimulation(observePlayer(state, currentSeat(state)), { hands: state.hands, kitty: state.kitty });
    while (state.phase === 'playing') {
      for (let seat = 0; seat < 4; seat++) expect(observeSimulation(simulation, seat)).toEqual(observePlayer(state, seat));
      const seat = currentSeat(state);
      const card = observationPolicy.chooseCard(observePlayer(state, seat));
      expect(aiPlay(state, seat)).toEqual(card);
      expect(fastChooseCard(state, seat)).toEqual(card);
      advanceSimulation(simulation, card);
      state = playCard(state, seat, card);
    }
    expect(simulation.hands).toEqual(state.hands);
    expect(simulation.declarerPoints).toBe(state.declarerTrickPoints);
    expect(simulation.defenderPoints).toBe(state.defenderTrickPoints);
  });

  it('闲家会根据后手明牌是否能压牌决定喂 10 分或保分', () => {
    const state = playing();
    const c = makeCard;
    const observation: PlayerObservation = {
      ...observePlayer(state, 2), ownHand: [c('H', '10'), c('H', '2')],
      leader: 0, currentRound: [{ seat: 0, card: c('H', 'K') }, { seat: 1, card: c('H', '3') }],
      revealedHand: { seat: 3, cards: [c('H', 'A'), c('S', 'A')] },
    };
    expect(observationPolicy.chooseCard(observation)).toEqual(c('H', '2'));
    expect(observationPolicy.chooseCard({ ...observation,
      revealedHand: { seat: 3, cards: [c('H', '4'), c('S', 'A')] },
    })).toEqual(c('H', '10')); // 有红桃必须跟，不能用已知黑桃 A 杀。
  });
});
