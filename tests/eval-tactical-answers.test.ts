/** 题目裁判回归：以公开牌和规则验证答案，不依赖引擎当前选择或搭档暗牌。 */
import { describe, expect, it } from 'vitest';
import { cardId, cardPoints, freshDeck } from '@yaozifen/game-core/cards';
import { beats, trickWinner } from '@yaozifen/game-core';
import { ALL_BENCHMARK_SCENARIOS } from '@yaozifen/ai-eval/scenarios';
import { ALL_HOLDOUT_SCENARIOS } from '@yaozifen/ai-eval/holdoutScenarios';
import { LlmDecisionEvaluator } from '@yaozifen/ai-core/engines/llm/llmEvaluator';

describe('修正依赖未知暗牌或误判稳赢的样题', () => {
  it('第四手可毙杀对手 A 时接受所有赢墩主牌，拒绝把 10 分送给对手', () => {
    const scenario = ALL_HOLDOUT_SCENARIOS.find(s => s.id === 'holdout-play-west-fourth-hand-discard-garbage')!;
    const { observation: obs, candidates } = scenario.setup();
    const evaluator = new LlmDecisionEvaluator();
    expect(obs!.currentRound.reduce((sum, entry) => sum + cardPoints(entry.card), 0)).toBe(10);
    for (const card of candidates!) {
      const winner = trickWinner([...obs!.currentRound, { seat: obs!.seat, card }], obs!.trump);
      const report = evaluator.evaluatePlay(obs!, candidates!, { card, engineType: 'bridge', latencyMs: 0 });
      expect(scenario.expectedCriteria(report), cardId(card)).toBe(winner.seat === obs!.seat);
    }
  });

  it.each([
    ['中盘兑现', 'play-mid-round6-partner-lead-void', ALL_BENCHMARK_SCENARIOS],
    ['保留集兑现', 'holdout-play-north-lead-attack-short-suit', ALL_HOLDOUT_SCENARIOS],
  ] as const)('%s：允许答案均为公开可证明的分牌赢张', (_name, id, scenarios) => {
    const scenario = scenarios.find(s => s.id === id)!;
    const { observation: obs, candidates } = scenario.setup();
    const def = scenario.definition!;
    if (def.phase !== 'playing') throw new Error('预期出牌样本');
    const known = new Set([
      ...obs!.ownHand, ...obs!.completedRounds.flatMap(round => round.cards.map(entry => entry.card)),
      ...obs!.currentRound.map(entry => entry.card), ...(obs!.knownBuriedCards ?? []),
      ...(obs!.revealedHand?.cards ?? []),
    ].map(cardId));
    const unseen = freshDeck().filter(card => !known.has(cardId(card)));
    expect(def.expected.cards?.length).toBeGreaterThan(0);
    for (const id of def.expected.cards!) {
      const card = candidates!.find(card => cardId(card) === id)!;
      expect(cardPoints(card), id).toBeGreaterThan(0);
      expect(unseen.filter(other => beats(other, card, obs!.trump)).map(cardId), id).toEqual([]);
      if (scenario.phase === 'playing' && scenario.id.startsWith('play-mid-')) {
        expect(obs!.declarerPoints + cardPoints(card)).toBeGreaterThanOrEqual(obs!.bid);
      }
    }
  });
});
