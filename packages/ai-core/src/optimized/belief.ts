/** 仅负责确定约束、完成数量和均匀采样，不评价牌的好坏。 */
import { Card, cardId, cardPoints, freshDeck } from '@yaozifen/game-core/cards';
import { OPEN_PARTNER_BID, partnerOf } from '@yaozifen/game-core';
import {
  ComputationGuard, EnumerableWorldSource, HiddenWorld, PlayerObservation,
  RandomSource, WorldSourceFactory,
} from './contracts';
import { InconsistentObservationError, randomBelow, unlimitedGuard } from './computation';

export interface AllocationProblem {
  readonly cards: readonly Card[];
  readonly capacities: readonly number[];
  /** 每张牌允许进入的位置下标。 */
  readonly allowedSlots: readonly (readonly number[])[];
}

export class CompletionAllocator {
  readonly count: bigint;
  private readonly memo = new Map<number, bigint>();
  private readonly cards: Card[];
  private readonly allowed: number[][];
  private readonly capacities: number[];
  private readonly strides: number[];
  private visits = 0;

  constructor(problem: AllocationProblem, guard: ComputationGuard = unlimitedGuard) {
    guard.check();
    if (problem.capacities.length > 4 || problem.capacities.length === 0
      || problem.capacities.some((n) => !Number.isInteger(n) || n < 0 || n > 12)
      || problem.cards.length !== problem.allowedSlots.length
      || problem.capacities.reduce((a, n) => a + n, 0) !== problem.cards.length
      || new Set(problem.cards.map(cardId)).size !== problem.cards.length
      || problem.allowedSlots.some((slots) => new Set(slots).size !== slots.length
        || slots.some((s) => !Number.isInteger(s) || s < 0 || s >= problem.capacities.length))) {
      throw new InconsistentObservationError('牌张、容量或接收位置不一致');
    }
    const ordered = problem.cards.map((card, i) => ({ card, slots: [...problem.allowedSlots[i]] }))
      .sort((a, b) => a.slots.length - b.slots.length || cardId(a.card).localeCompare(cardId(b.card)));
    this.cards = ordered.map((entry) => entry.card);
    this.allowed = ordered.map((entry) => entry.slots);
    this.capacities = [...problem.capacities];
    let stride = 1;
    this.strides = this.capacities.map((capacity) => {
      const value = stride;
      stride *= capacity + 1;
      return value;
    });
    this.count = this.completions(0, [...this.capacities], guard);
    guard.check();
  }

  private key(capacities: number[]): number {
    return capacities.reduce((key, value, i) => key + value * this.strides[i], 0);
  }

  private completions(index: number, capacities: number[], guard: ComputationGuard): bigint {
    if (++this.visits % 128 === 0) guard.check();
    if (index === this.cards.length) return capacities.every((n) => n === 0) ? 1n : 0n;
    const key = this.key(capacities);
    const cached = this.memo.get(key);
    if (cached !== undefined) return cached;
    let count = 0n;
    for (const slot of this.allowed[index]) {
      if (capacities[slot] === 0) continue;
      capacities[slot]--;
      count += this.completions(index + 1, capacities, guard);
      capacities[slot]++;
    }
    this.memo.set(key, count);
    return count;
  }

  sample(random: RandomSource, guard: ComputationGuard = unlimitedGuard): Card[][] {
    if (this.count === 0n) throw new InconsistentObservationError('没有满足约束的分配');
    const capacities = [...this.capacities];
    const slots: Card[][] = this.capacities.map(() => []);
    for (let i = 0; i < this.cards.length; i++) {
      guard.check();
      let choice = randomBelow(this.completions(i, capacities, guard), random, guard);
      for (const slot of this.allowed[i]) {
        if (capacities[slot] === 0) continue;
        capacities[slot]--;
        const count = this.completions(i + 1, capacities, guard);
        if (choice < count) {
          slots[slot].push(this.cards[i]);
          break;
        }
        choice -= count;
        capacities[slot]++;
      }
    }
    return slots;
  }

  enumerate(limit: number, guard: ComputationGuard = unlimitedGuard): Card[][][] | undefined {
    if (!Number.isInteger(limit) || limit < 0) throw new RangeError('枚举上限必须是非负整数');
    if (this.count > BigInt(limit)) return undefined;
    const result: Card[][][] = [];
    const capacities = [...this.capacities];
    const slots: Card[][] = capacities.map(() => []);
    const visit = (index: number): void => {
      guard.check();
      if (index === this.cards.length) {
        result.push(slots.map((cards) => [...cards]));
        return;
      }
      for (const slot of this.allowed[index]) {
        if (capacities[slot] === 0) continue;
        capacities[slot]--;
        if (this.completions(index + 1, capacities, guard) > 0n) {
          slots[slot].push(this.cards[index]);
          visit(index + 1);
          slots[slot].pop();
        }
        capacities[slot]++;
      }
    };
    if (this.count > 0n) visit(0);
    return result;
  }
}

export function createBeliefSource(
  observation: PlayerObservation, guard: ComputationGuard = unlimitedGuard,
): EnumerableWorldSource {
  const known = new Set<string>();
  const add = (card: Card): void => {
    const id = cardId(card);
    if (known.has(id)) throw new InconsistentObservationError(`已知牌重复：${id}`);
    known.add(id);
  };
  observation.ownHand.forEach(add);
  const revealed = observation.revealedHand;
  if (revealed) {
    if (observation.bid !== OPEN_PARTNER_BID || revealed.seat !== partnerOf(observation.declarer)
      || revealed.cards.length !== observation.handCounts[revealed.seat]
      || new Set(revealed.cards.map(cardId)).size !== revealed.cards.length
      || revealed.cards.some((card) => observation.voidSuits[revealed.seat]?.includes(card.suit))) {
      throw new InconsistentObservationError('明牌座位、张数或缺门约束无效');
    }
    if (revealed.seat === observation.seat) {
      if (revealed.cards.some((card) => !known.has(cardId(card)))) {
        throw new InconsistentObservationError('自己的手牌与明牌不一致');
      }
    } else revealed.cards.forEach(add);
  }
  for (const round of observation.completedRounds) round.cards.forEach((entry) => add(entry.card));
  observation.currentRound.forEach((entry) => add(entry.card));
  observation.knownBuriedCards?.forEach(add);
  if (observation.handCounts.length !== 4 || observation.voidSuits.length !== 4
    || observation.ownHand.length !== observation.handCounts[observation.seat]
    || (observation.knownBuriedCards && (observation.knownBuriedCards.length !== observation.kittySize
      || observation.knownBuriedCards.some((c) => cardPoints(c) !== 0)))) {
    throw new InconsistentObservationError('观察中的手牌或底牌计数无效');
  }
  const seats = [0, 1, 2, 3].filter((seat) => seat !== observation.seat && seat !== revealed?.seat);
  const capacities = seats.map((seat) => observation.handCounts[seat]);
  const hasUnknownKitty = observation.knownBuriedCards === undefined;
  if (hasUnknownKitty) capacities.push(observation.kittySize);
  const cards = freshDeck().filter((card) => !known.has(cardId(card)));
  const allowedSlots = cards.map((card) => {
    const allowed = seats.flatMap((seat, index) => observation.voidSuits[seat].includes(card.suit) ? [] : [index]);
    if (hasUnknownKitty && cardPoints(card) === 0) allowed.push(seats.length);
    return allowed;
  });
  const allocator = new CompletionAllocator({ cards, capacities, allowedSlots }, guard);
  if (allocator.count === 0n) throw new InconsistentObservationError('历史缺门与剩余牌矛盾');
  const world = (slots: Card[][]): HiddenWorld => {
    const hands: Card[][] = [[], [], [], []];
    hands[observation.seat] = [...observation.ownHand];
    if (revealed) hands[revealed.seat] = [...revealed.cards];
    seats.forEach((seat, index) => { hands[seat] = slots[index]; });
    return { hands, kitty: hasUnknownKitty ? slots[seats.length] : [...observation.knownBuriedCards!] };
  };
  return {
    count: allocator.count,
    sample: (random, samplingGuard) => world(allocator.sample(random, samplingGuard)),
    enumerate: (limit, enumerationGuard) => allocator.enumerate(limit, enumerationGuard)?.map(world),
  };
}

export const constrainedWorldFactory: WorldSourceFactory = { create: createBeliefSource };
