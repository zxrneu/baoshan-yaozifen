import { describe, it } from 'vitest';
import {
  PlayPolicy, feedPlay, forcedBid, greedyPlay, logTable, minPlay, noRuffPlay,
  partnerSafePlay, playHand, randomPlay, searchCrnPlay, searchPlay,
  smartBuryPolicy, smartBidPolicy, smartTrumpPolicy, summarize,
} from './harness';

const base = {
  bidPolicy: smartBidPolicy,
  trumpPolicy: smartTrumpPolicy,
  buryPolicy: smartBuryPolicy,
};

describe('benchmark', () => {
  it('单手牌耗时', () => {
    const N = 50;
    const policies: [string, PlayPolicy][] = [
      ['random', randomPlay],
      ['min', minPlay],
      ['greedy', greedyPlay],
      ['partnerSafe', partnerSafePlay],
      ['feed', feedPlay],
      ['noRuff', noRuffPlay],
    ];
    const out: Record<string, unknown>[] = [];
    for (const [name, policy] of policies) {
      const t0 = Date.now();
      const rows = [];
      for (let seed = 1; seed <= N; seed++) {
        rows.push(playHand({ seed, ...base, playPolicy: policy }));
      }
      const dt = Date.now() - t0;
      out.push({ name, msTotal: dt, msPerHand: +(dt / N).toFixed(1), ...summarize(rows) });
    }
    for (const [name, policy] of [['search', searchPlay], ['searchCrn', searchCrnPlay]] as [string, PlayPolicy][]) {
      const t0 = Date.now();
      const rows = [];
      for (let seed = 1; seed <= 10; seed++) {
        rows.push(playHand({
          seed, ...base, bidPolicy: forcedBid(70), playPolicy: policy,
        }));
      }
      const dt = Date.now() - t0;
      out.push({ name, msTotal: dt, msPerHand: +(dt / 10).toFixed(1), ...summarize(rows) });
    }
    logTable('benchmark', out);
  }, 600_000);
});
