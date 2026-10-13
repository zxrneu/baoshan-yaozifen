// @vitest-environment happy-dom
/** 玩家视角呈现回归（SRP）：观察真实组件的朝向、头像位置、引擎标注与操作。 */
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, expect, it, vi } from 'vitest';
import { Storage } from 'happy-dom';
import SquareTable from '../src/components/SquareTable';
import ActionPresentation from '../src/components/ActionPresentation';
import SeatReasonModal from '../src/components/SeatReasonModal';
import { DecisionLogger } from '../src/ai/engines/decisionLogger';
import { createGame } from '../src/engine';

let cleanup: (() => Promise<void>) | undefined;
afterEach(async () => { await cleanup?.(); vi.unstubAllGlobals(); });
async function table(seat: number) {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  const storage = new Storage(); storage.setItem('yaozifen_card_orientation', 'viewer'); vi.stubGlobal('localStorage', storage);
  const game = createGame(42); game.phase = 'trump'; game.declarer = seat;
  const host = document.createElement('div'); document.body.append(host); const root = createRoot(host);
  cleanup = async () => { await act(async () => root.unmount()); host.remove(); };
  const doTrump = vi.fn(); const inspect = vi.fn(); const changeEngine = vi.fn();
  await act(async () => root.render(React.createElement(SquareTable, {
    game, seat, humanSeat: 1, isThinking: true,
    seatEngineLabels: ['桥牌 Bridge（DDS）', 'Human（人工）', '推演算法（Worker）', '大模型 LLM'],
    onInspectSeat: inspect, onChangeSeatEngine: changeEngine, selectedPlayCard: null, aiHintCard: null, selectedBuryCards: [], bidOptions: [70],
    onHumanCardClick: vi.fn(), onManualPlaySeat: vi.fn(), confirmPlayCard: vi.fn(), doBid: vi.fn(), doTrump,
    doBury: vi.fn(), autoSelectBury: vi.fn(), clearSelectedBury: vi.fn(), goNextHand: vi.fn(), restart: vi.fn(),
  })));
  return { host, doTrump, inspect, changeEngine };
}

it.each([[0, 'east', -90], [1, 'south', 0], [2, 'west', 90], [3, 'north', 180]] as const)('座位 %i 的定主选项始终朝向 %s，点击仍执行对应花色', async (seat, direction, angle) => {
  const { host, doTrump } = await table(seat);
  const controls = host.querySelector<HTMLElement>('[aria-label="当前玩家操作"]');
  expect(controls?.dataset.direction).toBe(direction);
  expect(controls?.style.transform).toBe(`rotate(${angle}deg)`);
  expect(host.querySelector('[aria-label="切换牌面朝向"]')).toBeNull();
  const spades = [...controls!.querySelectorAll('button')].find(button => button.textContent?.includes('黑桃'))!;
  await act(async () => spades.click()); expect(doTrump).toHaveBeenCalledWith('S');
});

it('四家头像统一并入桌沿信息条，信息条按座位旋转，保持手牌连续并可查看原因', async () => {
  const { host, inspect } = await table(0);
  const hands = host.querySelectorAll('[data-seat-hand]'); expect(hands).toHaveLength(4);
  for (const hand of hands) {
    expect(hand.children).toHaveLength(12);
    expect(hand.querySelector('button[aria-label$="决策原因"]')).toBeNull();
    const avatar = host.querySelector(`[data-seat-identity="${hand.getAttribute('data-seat-hand')}"]`);
    expect(avatar?.querySelector('button[aria-label$="决策原因"]')).not.toBeNull();
  }
  const east = host.querySelector('[data-seat-identity="0"]')!;
  for (const [seat, angle] of [[0,-90], [1,0], [2,90], [3,180]]) {
    const header = host.querySelector<HTMLElement>(`[data-seat-header="${seat}"]`)!;
    expect(header.contains(host.querySelector(`[data-seat-identity="${seat}"]`))).toBe(true);
    expect(header.style.transform).toBe(`rotate(${angle}deg)`);
  }
  expect(east.querySelector('[role="status"]')?.getAttribute('aria-label')).toBe('东家 · 定主 · 思考中');
  await act(async () => east.querySelector('button')!.click()); expect(inspect).toHaveBeenCalledWith(0);
  for (const label of ['桥牌 Bridge（DDS）', 'Human（人工）', '推演算法（Worker）', '大模型 LLM']) expect(host.textContent).toContain(label);
});

it('东家的动作展示也朝东，保留下一步操作', () => {
  const game = createGame(42); game.phase = 'trump'; game.declarer = 0; game.trump = 'S';
  const host = document.createElement('div');
  // 静态渲染便于直接观察动效内容的朝向，与牌桌布局共用座位坐标。
  const node = React.createElement(ActionPresentation, { action: { kind: 'trump', seat: 0, title: '东家定主', detail: '黑桃', cards: [], hiddenCount: 0, game, duration: 1200, index: 1, total: 3 }, automatic: false, viewSeat: 1, onNext: vi.fn(), onPause: vi.fn(), playerFacing: true });
  host.innerHTML = renderToStaticMarkup(node);
  expect(host.querySelector<HTMLElement>('[data-action-facing]')?.style.transform).toBe('rotate(-90deg)');
  expect(host.querySelector('[aria-label="继续展示下一步"]')).not.toBeNull();
});

it('紧凑理由弹窗同时展示结论和记录中的决策过程，仍有关闭入口', () => {
  const logger = new DecisionLogger();
  logger.record({ seat: 0, engineType: 'bridge', roundNumber: 1, trickNumber: 1, ownHand: [], currentRound: [], candidates: [], chosenCard: { suit: 'S', rank: 'K' }, latencyMs: 25, conclusion: '保留主牌。', thinking: '比较长门与主牌控制力后，选择领出黑桃 K。' });
  const html = renderToStaticMarkup(React.createElement(SeatReasonModal, { seat: 0, record: logger.getRecords()[0], onClose: vi.fn() }));
  expect(html).toContain('保留主牌。');
  expect(html).toContain('比较长门与主牌控制力后，选择领出黑桃 K。');
  expect(html).toContain('返回牌桌');
});


it('点击各家引擎名称打开对应座位的切换入口', async () => {
  const { host, changeEngine, inspect } = await table(0);
  for (const [seat, name] of ['东','南','西','北'].entries()) {
    const button = host.querySelector<HTMLButtonElement>(`button[aria-label="${name}家当前引擎"]`);
    expect(button).not.toBeNull();
    await act(async () => button!.click()); expect(changeEngine).toHaveBeenLastCalledWith(seat);
  }
  expect(inspect).not.toHaveBeenCalled();
});
