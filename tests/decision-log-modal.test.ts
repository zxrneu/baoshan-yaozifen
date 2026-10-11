import { describe, expect, it, beforeEach } from 'vitest';
import { decisionLogger } from '../src/ai/engines/decisionLogger';
import { DecisionRecord } from '../src/ai/engines/engineTypes';

describe('DecisionLog & Reviewer Pipeline', () => {
  beforeEach(() => {
    decisionLogger.clear();
  });

  it('records and retrieves full-lifecycle decisions (bidding, trump, bury, playing)', () => {
    // 1. 叫分记录
    const bidRec: Omit<DecisionRecord, 'id' | 'timestamp'> = {
      seat: 1,
      phase: 'bidding',
      action: { kind: 'bid', seat: 1, bid: null },
      engineType: 'llm',
      latencyMs: 1200,
      roundNumber: 1,
      trickNumber: 0,
      ownHand: [{ suit: 'S', rank: 'A' }, { suit: 'H', rank: 'K' }],
      currentRound: [],
      candidates: [],
      conclusion: '手牌无长套、放弃叫分',
      thinking: '评估手牌大牌控制力与风险，决定不叫。',
      modelName: 'qwen38_27b',
    };
    decisionLogger.record(bidRec);

    // 2. 定主记录
    const trumpRec: Omit<DecisionRecord, 'id' | 'timestamp'> = {
      seat: 2,
      phase: 'trump',
      action: { kind: 'trump', seat: 2, trump: 'S' },
      engineType: 'llm',
      latencyMs: 800,
      roundNumber: 1,
      trickNumber: 0,
      ownHand: [{ suit: 'S', rank: 'A' }],
      currentRound: [],
      candidates: [],
      conclusion: '定主黑桃',
      thinking: '黑桃套长且控场能力强。',
    };
    decisionLogger.record(trumpRec);

    // 3. 扣底记录
    const buryRec: Omit<DecisionRecord, 'id' | 'timestamp'> = {
      seat: 2,
      phase: 'bury',
      action: {
        kind: 'bury',
        seat: 2,
        cards: [
          { suit: 'H', rank: '2' },
          { suit: 'D', rank: '3' },
          { suit: 'C', rank: '4' },
          { suit: 'S', rank: '6' },
        ],
      },
      engineType: 'bridge',
      latencyMs: 50,
      roundNumber: 1,
      trickNumber: 0,
      ownHand: [],
      currentRound: [],
      candidates: [],
      conclusion: '扣除副牌杂牌4张',
    };
    decisionLogger.record(buryRec);

    // 4. 出牌记录
    const playRec: Omit<DecisionRecord, 'id' | 'timestamp'> = {
      seat: 0,
      phase: 'playing',
      chosenCard: { suit: 'H', rank: 'A' },
      action: { kind: 'play', seat: 0, card: { suit: 'H', rank: 'A' } },
      engineType: 'algorithm',
      latencyMs: 15,
      roundNumber: 1,
      trickNumber: 1,
      ownHand: [{ suit: 'H', rank: 'A' }],
      currentRound: [],
      candidates: [{ suit: 'H', rank: 'A' }, { suit: 'H', rank: 'K' }],
      conclusion: '首家领出大牌控场',
    };
    decisionLogger.record(playRec);

    const records = decisionLogger.getRecords();
    expect(records).toHaveLength(4);

    expect(records[0].phase).toBe('bidding');
    expect(records[0].action?.kind).toBe('bid');
    expect(records[0].action && 'bid' in records[0].action ? records[0].action.bid : undefined).toBeNull();

    expect(records[1].phase).toBe('trump');
    expect(records[1].action && 'trump' in records[1].action ? records[1].action.trump : undefined).toBe('S');

    expect(records[2].phase).toBe('bury');
    expect(records[2].action && 'cards' in records[2].action ? records[2].action.cards : undefined).toHaveLength(4);

    expect(records[3].phase).toBe('playing');
    expect(records[3].chosenCard).toEqual({ suit: 'H', rank: 'A' });
    expect(records[3].candidates).toHaveLength(2);
  });

  it('exports JSON containing all records cleanly and allows clearing', () => {
    decisionLogger.record({
      seat: 3,
      roundNumber: 1,
      trickNumber: 1,
      engineType: 'llm',
      latencyMs: 500,
      ownHand: [],
      currentRound: [],
      candidates: [],
      conclusion: '测试导出',
    });

    const jsonStr = decisionLogger.exportJson();
    const parsed = JSON.parse(jsonStr);
    expect(parsed.total).toBe(1);
    expect(Array.isArray(parsed.records)).toBe(true);
    expect(parsed.records[0].conclusion).toBe('测试导出');


    decisionLogger.clear();
    expect(decisionLogger.getRecords()).toHaveLength(0);
  });

  it('correctly tracks subscribers on new records', () => {
    let callCount = 0;
    const unsubscribe = decisionLogger.subscribe(() => {
      callCount++;
    });

    decisionLogger.record({
      seat: 0,
      roundNumber: 1,
      trickNumber: 1,
      engineType: 'bridge',
      latencyMs: 10,
      ownHand: [],
      currentRound: [],
      candidates: [],
    });

    expect(callCount).toBe(1);
    unsubscribe();

    decisionLogger.record({
      seat: 1,
      roundNumber: 1,
      trickNumber: 1,
      engineType: 'bridge',
      latencyMs: 10,
      ownHand: [],
      currentRound: [],
      candidates: [],
    });

    expect(callCount).toBe(1);
  });
});
