/** 同步降级行为回归：对公开吃分机会进行评估，且结果不受其他座位暗牌影响。 */
import { expect, it } from 'vitest';
import { makeCard } from '../src/cards';
import { createGame } from '../src/engine';
import { EnginePlayerAgent } from '../src/ai/engines/engineAdapter';

function game() {
  const state = createGame(2026);
  state.phase = 'playing'; state.leader = 0; state.declarer = 0; state.highestBid = 70; state.trump = 'H';
  state.trick = [{ seat: 0, card: makeCard('S', '10') }, { seat: 1, card: makeCard('S', '3') }, { seat: 2, card: makeCard('S', '4') }];
  state.hands[3] = [makeCard('S', '2'), makeCard('S', 'A')];
  return state;
}
it('第四家同步降级用 A 赢下对手分牌，不能直接出候选列表第一张 2', () => {
  const action = new EnginePlayerAgent().nextAction(game());
  expect(action).toEqual({ kind: 'play', seat: 3, card: makeCard('S', 'A') });
});
it('同步降级只使用合法阶段观察，替换其他座位暗牌、未知底牌和 seed 不影响选择', () => {
  const first = game(); const second = game();
  second.seed = 9999;
  second.hands[0] = second.hands[0].map(() => makeCard('D', 'A'));
  second.hands[1] = second.hands[1].map(() => makeCard('D', '2'));
  second.hands[2] = second.hands[2].map(() => makeCard('H', 'A'));
  second.kitty = second.kitty.map(() => makeCard('C', '5'));
  const agent = new EnginePlayerAgent();
  expect(agent.nextAction(first)).toEqual({ kind: 'play', seat: 3, card: makeCard('S', 'A') });
  expect(agent.nextAction(second)).toEqual(agent.nextAction(first));
});
it('同步降级必须跟门，不能用其他花色的高牌代替合法小牌', () => {
  const state = game(); state.hands[3] = [makeCard('S', '2'), makeCard('H', 'A')];
  expect(new EnginePlayerAgent().nextAction(state)).toEqual({ kind: 'play', seat: 3, card: makeCard('S', '2') });
});
it('同步降级没有合法牌时返回空动作，不进入策略异常路径', () => {
  const state = game(); state.hands[3] = [];
  expect(new EnginePlayerAgent().nextAction(state)).toBeNull();
});
