import { describe, expect, it } from 'vitest';
import { Card, makeCard } from '../src/cards';
import { bid, bury, createGame, currentSeat, declareTrump, GameState, legalMoves, playCard } from '../src/engine';
import { smartBury } from '../src/ai';
import { observePlayer } from '../src/ai/optimized/observation';
import { BridgeEngine } from '../src/ai/bridge/bridgeEngine';
import { DecisionEngineManager } from '../src/ai/engines';
import { PlayerObservation } from '../src/ai/optimized/contracts';

function makeObservation(hand: Card[]): PlayerObservation {
  return {
    seat: 0,
    ownHand: hand,
    handCounts: [hand.length, hand.length, hand.length, hand.length],
    declarer: 2,
    bid: 70,
    trump: 'D',
    leader: 2,
    roundNumber: 1,
    currentRound: [
      { seat: 2, card: makeCard('D', 'A') },
      { seat: 3, card: makeCard('D', 'J') },
    ],
    completedRounds: [],
    voidSuits: [[], [], [], []],
    declarerPoints: 0,
    defenderPoints: 0,
    kittySize: 4,
    ruleId: 'basic-v1',
  };
}

function playingGame(seed = 101): GameState {
  let state = createGame(seed, { targetWins: 1 });
  const first = currentSeat(state);
  for (let i = 0; i < 4; i++) {
    state = bid(state, currentSeat(state), currentSeat(state) === first ? 70 : null);
  }
  state = declareTrump(state, first, 'D');
  return bury(state, first, smartBury(state, first));
}

describe('桥牌深度思考决策引擎集成 (BridgeEngine & Integration)', () => {
  it('BridgeEngine 满足 DecisionEngine 接口规范', async () => {
    const engine = new BridgeEngine();
    expect(engine.type).toBe('bridge');

    const hand = [makeCard('D', 'K'), makeCard('D', '2')];
    const obs = makeObservation(hand);

    const decision = await engine.chooseCard(obs, hand);
    expect(decision.engineType).toBe('bridge');
    expect(decision.card).toBeDefined();
    // 候选牌之一
    expect(hand.some((c) => c.rank === decision.card.rank && c.suit === decision.card.suit)).toBe(true);
    expect(decision.latencyMs).toBeGreaterThanOrEqual(0);
    expect(decision.diagnostic).toContain('DDS-PIMC');
  });

  it('唯一候选牌 0ms 瞬间返回', async () => {
    const engine = new BridgeEngine();
    const single = [makeCard('D', '2')];
    const obs = makeObservation(single);

    const decision = await engine.chooseCard(obs, single);
    expect(decision.card.rank).toBe('2');
    expect(decision.diagnostic).toBe('唯一候选直接出牌');
  });

  it('DecisionEngineManager 默认激活引擎为 bridge', () => {
    const manager = new DecisionEngineManager();
    expect(manager.getActiveType()).toBe('bridge');
    const engine = manager.getEngine('bridge');
    expect(engine.type).toBe('bridge');
  });

  it('完整对局模拟：四家使用桥牌引擎出牌，所有出牌合法且总分守恒 100', async () => {
    let state = playingGame(20261011);
    const engine = new BridgeEngine({
      config: {
        mode: 'deep',
        minWorlds: 4,
        maxWorlds: 8,
        timeLimitMs: 50,
        endgameCardLimit: 4,
      },
    });

    let movesCount = 0;
    while (state.phase === 'playing') {
      movesCount++;
      if (movesCount > 48) throw new Error('单副出牌轮数异常超标');

      const seat = currentSeat(state);
      const legal = legalMoves(state, seat);
      const obs = observePlayer(state, seat);

      const decision = await engine.chooseCard(obs, legal);
      // 验证决策合法性
      expect(legal.some((c) => c.rank === decision.card.rank && c.suit === decision.card.suit)).toBe(true);

      state = playCard(state, seat, decision.card);
    }

    expect(['handEnd', 'matchEnd']).toContain(state.phase);
    expect(state.result).toBeDefined();
    const totalPoints =
      state.result!.declarerPoints +
      state.result!.defenderPoints +
      (state.result!.unplayedPoints ?? 0);
    expect(totalPoints).toBe(100);
  });
});
