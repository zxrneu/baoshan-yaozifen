/**
 * 幺子分“最优出牌”实验证据集。
 *
 * 所有实验共用同一组发牌种子（共同随机数），策略间做**配对**比较，
 * 差分带 95% 置信区间，避免“随机发牌噪声掩盖策略差异”。
 *
 *  运行：pnpm vitest run -c experiments/vitest.config.ts
 *  结果：experiments/results/*.json
 */
import { describe, it } from 'vitest';
import {
  PlayPolicy, Policy, bucketSuccess, fastPlay, feedPlay, feedSafePlay, forcedBid,
  greedyPlay, heuristicBidPolicy, logTable, minPlay, noRuffPlay, pairedDiff,
  partnerSafePlay, playHand, randomPlay, randomTrump, saveJson, searchCrnPlay,
  searchPlay, shortFirstBury, smartBidPolicy, smartBuryPolicy, smartTrumpPolicy,
  summarize, takeIt70, pointsTrump, randomBury, longestTrump, roleSplit, HandRow,
} from './harness';
import { Card, Suit } from '../src/cards';

const N_FAST = 4000;
const N_SEARCH = 400;

function runMany(
  seeds: number[],
  base: Omit<Parameters<typeof playHand>[0], 'seed'>,
  playPolicy: PlayPolicy,
): HandRow[] {
  const rows: HandRow[] = [];
  for (const seed of seeds) rows.push(playHand({ ...base, seed, playPolicy }));
  return rows;
}

const seeds = (n: number): number[] => Array.from({ length: n }, (_, i) => i + 1);

// ─────────────────────────── A1：出牌策略消融（强制叫 70） ───────────────────────────

describe('A1 出牌策略消融（强制叫 70，定主/扣底固定 smart）', () => {
  const POLICIES: [string, PlayPolicy][] = [
    ['random', randomPlay],
    ['min', minPlay],
    ['greedy', greedyPlay],
    ['partnerSafe', partnerSafePlay],
    ['feed', feedPlay],
    ['fast(出厂)', fastPlay],
    ['feedSafe', feedSafePlay],
    ['noRuff', noRuffPlay],
  ];

  it('快策略 N=4000 配对比较', () => {
    const base = {
      bidPolicy: forcedBid(70),
      trumpPolicy: smartTrumpPolicy,
      buryPolicy: smartBuryPolicy,
    };
    const S = seeds(N_FAST);
    const out: Record<string, unknown>[] = [];
    const all: Record<string, HandRow[]> = {};
    for (const [name, policy] of POLICIES) {
      const rows = runMany(S, base, policy);
      all[name] = rows;
      out.push({ policy: name, ...summarize(rows) });
    }
    const ref = all['fast(出厂)'].map((r) => r.declarerPoints);
    const refSucc = all['fast(出厂)'].map((r) => (r.success ? 1 : 0));
    for (const [name] of POLICIES) {
      const d = pairedDiff(all[name].map((r) => r.declarerPoints), ref);
      const s = pairedDiff(all[name].map((r) => (r.success ? 1 : 0)), refSucc);
      out.push({
        policy: name,
        vsFast_庄分差: +d.diff.toFixed(3),
        ci: [+d.lo.toFixed(3), +d.hi.toFixed(3)],
        vsFast_成局率差: +(s.diff * 100).toFixed(2),
        ci_pct: [+(s.lo * 100).toFixed(2), +(s.hi * 100).toFixed(2)],
      });
    }
    logTable('A1 play-ablation (forced bid 70)', out);
    saveJson('A1_play_ablation', {
      n: N_FAST,
      summaries: Object.fromEntries(
        Object.entries(all).map(([k, v]) => [k, summarize(v)]),
      ),
      pairedVsFast: Object.fromEntries(
        Object.entries(all).map(([k, v]) => [
          k,
          {
            declarerPoints: pairedDiff(v.map((r) => r.declarerPoints), ref),
            success: pairedDiff(v.map((r) => (r.success ? 1 : 0)), refSucc),
          },
        ]),
      ),
    });
  }, 900_000);

  it('搜索类策略 N=400（同种子）', () => {
    const base = {
      bidPolicy: forcedBid(70),
      trumpPolicy: smartTrumpPolicy,
      buryPolicy: smartBuryPolicy,
    };
    const S = seeds(N_SEARCH);
    const rowsFeed = runMany(S, base, feedPlay);
    const rowsFast = runMany(S, base, fastPlay);
    const rowsSearch = runMany(S, base, searchPlay);
    const rowsCrn = runMany(S, base, searchCrnPlay);
    const ref = rowsFeed.map((r) => r.declarerPoints);
    const refSucc = rowsFeed.map((r) => (r.success ? 1 : 0));
    const out = [
      { policy: 'feed(同种子基线)', ...summarize(rowsFeed) },
      { policy: 'fast(出厂)', ...summarize(rowsFast) },
      { policy: 'search(原版)', ...summarize(rowsSearch) },
      { policy: 'searchCrn(共同随机数)', ...summarize(rowsCrn) },
    ];
    for (const [name, rows] of [
      ['fast(出厂)', rowsFast],
      ['search(原版)', rowsSearch],
      ['searchCrn', rowsCrn],
    ] as [string, HandRow[]][]) {
      const d = pairedDiff(rows.map((r) => r.declarerPoints), ref);
      const s = pairedDiff(rows.map((r) => (r.success ? 1 : 0)), refSucc);
      out.push({
        policy: `${name} vs feed`,
        庄分差: +d.diff.toFixed(3),
        ci: [+d.lo.toFixed(3), +d.hi.toFixed(3)],
        成局率差: +(s.diff * 100).toFixed(2),
        ci_pct: [+(s.lo * 100).toFixed(2), +(s.hi * 100).toFixed(2)],
      });
    }
    logTable('A1b search vs heuristics', out);
    saveJson('A1_search', {
      n: N_SEARCH,
      summaries: {
        feed: summarize(rowsFeed),
        fast: summarize(rowsFast),
        search: summarize(rowsSearch),
        searchCrn: summarize(rowsCrn),
      },
      pairedVsFeed: {
        fast: pairedDiff(rowsFast.map((r) => r.declarerPoints), ref),
        search: pairedDiff(rowsSearch.map((r) => r.declarerPoints), ref),
        searchCrn: pairedDiff(rowsCrn.map((r) => r.declarerPoints), ref),
      },
    });
  }, 900_000);
});

// ─────────────────────────── A2：出牌策略消融（真实叫分 smartBid） ───────────────────────────

describe('A2 出牌策略消融（smartBid 真实叫分）', () => {
  it('N=3000，叫分/定主/扣底完全一致，只差出牌', () => {
    const base = {
      bidPolicy: smartBidPolicy,
      trumpPolicy: smartTrumpPolicy,
      buryPolicy: smartBuryPolicy,
    };
    const S = seeds(3000);
    const POLICIES: [string, PlayPolicy][] = [
      ['random', randomPlay],
      ['min', minPlay],
      ['greedy', greedyPlay],
      ['partnerSafe', partnerSafePlay],
      ['feed', feedPlay],
      ['fast(出厂)', fastPlay],
      ['noRuff', noRuffPlay],
    ];
    const all: Record<string, HandRow[]> = {};
    for (const [name, policy] of POLICIES) all[name] = runMany(S, base, policy);
    const ref = all['fast(出厂)'];
    const out: Record<string, unknown>[] = [];
    for (const [name] of POLICIES) {
      const rows = all[name];
      const d = pairedDiff(rows.map((r) => r.declarerPoints), ref.map((r) => r.declarerPoints));
      const s = pairedDiff(
        rows.map((r) => (r.success ? 1 : 0)),
        ref.map((r) => (r.success ? 1 : 0)),
      );
      out.push({
        policy: name,
        ...summarize(rows),
        vsFast庄分差: +d.diff.toFixed(3),
        vsFast成局率差pp: +(s.diff * 100).toFixed(2),
      });
    }
    logTable('A2 play-ablation (smartBid)', out);
    saveJson('A2_play_ablation_smartbid', {
      n: 3000,
      summaries: Object.fromEntries(Object.entries(all).map(([k, v]) => [k, summarize(v)])),
      pairedVsFast: Object.fromEntries(
        Object.entries(all).map(([k, v]) => [
          k,
          {
            declarerPoints: pairedDiff(
              v.map((r) => r.declarerPoints),
              ref.map((r) => r.declarerPoints),
            ),
            success: pairedDiff(
              v.map((r) => (r.success ? 1 : 0)),
              ref.map((r) => (r.success ? 1 : 0)),
            ),
          },
        ]),
      ),
    });
  }, 900_000);
});

// ─────────────────────────── B：叫分难度曲线 ───────────────────────────

describe('B 叫分难度曲线：叫 X 分到底多难', () => {
  it('强制叫 X（随机座位坐庄），N=4000/档', () => {
    const N = 4000;
    const BIDS = [70, 75, 80, 85, 90, 95, 100];
    const base = {
      trumpPolicy: smartTrumpPolicy,
      buryPolicy: smartBuryPolicy,
      playPolicy: feedPlay,
    };
    const S = seeds(N);
    const out: Record<string, unknown>[] = [];
    const raw: Record<number, HandRow[]> = {};
    for (const x of BIDS) {
      const rows: HandRow[] = [];
      for (const seed of S) rows.push(playHand({ ...base, seed, bidPolicy: forcedBid(x) }));
      raw[x] = rows;
      const s = summarize(rows);
      out.push({
        叫分: x,
        成局率: +s.successRate.toFixed(4),
        ci: [+s.successCI[0].toFixed(4), +s.successCI[1].toFixed(4)],
        庄家均分: +s.meanDeclarerPoints.toFixed(2),
        庄家起手均分: +s.meanHandPoints.toFixed(2),
        庄家起手牌力: +s.meanStrength.toFixed(2),
      });
    }
    logTable('B bid-difficulty curve', out);

    // 按庄家起手强度分层（叫 70）
    const rows70 = raw[70];
    const strengthEdges = [30, 40, 50, 60];
    const byStrength = bucketSuccess(rows70, (r) => r.declStrength, strengthEdges);
    const byHandPoints = bucketSuccess(
      rows70,
      (r) => r.declHandPoints,
      [15, 25, 35, 45],
    );
    logTable('B2 叫70 · 按起手牌力分层', byStrength as unknown as Record<string, unknown>[]);
    logTable('B2 叫70 · 按起手分牌分层', byHandPoints as unknown as Record<string, unknown>[]);

    saveJson('B_bid_curve', {
      n: N,
      curve: out,
      byStrength_70: byStrength,
      byHandPoints_70: byHandPoints,
      byStrength_100: bucketSuccess(raw[100], (r) => r.declStrength, strengthEdges),
    });
  }, 900_000);
});

// ─────────────────────────── C：定主消融 ───────────────────────────

describe('C 定主策略消融（强制叫 70）', () => {
  it('N=4000/档', () => {
    const N = 4000;
    const S = seeds(N);
    const base = { bidPolicy: forcedBid(70), buryPolicy: smartBuryPolicy, playPolicy: feedPlay };
    const TRUMPS: [string, Policy<Suit>][] = [
      ['smart(长度×控制×分)', smartTrumpPolicy],
      ['longest(最长门)', longestTrump],
      ['points(分最多门)', pointsTrump],
      ['random', randomTrump],
    ];
    const all: Record<string, HandRow[]> = {};
    for (const [name, tp] of TRUMPS) {
      const rows: HandRow[] = [];
      for (const seed of S) rows.push(playHand({ ...base, seed, trumpPolicy: tp }));
      all[name] = rows;
    }
    const ref = all['smart(长度×控制×分)'];
    const out: Record<string, unknown>[] = [];
    for (const [name] of TRUMPS) {
      const rows = all[name];
      const d = pairedDiff(rows.map((r) => r.declarerPoints), ref.map((r) => r.declarerPoints));
      const s = pairedDiff(
        rows.map((r) => (r.success ? 1 : 0)),
        ref.map((r) => (r.success ? 1 : 0)),
      );
      out.push({
        定主: name,
        ...summarize(rows),
        vsSmart庄分差: +d.diff.toFixed(3),
        ci: [+d.lo.toFixed(3), +d.hi.toFixed(3)],
        vsSmart成局率差pp: +(s.diff * 100).toFixed(2),
      });
    }
    logTable('C trump-ablation', out);
    saveJson('C_trump_ablation', {
      n: N,
      summaries: Object.fromEntries(Object.entries(all).map(([k, v]) => [k, summarize(v)])),
      pairedVsSmart: Object.fromEntries(
        Object.entries(all).map(([k, v]) => [
          k,
          {
            declarerPoints: pairedDiff(
              v.map((r) => r.declarerPoints),
              ref.map((r) => r.declarerPoints),
            ),
            success: pairedDiff(
              v.map((r) => (r.success ? 1 : 0)),
              ref.map((r) => (r.success ? 1 : 0)),
            ),
          },
        ]),
      ),
    });
  }, 900_000);
});

// ─────────────────────────── D：扣底消融 ───────────────────────────

describe('D 扣底策略消融（强制叫 70）', () => {
  it('N=4000/档', () => {
    const N = 4000;
    const S = seeds(N);
    const base = { bidPolicy: forcedBid(70), trumpPolicy: smartTrumpPolicy, playPolicy: feedPlay };
    const BURIES: [string, Policy<Card[]>][] = [
      ['smart(短门+保主+保赢张)', smartBuryPolicy],
      ['shortFirst(短门优先)', shortFirstBury],
      ['random(随机扣非分牌)', randomBury],
    ];
    const all: Record<string, HandRow[]> = {};
    for (const [name, bp] of BURIES) {
      const rows: HandRow[] = [];
      for (const seed of S) rows.push(playHand({ ...base, seed, buryPolicy: bp }));
      all[name] = rows;
    }
    const ref = all['smart(短门+保主+保赢张)'];
    const out: Record<string, unknown>[] = [];
    for (const [name] of BURIES) {
      const rows = all[name];
      const d = pairedDiff(rows.map((r) => r.declarerPoints), ref.map((r) => r.declarerPoints));
      const s = pairedDiff(
        rows.map((r) => (r.success ? 1 : 0)),
        ref.map((r) => (r.success ? 1 : 0)),
      );
      out.push({
        扣底: name,
        ...summarize(rows),
        vsSmart庄分差: +d.diff.toFixed(3),
        ci: [+d.lo.toFixed(3), +d.hi.toFixed(3)],
        vsSmart成局率差pp: +(s.diff * 100).toFixed(2),
      });
    }
    logTable('D bury-ablation', out);
    saveJson('D_bury_ablation', {
      n: N,
      summaries: Object.fromEntries(Object.entries(all).map(([k, v]) => [k, summarize(v)])),
      pairedVsSmart: Object.fromEntries(
        Object.entries(all).map(([k, v]) => [
          k,
          {
            declarerPoints: pairedDiff(
              v.map((r) => r.declarerPoints),
              ref.map((r) => r.declarerPoints),
            ),
            success: pairedDiff(
              v.map((r) => (r.success ? 1 : 0)),
              ref.map((r) => (r.success ? 1 : 0)),
            ),
          },
        ]),
      ),
    });
  }, 900_000);
});

// ─────────────────────────── F：叫分策略对打 ───────────────────────────

describe('F 叫分策略对打（东西 vs 南北，出牌/定主/扣底全同）', () => {
  const vsBid = (
    a: Policy<number | null>, b: Policy<number | null>,
  ): Policy<number | null> => (s, seat) => (seat % 2 === 0 ? a(s, seat) : b(s, seat));

  const pairs: [string, Policy<number | null>, Policy<number | null>][] = [
    ['smartBid vs 盲叫70', smartBidPolicy, takeIt70],
    ['smartBid vs 启发式v1', smartBidPolicy, heuristicBidPolicy],
    ['启发式v1 vs 盲叫70', heuristicBidPolicy, takeIt70],
  ];

  for (const [name, a, b] of pairs) {
    it(`${name} N=4000`, () => {
      const N = 4000;
      const base = {
        bidPolicy: vsBid(a, b),
        trumpPolicy: smartTrumpPolicy,
        buryPolicy: smartBuryPolicy,
        playPolicy: feedPlay,
      };
      const ewWin: number[] = [];
      const rows: HandRow[] = [];
      for (const seed of seeds(N)) {
        const r = playHand({ ...base, seed });
        rows.push(r);
        ewWin.push(r.success ? (r.declarerSide === 0 ? 1 : 0) : r.declarerSide === 1 ? 1 : 0);
      }
      const p = ewWin.reduce((x, y) => x + y, 0) / N;
      const se = Math.sqrt((p * (1 - p)) / N);
      const ewRows = rows.filter((r) => r.declarerSide === 0);
      const nsRows = rows.filter((r) => r.declarerSide === 1);
      const line = {
        对局: name,
        N,
        东西胜率: +p.toFixed(4),
        ci: [+(p - 1.96 * se).toFixed(4), +(p + 1.96 * se).toFixed(4)],
        东东西坐庄占比: +(ewRows.length / N).toFixed(4),
        东西成局率: ewRows.length
          ? +(ewRows.filter((r) => r.success).length / ewRows.length).toFixed(4)
          : NaN,
        南北成局率: nsRows.length
          ? +(nsRows.filter((r) => r.success).length / nsRows.length).toFixed(4)
          : NaN,
        平均叫分: +(rows.reduce((x, r) => x + r.bid, 0) / N).toFixed(2),
      };
      logTable(`F ${name}`, [line as unknown as Record<string, unknown>]);
      saveJson(`F_${name.replace(/\s|vs/g, '_')}`, {
        n: N, line, rows: rows.map((r) => ({ ...r })),
      });
    });
  }
});

// ─────────────────── E：按角色拆分的出牌消融（进攻 / 防守分开测） ───────────────────

describe('E 角色拆分出牌消融（强制叫 70）', () => {
  const POLICIES: [string, PlayPolicy][] = [
    ['random', randomPlay],
    ['min', minPlay],
    ['greedy', greedyPlay],
    ['partnerSafe', partnerSafePlay],
    ['feed', feedPlay],
    ['fast(出厂)', fastPlay],
    ['feedSafe', feedSafePlay],
    ['noRuff', noRuffPlay],
  ];

  /** E1 进攻：庄家方换策略，闲家固定用出厂 fast */
  it('E1 进攻消融（闲家固定 fast）N=4000', () => {
    const N = 4000;
    const all: Record<string, HandRow[]> = {};
    for (const [name, pol] of POLICIES) {
      const rows: HandRow[] = [];
      for (const seed of seeds(N)) {
        rows.push(playHand({
          seed,
          bidPolicy: forcedBid(70),
          trumpPolicy: smartTrumpPolicy,
          buryPolicy: smartBuryPolicy,
          playPolicy: roleSplit(pol, fastPlay),
        }));
      }
      all[name] = rows;
    }
    const ref = all['fast(出厂)'];
    const out: Record<string, unknown>[] = [];
    for (const [name] of POLICIES) {
      const rows = all[name];
      const d = pairedDiff(rows.map((r) => r.declarerPoints), ref.map((r) => r.declarerPoints));
      const s = pairedDiff(
        rows.map((r) => (r.success ? 1 : 0)),
        ref.map((r) => (r.success ? 1 : 0)),
      );
      out.push({
        进攻策略: name,
        庄分: +summarize(rows).meanDeclarerPoints.toFixed(3),
        成局率: +summarize(rows).successRate.toFixed(4),
        vsFast庄分差: +d.diff.toFixed(3),
        ci: [+d.lo.toFixed(3), +d.hi.toFixed(3)],
        vsFast成局率差pp: +(s.diff * 100).toFixed(2),
        ci_pp: [+(s.lo * 100).toFixed(2), +(s.hi * 100).toFixed(2)],
      });
    }
    logTable('E1 offense ablation', out);
    saveJson('E1_offense', {
      n: N,
      summaries: Object.fromEntries(Object.entries(all).map(([k, v]) => [k, summarize(v)])),
      pairedVsFast: Object.fromEntries(
        Object.entries(all).map(([k, v]) => [
          k,
          {
            declarerPoints: pairedDiff(
              v.map((r) => r.declarerPoints),
              ref.map((r) => r.declarerPoints),
            ),
            success: pairedDiff(
              v.map((r) => (r.success ? 1 : 0)),
              ref.map((r) => (r.success ? 1 : 0)),
            ),
          },
        ]),
      ),
    });
  }, 900_000);

  /** E2 防守：闲家换策略，庄家方固定用出厂 fast */
  it('E2 防守消融（庄家方固定 fast）N=4000', () => {
    const N = 4000;
    const all: Record<string, HandRow[]> = {};
    for (const [name, pol] of POLICIES) {
      const rows: HandRow[] = [];
      for (const seed of seeds(N)) {
        rows.push(playHand({
          seed,
          bidPolicy: forcedBid(70),
          trumpPolicy: smartTrumpPolicy,
          buryPolicy: smartBuryPolicy,
          playPolicy: roleSplit(fastPlay, pol),
        }));
      }
      all[name] = rows;
    }
    const ref = all['fast(出厂)'];
    const out: Record<string, unknown>[] = [];
    for (const [name] of POLICIES) {
      const rows = all[name];
      const d = pairedDiff(rows.map((r) => r.declarerPoints), ref.map((r) => r.declarerPoints));
      const s = pairedDiff(
        rows.map((r) => (r.success ? 1 : 0)),
        ref.map((r) => (r.success ? 1 : 0)),
      );
      out.push({
        防守策略: name,
        庄分: +summarize(rows).meanDeclarerPoints.toFixed(3),
        成局率: +summarize(rows).successRate.toFixed(4),
        vsFast庄分差: +d.diff.toFixed(3),
        ci: [+d.lo.toFixed(3), +d.hi.toFixed(3)],
        vsFast成局率差pp: +(s.diff * 100).toFixed(2),
        ci_pp: [+(s.lo * 100).toFixed(2), +(s.hi * 100).toFixed(2)],
      });
    }
    logTable('E2 defense ablation（负的庄分差 = 防守更强）', out);
    saveJson('E2_defense', {
      n: N,
      summaries: Object.fromEntries(Object.entries(all).map(([k, v]) => [k, summarize(v)])),
      pairedVsFast: Object.fromEntries(
        Object.entries(all).map(([k, v]) => [
          k,
          {
            declarerPoints: pairedDiff(
              v.map((r) => r.declarerPoints),
              ref.map((r) => r.declarerPoints),
            ),
            success: pairedDiff(
              v.map((r) => (r.success ? 1 : 0)),
              ref.map((r) => (r.success ? 1 : 0)),
            ),
          },
        ]),
      ),
    });
  }, 900_000);
});
