/** 旧搜索兼容接口：全部通过玩家观察与约束采样器构造世界。 */
import { Card, Rng, cardId, freshDeck, makeRng } from '../cards';
import { GameState } from '../engine';
import { observePlayer } from './optimized/observation';
import { constrainedWorldFactory } from './optimized/belief';
import { HiddenWorld, WorldSource } from './optimized/contracts';
import { unlimitedGuard } from './optimized/computation';

export function unknownCards(state: GameState, seat: number): Card[] {
  const observation = observePlayer(state, seat);
  const known = new Set([
    ...observation.ownHand, ...(observation.revealedHand?.cards ?? []),
    ...observation.completedRounds.flatMap(round => round.cards.map(entry => entry.card)),
    ...observation.currentRound.map(entry => entry.card), ...(observation.knownBuriedCards ?? []),
  ].map(cardId));
  return freshDeck().filter(card => !known.has(cardId(card)));
}

export function hiddenWorldSource(state: GameState, seat: number): WorldSource {
  return constrainedWorldFactory.create(observePlayer(state, seat), unlimitedGuard);
}

export function sampleHiddenWorld(source: WorldSource, rng: Rng): HiddenWorld {
  return source.sample({ nextUint32: () => Math.floor(rng() * 0x100000000) }, unlimitedGuard);
}

/** 兼容原返回值；需要推演的调用者必须使用 sampleHiddenWorld 同时更新底牌。 */
export function sampleHiddenHands(state: GameState, seat: number, rng: Rng): Card[][] {
  return sampleHiddenWorld(hiddenWorldSource(state, seat), rng).hands.map(hand => [...hand]);
}

/** 显式注入的测试随机源；搜索不再以发牌 seed 初始化。 */
export function rngFrom(seed: number, salt: number): Rng {
  return makeRng((seed ^ Math.imul(salt + 1, 0x9e3779b1)) >>> 0);
}
