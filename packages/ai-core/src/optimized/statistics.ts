/** 只负责配对统计与预定检查点下的联合误差界。 */
import { Card, cardId } from '@yaozifen/game-core/cards';
import { MoveEstimate, PairEstimate } from './contracts';

interface Counter { samples: number; total: number }
const pairKey = (a: string, b: string): string => `${a}:${b}`;

export class PairedStatistics {
  private readonly counters = new Map<string, Counter>();
  private readonly pairs = new Map<string, Counter>();

  constructor(private readonly cards: readonly Card[]) {
    cards.forEach((card) => this.counters.set(cardId(card), { samples: 0, total: 0 }));
  }

  copy(): PairedStatistics {
    const copy = new PairedStatistics(this.cards);
    for (const [key, counter] of this.counters) copy.counters.set(key, { ...counter });
    for (const [key, counter] of this.pairs) copy.pairs.set(key, { ...counter });
    return copy;
  }

  record(row: ReadonlyMap<string, 0 | 1>): void {
    const ids = [...row.keys()].sort();
    for (const id of ids) {
      const counter = this.counters.get(id);
      if (!counter) throw new Error('配对统计收到未知候选');
      counter.samples++;
      counter.total += row.get(id)!;
    }
    for (let i = 0; i < ids.length; i++) for (let j = i + 1; j < ids.length; j++) {
      const key = pairKey(ids[i], ids[j]);
      const counter = this.pairs.get(key) ?? { samples: 0, total: 0 };
      counter.samples++;
      counter.total += row.get(ids[i])! - row.get(ids[j])!;
      this.pairs.set(key, counter);
    }
  }

  estimates(active: ReadonlySet<string>): MoveEstimate[] {
    return this.cards.map((card) => {
      const counter = this.counters.get(cardId(card))!;
      return {
        card, winRate: counter.samples ? counter.total / counter.samples : 0,
        samples: counter.samples, active: active.has(cardId(card)),
      };
    });
  }

  comparisons(checkpoints: number, errorProbability: number): PairEstimate[] {
    const pairCount = Math.max(1, this.cards.length * (this.cards.length - 1) / 2);
    return [...this.pairs].map(([key, counter]) => {
      const [a, b] = key.split(':');
      const difference = counter.total / counter.samples;
      const radius = Math.sqrt(2 * Math.log(2 * pairCount * checkpoints / errorProbability) / counter.samples);
      return {
        a, b, samples: counter.samples, difference,
        lower: Math.max(-1, difference - radius), upper: Math.min(1, difference + radius),
      };
    });
  }
}

export function comparisonFor(pairs: readonly PairEstimate[], a: string, b: string): PairEstimate | undefined {
  const direct = pairs.find((pair) => pair.a === a && pair.b === b);
  if (direct) return direct;
  const reversed = pairs.find((pair) => pair.a === b && pair.b === a);
  return reversed && { ...reversed, a, b, difference: -reversed.difference, lower: -reversed.upper, upper: -reversed.lower };
}
