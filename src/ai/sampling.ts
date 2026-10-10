/**
 * 采样模块（SRP：只负责构造“未知牌”的随机世界，不做评估 / 决策）。
 *
 * 用法：search 在每个候选动作之后采样 N 个与当前可见信息一致的世界，
 * 每个世界用快速推演（rollout）走完，取平均效用。
 */
import { Card, Rng, cardId, makeRng } from '../cards';
import { GameState, revealedPartnerSeat } from '../engine';

/** 排除我的手牌、已出牌与底牌后，其余牌作为未知牌 */
export function unknownCards(state: GameState, seat: number): Card[] {
  const known = new Set<string>();
  for (const c of state.hands[seat]) known.add(cardId(c));
  const revealed = revealedPartnerSeat(state);
  if (revealed !== null) for (const c of state.hands[revealed]) known.add(cardId(c));
  for (const t of state.trick) known.add(cardId(t.card));
  for (const t of state.lastTrick) known.add(cardId(t.card));
  for (const c of state.kitty) known.add(cardId(c));
  const all = state.hands.flat().concat(state.kitty, state.trick.map((t) => t.card));
  const seen = new Set<string>();
  const out: Card[] = [];
  for (const c of all) {
    const id = cardId(c);
    if (seen.has(id)) continue;
    seen.add(id);
    if (!known.has(id)) out.push(c);
  }
  return out;
}

function shuffled<T>(arr: T[], rng: Rng): T[] {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

/**
 * 把未知牌随机发给其他三家（数量与他们当前手牌数一致），返回补全后的 hands。
 * 注意：这是近似采样（未严格约束“必须能跟出历史花色”的分布），
 * 但对 12 轮、52 张的规模已足够给出方向性正确的期望，且速度快。
 */
export function sampleHiddenHands(state: GameState, seat: number, rng: Rng): Card[][] {
  const pool = shuffled(unknownCards(state, seat), rng);
  const hands: Card[][] = state.hands.map((h) => [...h]);
  const revealed = revealedPartnerSeat(state);
  let k = 0;
  for (let s = 0; s < 4; s++) {
    if (s === seat || s === revealed) continue;
    const count = state.hands[s].length;
    hands[s] = [];
    for (let i = 0; i < count && k < pool.length; i++) hands[s].push(pool[k++]);
  }
  return hands;
}

/** 由 seed 派生一局内独立的 rng，避免污染引擎的发牌 rng */
export function rngFrom(seed: number, salt: number): Rng {
  return makeRng((seed ^ Math.imul(salt + 1, 0x9e3779b1)) >>> 0);
}
