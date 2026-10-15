/** 合法出牌观察契约（ISP）：描述可见信息，不依赖具体搜索实现。 */
import type { Card, Suit } from "@yaozifen/game-core/cards";
import type { CompletedTrick, TrickCard } from "@yaozifen/game-core";

export interface PlayerObservation {
  readonly seat: number;
  readonly ownHand: readonly Card[];
  /** 100 分扣底后公开的庄家搭档手牌；包含明牌玩家本人的观察。 */
  readonly revealedHand?: { readonly seat: number; readonly cards: readonly Card[] };
  readonly handCounts: readonly number[];
  readonly declarer: number;
  readonly bid: number;
  readonly trump: Suit;
  readonly leader: number;
  readonly roundNumber: number;
  readonly currentRound: readonly TrickCard[];
  readonly completedRounds: readonly CompletedTrick[];
  readonly voidSuits: readonly (readonly Suit[])[];
  readonly declarerPoints: number;
  readonly defenderPoints: number;
  readonly kittySize: number;
  readonly knownBuriedCards?: readonly Card[];
  readonly ruleId: 'basic-v1';
}
