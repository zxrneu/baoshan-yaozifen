import { describe, expect, it } from 'vitest';
import { cardId, cardPoints, makeCard } from '@yaozifen/game-core/cards';
import { PlayerObservation } from '@yaozifen/ai-core/optimized/contracts';
import { isPartnerGuaranteedWinning, pruneCandidates } from '@yaozifen/ai-core/tactics';
import { AlgorithmEngine } from '@yaozifen/ai-core/engines/algorithmEngine';
import { LayaEngine } from '@yaozifen/ai-core/engines/layaEngine';
import { LlmEngine } from '@yaozifen/ai-core/engines/llmEngine';

/**
 * 构造合法的测试观察数据：
 * 座位说明：0=东, 1=南, 2=西, 3=北
 * 东西方为搭档(0与2)，南北方为搭档(1与3)
 * 出牌顺时针：2(西) -> 3(北) -> 0(东) -> 1(南)
 */
function createObservation(overrides: Partial<PlayerObservation> = {}): PlayerObservation {
  const c = makeCard;
  const defaultHand = [c('D', 'K'), c('D', '2')];
  return {
    seat: 0, // 东家
    ownHand: defaultHand,
    handCounts: [2, 2, 2, 2],
    declarer: 2, // 西家做庄
    bid: 70,
    trump: 'D', // 方块为主牌
    leader: 2, // 西家领出
    roundNumber: 11,
    currentRound: [
      { seat: 2, card: c('D', 'A') }, // 西家出 ♦A (主牌最大牌)
      { seat: 3, card: c('D', 'J') }, // 北家出 ♦J
    ],
    completedRounds: [],
    voidSuits: [[], [], [], []],
    declarerPoints: 50,
    defenderPoints: 20,
    kittySize: 4,
    ruleId: 'basic-v1',
    ...overrides,
  };
}

describe('搭档战术判断与保牌决策 (Tactics & Pruning)', () => {
  it('截图回归局面：西家 ♦A 稳赢，东家持 ♦K 与 ♦2 应合并排除 ♦K，保留 ♦2', () => {
    const obs = createObservation();
    const candidates = [makeCard('D', 'K'), makeCard('D', '2')];

    // 1. 搭档稳赢判断
    const guaranteed = isPartnerGuaranteedWinning(obs);
    expect(guaranteed).toBe(true);

    // 2. 候选精简
    const pruned = pruneCandidates(obs, candidates);
    expect(pruned).toHaveLength(1);
    expect(pruned[0].rank).toBe('2');
    expect(pruned[0].suit).toBe('D');
  });

  it('三类引擎在截图局面下均最终决策出 ♦2', async () => {
    const obs = createObservation();
    const candidates = [makeCard('D', 'K'), makeCard('D', '2')];

    // 1. 算法引擎（在保牌精简保护下，或直接通过基线选择 ♦2）
    const algoEngine = new AlgorithmEngine();
    const algoDecision = await algoEngine.chooseCard(obs, candidates);
    expect(algoDecision.card.rank).toBe('2');
    expect(algoDecision.card.suit).toBe('D');

    // 2. Laya 引擎（Mock fetch 验证）
    const mockLayaFetch: typeof fetch = async (_url, init) => {
      const body = JSON.parse(init?.body as string);
      expect(body.questions.play.criteria['2D']).toBeDefined();
      return {
        ok: true,
        json: async () => ({
          answers: {
            play: {
              choice: '2D',
              probabilities: { '2D': 0.7, KD: 0.3 },
              confidence: 0.85,
            },
          },
        }),
      } as any;
    };
    const layaEngine = new LayaEngine({ fetchFn: mockLayaFetch });
    const layaDecision = await layaEngine.chooseCard(obs, candidates);
    expect(layaDecision.card.rank).toBe('2');
    expect(layaDecision.card.suit).toBe('D');

    // 3. LLM 引擎（Mock fetch 验证）
    const mockLlmFetch: typeof fetch = async (_url, init) => {
      const body = JSON.parse(init?.body as string);
      expect(body.messages).toBeDefined();
      return {
        ok: true,
        json: async () => ({
          choices: [
            {
              message: {
                content: JSON.stringify({
                  cardId: '2D',
                  reason: '搭档♦A已稳赢，保留♦K大牌控制力，垫最小牌♦2',
                }),
              },
            },
          ],
        }),
      } as any;
    };
    const llmEngine = new LlmEngine({ fetchFn: mockLlmFetch });
    const llmDecision = await llmEngine.chooseCard(obs, candidates);
    expect(llmDecision.card.rank).toBe('2');
    expect(llmDecision.card.suit).toBe('D');
  });

  it('安全喂分：搭档稳赢时，分牌（如 10 或 5）不被剔除，可作为候选供收益评估', () => {
    const obs = createObservation();
    // 东家持 0 分小牌 ♦2 和分牌 ♦10
    const candidates = [makeCard('D', '10'), makeCard('D', '2')];
    const pruned = pruneCandidates(obs, candidates);
    // 分牌（10分）继续保留以供评估喂分，♦2 也保留
    expect(pruned.some((c) => cardPoints(c) > 0)).toBe(true);
    expect(pruned.some((c) => cardId(c) === '2D')).toBe(true);
  });

  it('保留最大主牌：第四手搭档稳赢时，同门不同大小的零分牌只保留最小牌，不浪费大牌', () => {
    // 顺时针顺序：1(南) -> 2(西) -> 3(北) -> 0(东)
    const obs = createObservation({
      leader: 1,
      currentRound: [
        { seat: 1, card: makeCard('D', '7') },
        { seat: 2, card: makeCard('D', 'A') }, // 搭档西家出 ♦A (最大主牌)
        { seat: 3, card: makeCard('D', '3') },
      ],
      // 东家跟主牌，手中持有主牌 ♦K, ♦Q, ♦2
      ownHand: [makeCard('D', 'K'), makeCard('D', 'Q'), makeCard('D', '2')],
    });
    // 此时第四手且搭档 ♦A 领先后手无任何对手，搭档确定稳赢
    expect(isPartnerGuaranteedWinning(obs)).toBe(true);

    const candidates = [makeCard('D', 'K'), makeCard('D', 'Q'), makeCard('D', '2')];
    const pruned = pruneCandidates(obs, candidates);
    // 同门零分牌被合并为最小牌 ♦2，大牌 ♦K 和 ♦Q 被保护
    expect(pruned).toHaveLength(1);
    expect(pruned[0].rank).toBe('2');
  });

  it('必须跟门：领出花色为黑桃时，手牌有黑桃必须跟黑桃', () => {
    const obs = createObservation({
      currentRound: [
        { seat: 2, card: makeCard('S', 'K') },
        { seat: 3, card: makeCard('S', '8') },
      ],
    });
    // 假设合法的候选牌中只有黑桃（规则层保证）
    const candidates = [makeCard('S', '9'), makeCard('S', '3')];
    const pruned = pruneCandidates(obs, candidates);
    expect(pruned.every((c) => c.suit === 'S')).toBe(true);
  });

  it('后手杀牌反例：搭档目前副牌虽大，但后手对手已绝门且可能有主牌杀牌时，不是绝对稳赢', () => {
    // 顺时针顺序：2(西) -> 3(北) -> 0(东) -> 1(南)
    // 西家领出副牌红心 A，北家跟红心 2，东家当前出牌，后手还有南家(1)
    const obs = createObservation({
      trump: 'S', // 黑桃为主
      currentRound: [
        { seat: 2, card: makeCard('H', 'A') }, // 搭档西家出红心 A
        { seat: 3, card: makeCard('H', '2') }, // 北家跟红心 2
      ],
      // 南家（seat 1）公开绝红心，且未见牌中仍有主牌黑桃
      voidSuits: [[], ['H'], [], []],
    });
    const guaranteed = isPartnerGuaranteedWinning(obs);
    // 因为南家后手可能用主牌杀牌，搭档不能算绝对稳赢
    expect(guaranteed).toBe(false);
  });

  it('两轮超车反例：当搭档并未稳赢且需要自己超车时，大牌不能被精简', () => {
    // 顺序：3(北) -> 0(东) -> 1(南) -> 2(西)
    // 北家领先出 ♦J，此时东家出牌
    const obs = createObservation({
      leader: 3,
      currentRound: [
        { seat: 3, card: makeCard('D', 'J') }, // 对手北家领先出 ♦J
      ],
    });
    const candidates = [makeCard('D', 'K'), makeCard('D', '2')];
    // 搭档还没出牌或未领先，不是搭档稳赢
    expect(isPartnerGuaranteedWinning(obs)).toBe(false);
    const pruned = pruneCandidates(obs, candidates);
    // ♦K 需要用来超车压制对手，不能被精简
    expect(pruned.some((c) => c.rank === 'K')).toBe(true);
  });
});
