/** 可注入时间和随机源；不读取发牌 seed。 */
import { makeRng } from '@yaozifen/game-core/cards';
import { ComputationGuard, RandomSource } from './contracts';

export class BudgetExceededError extends Error {
  constructor() { super('搜索预算已用尽'); }
}
export class InconsistentObservationError extends Error {}
export const unlimitedGuard: ComputationGuard = { check() {} };

export function deadlineGuard(now: () => number, deadline: number): ComputationGuard {
  return { check() { if (now() >= deadline) throw new BudgetExceededError(); } };
}
export function seededSearchRandom(seed: number): RandomSource {
  const rng = makeRng(seed);
  return { nextUint32: () => Math.floor(rng() * 0x100000000) };
}
export function independentSearchRandom(): RandomSource {
  const seed = globalThis.crypto
    ? globalThis.crypto.getRandomValues(new Uint32Array(1))[0]
    : Math.floor(Math.random() * 0x100000000);
  return seededSearchRandom(seed);
}

/** 任意大小整数的无取模偏差抽样。 */
export function randomBelow(bound: bigint, random: RandomSource, guard: ComputationGuard): bigint {
  if (bound <= 0n) throw new RangeError('随机数上界必须为正');
  if (bound === 1n) return 0n;
  const bits = (bound - 1n).toString(2).length;
  const words = Math.ceil(bits / 32);
  const mask = (1n << BigInt(bits)) - 1n;
  for (;;) {
    guard.check();
    let value = 0n;
    for (let i = 0; i < words; i++) value = (value << 32n) | BigInt(random.nextUint32() >>> 0);
    value &= mask;
    if (value < bound) return value;
  }
}
