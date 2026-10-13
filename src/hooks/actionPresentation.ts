/** 动作投影遵循单一职责：拆分可观察步骤，只为展示提供中间画面，不改变规则或 AI 输入。 */
import { type Card, SUIT_NAME, cardLabel } from '../cards';
import { type GameState, SEAT_NAMES, SIDE_NAMES, sideOf, revealedPartnerSeat } from '../engine';
import type { SessionCommit } from '../workbench/session';

export type PresentationKind = 'deal' | 'bid' | 'declarer' | 'trump' | 'kittyReveal' | 'kittyPickup' | 'bury' | 'partnerReveal' | 'play' | 'collect' | 'score' | 'result';
export interface ActionPresentation {
  kind: PresentationKind;
  title: string;
  detail: string;
  cards: Card[];
  hiddenCount: number;
  seat?: number;
  game: GameState;
  duration: number;
  index: number;
  total: number;
}
export interface PresentationVisibility { humanSeat: number; debug: boolean; peekedSeats: ReadonlySet<number> }
/** 逐帧按当前看牌状态遮蔽私有动作，关牌在尚未结束的展示中也即时生效。 */
export function visiblePresentation(action: ActionPresentation, visibility: PresentationVisibility): ActionPresentation {
  if (!['kittyReveal', 'kittyPickup', 'bury'].includes(action.kind) || action.seat === undefined ||
      visibility.debug || action.seat === visibility.humanSeat || visibility.peekedSeats.has(action.seat)) return action;
  return {
    ...action, cards: [], hiddenCount: action.cards.length || action.hiddenCount,
    detail: action.kind === 'kittyPickup' ? '牌面已隐藏；底牌已移入手牌。'
      : action.kind === 'bury' ? '牌面已隐藏；底牌盖好。' : '牌面已隐藏',
  };
}
export type ObservedAction = Pick<ActionPresentation, 'kind' | 'title' | 'detail'>;
export function presentationDelay(action: ActionPresentation, speed: 'fast' | 'normal' | 'slow'): number {
  return Math.round(action.duration * { fast: .8, normal: 1, slow: 1.6 }[speed]);
}
type Step = Omit<ActionPresentation, 'index' | 'total'>;
function numbered(steps: Step[]): ActionPresentation[] {
  return steps.map((step, index) => ({ ...step, index: index + 1, total: steps.length }));
}
function step(kind: PresentationKind, title: string, detail: string, game: GameState, cards: Card[] = [], seat?: number, hiddenCount = 0): Step {
  return { kind, title, detail, game, cards, hiddenCount, seat, duration: cards.length || hiddenCount ? 2200 : 1200 };
}
export function dealPresentation(game: GameState): ActionPresentation[] {
  return numbered([step('deal', '发牌完成', `东、南、西、北各 ${game.hands[0].length} 张，${game.kitty.length} 张底牌留在桌面；从${SEAT_NAMES[game.bidOrder[0]]}家开始叫分。`, game, [], undefined, game.kitty.length)]);
}
export function commitPresentation(event: SessionCommit, visibility: PresentationVisibility): ActionPresentation[] {
  const { command, before, after } = event;
  if (command.kind === 'nextHand') return dealPresentation(after);
  const seat = command.seat; const name = `${SEAT_NAMES[seat]}家`;
  const privateVisible = visibility.debug || seat === visibility.humanSeat || visibility.peekedSeats.has(seat);
  const steps: Step[] = [];
  if (command.kind === 'bid') {
    steps.push(step('bid', `${name}${command.bid === null ? '不叫' : `叫 ${command.bid} 分`}`, '本次叫分已确认。', before, [], seat));
    if (after.phase === 'trump') steps.push(step('declarer', `${SEAT_NAMES[after.declarer!]}家成为庄家`, `叫分 ${after.highestBid} 分，下一步定主。`, after, [], after.declarer!));
    else if (after.bidding.length === 0) steps.push(...dealPresentation(after).map(value => ({ ...value, title: '四家不叫，重新发牌' })));
  } else if (command.kind === 'trump') {
    const trumpGame = { ...before, trump: command.trump };
    const cards = privateVisible ? [...before.kitty] : [];
    const hidden = privateVisible ? 0 : before.kitty.length;
    const labels = privateVisible ? cards.map(cardLabel).join('、') : '牌面仅庄家可见';
    steps.push(step('trump', `${name}定主 ${SUIT_NAME[command.trump]}`, '主牌已确定，接下来翻看底牌。', trumpGame, [], seat));
    steps.push(step('kittyReveal', `${name}翻开 ${before.kitty.length} 张底牌`, labels, trumpGame, cards, seat, hidden));
    steps.push(step('kittyPickup', `${name}起底，底牌入手`, `${labels}；手牌 ${before.hands[seat].length} → ${after.hands[seat].length} 张。`, after, cards, seat, hidden));
  } else if (command.kind === 'bury') {
    steps.push(step('bury', `${name}扣回 ${command.cards.length} 张底牌`, `${privateVisible ? command.cards.map(cardLabel).join('、') : '牌面仅庄家可见'}；手牌 ${before.hands[seat].length} → ${after.hands[seat].length} 张，底牌盖好。`, before, privateVisible ? [...command.cards] : [], seat, privateVisible ? 0 : command.cards.length));
    const partner = revealedPartnerSeat(after);
    if (partner !== null) steps.push(step('partnerReveal', `${SEAT_NAMES[partner]}家搭档明牌`, '叫满 100 分且已成功扣底，搭档剩余手牌现在向所有人公开。', after, [...after.hands[partner]], partner));
  } else if (command.kind === 'play') {
    // 第四张牌不能被规则层的同步收墩吞掉，先呈现四张齐备且尚未入账的画面。
    const tableCards = [...before.trick, { seat, card: command.card }];
    const playedGame = { ...before, hands: after.hands, trick: tableCards };
    const follow = before.trick.length === 0 ? '领出' : command.card.suit === before.trick[0].card.suit ? '跟牌'
      : command.card.suit === before.trump ? '主牌杀入' : '垫牌';
    steps.push(step('play', `${name}${follow} ${cardLabel(command.card)}`, `第 ${before.trickNumber} 墩 · 第 ${tableCards.length}/4 张牌`, playedGame, [command.card], seat));
    if (tableCards.length === 4) {
      const winner = after.lastWinner!;
      const collectedGame = { ...playedGame, trick: [], lastTrick: tableCards, lastWinner: winner, lastPoints: after.lastPoints, leader: winner };
      steps.push(step('collect', `${SEAT_NAMES[winner]}家收墩`, `四张牌收归${SEAT_NAMES[winner]}家，本墩 ${after.lastPoints} 分。`, collectedGame, tableCards.map(value => value.card), winner));
      const scoredGame = { ...after, phase: 'playing' as const, result: null, scores: before.scores };
      steps.push(step('score', `${SIDE_NAMES[sideOf(winner)]} +${after.lastPoints} 分`, `庄方 ${before.declarerTrickPoints} → ${after.declarerTrickPoints} 分；闲方 ${before.defenderTrickPoints} → ${after.defenderTrickPoints} 分。`, scoredGame, [], winner));
      if (after.result) steps.push(step('result', `${SIDE_NAMES[after.result.winnerSide]}赢得本副`, `庄方 ${after.result.declarerPoints} 分，闲方 ${after.result.defenderPoints} 分；${after.phase === 'matchEnd' ? '整场比赛结束。' : '本副结束，可回看或进入下一副。'}`, after));
    }
  }
  return numbered(steps);
}
