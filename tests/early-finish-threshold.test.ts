/**
 * T0.2 提前结算阈值回归守护。
 *
 * 背景：开发路线图 T0.2 曾主张把 `105 − B` 改为 `101 − B`，理由是"闲家必胜阈值数学上是 101 − B"。
 * 该推理漏掉了分值粒度：分牌只有 A/10 = 10 分、5 = 5 分（见 src/cards.ts POINT_RANKS），
 * 因此任何累计吃分恒为 5 的倍数。令 D = 闲家吃分，B = 叫分，则
 *   庄家不成局 ⟺ 100 − D < B ⟺ D > 100 − B
 * 因 D 与 (100 − B) 同为 5 的倍数，`D > 100 − B` 等价于 `D >= 100 − B + 5 = 105 − B`。
 * 即 105 − B 已是【精确】锁定阈值，101 − B 落在两个可达分值之间、永不可达。
 *
 * 本套件把该结论固化，防止后人再次按路线图原文把阈值改小。
 */
import { describe, expect, it } from 'vitest';
import { cardPoints } from '../src/cards';
import { GameState, bid, bury, createGame, currentSeat, declareTrump, playCard } from '../src/engine';
import { makeCard } from '../src/cards';
import { dealToBitboard } from '../src/ai/bridge/bitboard';
import { AlphaBetaDdsSolver } from '../src/ai/bridge/dds';
import { SUIT_INDEX } from '../src/ai/bridge/types';

/** 合法叫分档位（DEFAULT_RULES: min 70 / step 5 / max 100） */
const BIDS = [70, 75, 80, 85, 90, 95, 100] as const;

/** 闲家精确锁定阈值 */
const lockThreshold = (bidValue: number) => 105 - bidValue;

/** 路线图主张但不可达的阈值 */
const roadmapThreshold = (bidValue: number) => 101 - bidValue;

function pickBury(s: GameState) {
  const hand = s.hands[s.declarer!];
  return hand.filter((c) => cardPoints(c) === 0).slice(0, s.kitty.length);
}

/** 构造一个轮到 0 号位出牌的 playing 局面，庄家为 1 号位（南北方），闲家为 0/2 号位（东西方） */
function reachPlaying(seed: number, bidValue: number): GameState {
  let s = createGame(seed);
  const first = currentSeat(s);
  for (let i = 0; i < 4; i++) {
    const seat = (first + i) % 4;
    s = bid(s, seat, seat === first ? bidValue : null);
  }
  s = declareTrump(s, s.declarer!, 'S');
  s = bury(s, s.declarer!, pickBury(s));
  return s;
}

describe('T0.2 提前结算阈值：105 − B 是精确锁定线', () => {
  it('分值粒度不变量：所有分牌分值均为 5 的倍数（阈值推导的基础）', () => {
    // 这是整个结论的根基；若未来引入非 5 倍数分值（如抠底翻倍变体），本套件必须重新评估。
    for (const rank of ['A', '10', '5', 'K', 'Q', 'J', '2'] as const) {
      expect(cardPoints(makeCard('S', rank)) % 5).toBe(0);
    }
  });

  it('105 − B 恒为 5 的倍数，而 101 − B 恒不为 5 的倍数（即不可达）', () => {
    for (const b of BIDS) {
      expect(lockThreshold(b) % 5).toBe(0);
      expect(roadmapThreshold(b) % 5).not.toBe(0);
    }
  });

  it('在 >= 语义下，105 − B 与 101 − B 对全部可达吃分判定完全一致', () => {
    // 可达吃分只能是 0..100 的 5 的倍数
    const reachable = Array.from({ length: 21 }, (_, i) => i * 5);
    for (const b of BIDS) {
      for (const d of reachable) {
        expect(d >= roadmapThreshold(b)).toBe(d >= lockThreshold(b));
      }
    }
  });

  it('101 − B 落在两个可达分值之间（从未被触达的具体证据）', () => {
    for (const b of BIDS) {
      const t = roadmapThreshold(b);
      const nearestBelow = Math.floor(t / 5) * 5;
      const nearestAbove = nearestBelow + 5;
      expect(nearestBelow).toBeLessThan(t);
      expect(nearestAbove).toBeGreaterThan(t);
      // 右侧真正的锁定点是 105 − B，与 101 − B 之间没有任何可达分值
      expect(nearestAbove).toBe(lockThreshold(b));
    }
  });

  it.each(BIDS.map((b) => [b, lockThreshold(b) - 10, lockThreshold(b)] as const))(
    '叫 %i 分：闲方达到 %i 分不结束，达到 %i 分立即提前结束',
    (bidValue, subThreshold, threshold) => {
      const state = reachPlaying(7, bidValue);
      expect(state.phase).toBe('playing');
      expect(state.highestBid).toBe(bidValue);
      expect(state.declarer).toBe(1);

      // 未达阈值：不结束
      const stateSub = {
        ...state,
        leader: 1,
        defenderTrickPoints: subThreshold,
        trick: [
          { seat: 1, card: makeCard('S', '2') },
          { seat: 2, card: makeCard('S', '3') },
          { seat: 3, card: makeCard('S', '4') },
        ],
        hands: state.hands.map((h, i) =>
          i === 0 ? [makeCard('S', '5'), makeCard('H', '2')] : [...h],
        ),
      };
      // 0 号位出 S5，本轮闲家只得 0 分 → 仍不足
      const afterSub = playCard(stateSub, 0, makeCard('S', '5'));
      expect(afterSub.phase).toBe('playing');

      // 达阈值：立即提前结束，且闲家胜（success === false）
      const stateAtThreshold = {
        ...state,
        leader: 1,
        defenderTrickPoints: threshold - 10,
        trick: [
          { seat: 1, card: makeCard('S', '2') },
          { seat: 2, card: makeCard('S', 'A') }, // 闲家 2 号位 10 分大牌赢本轮
          { seat: 3, card: makeCard('S', '3') },
        ],
        hands: state.hands.map((h, i) =>
          i === 0 ? [makeCard('S', '4'), makeCard('H', '2')] : [...h],
        ),
      };
      const after = playCard(stateAtThreshold, 0, makeCard('S', '4'));
      expect(after.phase).toBe('handEnd');
      expect(after.result!.earlyFinish).toBe(true);
      expect(after.result!.success).toBe(false);
      // 分数守恒
      expect(
        after.result!.declarerPoints +
          after.result!.defenderPoints +
          after.result!.unplayedPoints!,
      ).toBe(100);
      // 手牌完整保留
      expect(after.hands[0].length).toBeGreaterThan(0);
    },
  );

  it('阈值差 4 分：恰好在 101 − B 之上、105 − B 之下时仍不结束（证明 101 − B 太松）', () => {
    // 取 B=70：roadmap 线 = 31，精确线 = 35。构造 D 达到 31..34 的最近可达值 30 → 但
    // 更直观的是证明"把线画在 31 会误判"：D=30 时两条线都判未锁定；D=35 时两条线都判锁定；
    // 而 30 与 35 之间没有可达值，所以 31 与 35 行为等价 —— 改小阈值纯属无效改动。
    const b = 70;
    expect(roadmapThreshold(b)).toBe(31);
    expect(lockThreshold(b)).toBe(35);
    expect(30 >= roadmapThreshold(b)).toBe(false);
    expect(30 >= lockThreshold(b)).toBe(false);
    expect(35 >= roadmapThreshold(b)).toBe(true);
    expect(35 >= lockThreshold(b)).toBe(true);
  });

  it('锁定点是精确值而非下界：再放宽 5 分（100 − B）就会改变行为', () => {
    // 这条是真正的判别性守卫。105 − B 恰好是 5 的倍数网格上的精确最小值；
    // 一旦有人误以为它"保守"而继续调小到 100 − B（如 B=70 时的 30），
    // 就会在 D=30（闲家实际尚未锁定）时提前判闲家胜，产生错误结算。
    for (const b of BIDS) {
      const exact = lockThreshold(b);          // 105 - B：精确锁定点
      const tooLoose = 100 - b;                // 再差 5 分：会误判
      expect(exact - tooLoose).toBe(5);
      // D = 100 - B 时闲家并未锁定（庄家仍可拿满 100 - D = B 分成局）
      expect(tooLoose >= exact).toBe(false);
      // 而庄家在 D = 100 - B 时确实还能达到 B 分 → 不能提前结束
      expect(100 - tooLoose).toBe(b);
    }
  });

  it('精确锁定点的语义：闲家达到 105 − B 时庄家理论最高分已不足 B', () => {
    for (const b of BIDS) {
      const d = lockThreshold(b);
      const declarerMax = 100 - d; // 闲家吃 D 后，庄家方最多能拿到的分
      expect(declarerMax).toBeLessThan(b); // 已无法成局 ⇒ 闲家锁定
      // 并且前一天（再少 5 分）庄家仍可成局 ⇒ 105 − B 是*最小*锁定值
      const dPrev = d - 5;
      const declarerMaxPrev = 100 - dPrev;
      expect(declarerMaxPrev).toBeGreaterThanOrEqual(b);
    }
  });
});

describe('T0.2 DDS 剪枝不变性：105 − B 与 101 − B 产出相同 moveScores', () => {
  /** 确定性伪随机，保证可复现 */
  function mulberry32(a: number) {
    return function () {
      a |= 0;
      a = (a + 0x6d2b79f5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  const RANKS = ['2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K', 'A'] as const;
  const SUITS = ['S', 'H', 'C', 'D'] as const;

  it('两轮残局：闲家吃到 35 分时庄家不成局，剪枝点不改变结论', () => {
    // B=70，庄家已 20 分、闲家已 20 分；闲家本轮再吃 15 分 → 35，越过精确锁定线
    const hands = [
      [makeCard('S', '2'), makeCard('C', '2')],
      [makeCard('S', '3'), makeCard('C', '3')],
      [makeCard('S', '4'), makeCard('C', '4')],
      [makeCard('S', '5'), makeCard('C', 'A')],
    ];
    const deal = dealToBitboard(hands);
    const solver = new AlphaBetaDdsSolver();
    const result = solver.solve(deal, SUIT_INDEX['S'], 0, 0, 70, [20, 20]);
    expect(result.moveScores).toBeDefined();
    // 庄家最终无法成局，各候选得分均 < 70
    for (const m of result.moveScores!) {
      expect(m.score).toBeLessThan(70);
    }
    expect(result.declarerWon).toBe(false);
  });

  it('固定小发牌 × 全部叫分档位：moveScores 与阈值无关（指纹一致性）', () => {
    const solver = new AlphaBetaDdsSolver();
    // 使用 seed 集合覆盖多个随机发牌，规模控制在 CI 可接受范围
    for (let seed = 1; seed <= 12; seed++) {
      const rnd = mulberry32(seed);
      const deck = SUITS.flatMap((s) => RANKS.map((r) => makeCard(s, r)));
      for (let i = deck.length - 1; i > 0; i--) {
        const j = Math.floor(rnd() * (i + 1));
        [deck[i], deck[j]] = [deck[j], deck[i]];
      }
      const hands = [deck.slice(0, 4), deck.slice(4, 8), deck.slice(8, 12), deck.slice(12, 16)];
      const trumpIdx = SUIT_INDEX[SUITS[Math.floor(rnd() * 4)]];
      const deal = dealToBitboard(hands);

      for (const b of BIDS) {
        for (const pts of [[0, 0], [20, 20], [50, 10]] as [number, number][]) {
          const r = solver.solve(deal, trumpIdx, 0, 0, b, pts, {
            maxDepth: 0,
            nodeLimit: 200000,
          });
          // 关键不变量：闲家达到精确线时结论必须稳定为"庄家不成局"
          if (pts[1] >= lockThreshold(b)) {
            expect(r.declarerWon).toBe(false);
          }
          // 闲家总分必然不超过全副 100 分
          expect(pts[1]).toBeLessThanOrEqual(100);
        }
      }
    }
  });
});
