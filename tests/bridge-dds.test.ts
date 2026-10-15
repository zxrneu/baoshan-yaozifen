import { describe, expect, it } from 'vitest';
import { makeCard } from '@yaozifen/game-core/cards';
import { dealToBitboard } from '@yaozifen/ai-core/bridge/bitboard';
import { AlphaBetaDdsSolver } from '@yaozifen/ai-core/bridge/dds';
import { SUIT_INDEX } from '@yaozifen/ai-core/bridge/types';

describe('双明手 Alpha-Beta 求解器 (Double Dummy Solver)', () => {
  const cutoffDeal = () => dealToBitboard([
    [makeCard('S', 'A'), makeCard('H', 'A'), makeCard('C', '2')],
    [makeCard('S', '2'), makeCard('H', '2'), makeCard('C', '3')],
    [makeCard('S', 'K'), makeCard('H', 'K'), makeCard('C', '4')],
    [makeCard('S', '3'), makeCard('H', '3'), makeCard('C', '5')],
  ]);

  it('限深搜索续打至终局，不把两墩后的 60 分误判为叫 70 失败', () => {
    const solver = new AlphaBetaDdsSolver();
    const limited = solver.solve(cutoffDeal(), 0, 0, 0, 70, [50, 25], { maxDepth: 2 });
    const exact = solver.solve(cutoffDeal(), 0, 0, 0, 70, [50, 25]);
    const club = (r: typeof limited) => r.moveScores!.find(m => m.suitIdx === 3)!;
    expect(club(limited).score).toBe(70);
    expect(club(exact).score).toBe(70);
    expect(club(limited).status).toBe('depth_limit');
    expect(limited.status).toBe('depth_limit');
    expect(exact.status).toBe('exact');
  });

  it('节点预算耗尽后仍为每张候选完成续打，并标注估计状态', () => {
    const result = new AlphaBetaDdsSolver().solve(cutoffDeal(), 0, 0, 0, 70, [50, 25], { nodeLimit: 1 });
    expect(result.moveScores).toHaveLength(3);
    expect(result.moveScores!.every(m => m.status === 'node_limit')).toBe(true);
    expect(result.moveScores!.find(m => m.suitIdx === 3)!.score).toBe(70);
    expect(result.status).toBe('node_limit');
  });

  it('跟牌根节点求解实际行动座位，不重复求解领出家', () => {
    const deal = dealToBitboard([
      [makeCard('H', 'K')],
      [makeCard('H', 'A'), makeCard('H', '2')],
      [makeCard('H', 'Q'), makeCard('H', '3')],
      [makeCard('H', 'J'), makeCard('H', '4')],
    ]);
    const result = new AlphaBetaDdsSolver().solve(deal, 0, 0, 0, 70, [60, 20], {
      initialTrick: [{ seat: 0, suitIdx: 1, rankVal: 8 }],
    });
    expect(result.moveScores!.map(m => m.rankVal).sort((a, b) => a - b)).toEqual([0, 12]);
  });
  it('经典搭档超车残局：DDS 准确求解必须盖过搭档 ♥A 才能成局', () => {
    const c = makeCard;
    /**
     * 策略文档第 5 节明确记载的回归残局：
     * 黑桃(S)为主牌。庄家方(东西方，0与2)叫 70 分，已吃 60 分，闲家(南北方，1与3)已吃 10 分。
     * 当前出牌顺序：
     * 0(东,搭档): ♥Q, ♦10
     * 1(南,敌人): ♥2, ♦A
     * 2(西,庄家): ♥A, ♥3
     * 3(北,敌人): ♥K, ♦K
     */
    const hands = [
      [c('H', 'Q'), c('D', '10')], // 座位 0
      [c('H', '2'), c('D', 'A')],  // 座位 1
      [c('H', 'A'), c('H', '3')],  // 座位 2 (当前决策者)
      [c('H', 'K'), c('D', 'K')],  // 座位 3
    ];
    const deal = dealToBitboard(hands);
    const trumpIdx = SUIT_INDEX['S']; // 黑桃为主

    const solver = new AlphaBetaDdsSolver();

    // 假设当前轮西家(2)领出（如果西家领出 ♥A vs ♥3）
    const result = solver.solve(
      deal,
      trumpIdx,
      2, // 2 领出
      0, // 庄家方为 side 0 (东西方)
      70, // 叫 70 分
      [60, 10], // 已有吃分 [庄, 闲]
    );

    expect(result.moveScores).toBeDefined();
    expect(result.moveScores!.length).toBe(2);

    // 比较两张牌在博弈树下的最终得分
    const moveA = result.moveScores!.find((m) => m.rankVal === 12); // ♥A (rankVal 12)
    const move3 = result.moveScores!.find((m) => m.rankVal === 1);  // ♥3 (rankVal 1)

    expect(moveA).toBeDefined();
    expect(move3).toBeDefined();

    // 出 ♥A 可以让庄家方达成 70 分成局（甚至拿到 90 分）
    expect(moveA!.score).toBeGreaterThanOrEqual(70);
    // 出 ♥3 庄家方无法成局
    expect(move3!.score).toBeLessThan(70);

    // 求解器推荐的最佳动作必须是 ♥A
    expect(result.bestMove?.rankVal).toBe(12);
  });

  it('成局目标硬截断：吃分达标直接剪枝返回', () => {
    const c = makeCard;
    const hands = [
      [c('S', 'A')],
      [c('S', '2')],
      [c('S', 'K')],
      [c('S', '3')],
    ];
    const deal = dealToBitboard(hands);
    const trumpIdx = SUIT_INDEX['S'];

    const solver = new AlphaBetaDdsSolver();
    // 庄家叫 70，已有 65 分，吃下这一轮 10 分即可达成 75 分
    const result = solver.solve(
      deal,
      trumpIdx,
      0, // 0 领出 ♠A
      0,
      70,
      [65, 20],
    );

    expect(result.declarerWon).toBe(true);
    expect(result.declarerPoints).toBeGreaterThanOrEqual(70);
  });

  it('置换表得分隔离：相同手牌在不同已有吃分下不会错误复用成局结论', () => {
    const c = makeCard;
    const hands = [
      [c('S', 'A'), c('D', '2')],
      [c('S', '2'), c('D', '3')],
      [c('S', 'K'), c('D', '4')],
      [c('S', '3'), c('D', '5')],
    ];
    const deal = dealToBitboard(hands);
    const trumpIdx = SUIT_INDEX['S'];
    const solver = new AlphaBetaDdsSolver();

    // 路径 A: 庄家已吃 65 分，一轮拿分直接成局
    const resultHigh = solver.solve(deal, trumpIdx, 0, 0, 70, [65, 20]);
    expect(resultHigh.declarerWon).toBe(true);

    // 路径 B: 庄家仅吃 10 分，即使拿同样分也绝不成局
    const resultLow = solver.solve(deal, trumpIdx, 0, 0, 70, [10, 20]);
    expect(resultLow.declarerWon).toBe(false);
  });
});
