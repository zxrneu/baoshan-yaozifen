// @vitest-environment happy-dom
/** 启动节奏回归：真实会话初始暂停，运行需明确启动，切换视图不自动执行 AI。 */
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { Storage } from 'happy-dom';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { useGame, type GameController } from '@yaozifen/web/hooks/useGame';
import { DecisionEngineManager } from '@yaozifen/ai-core/engines/index';
import { offlineProfiles } from '@yaozifen/ai-core/engines/profileClient';
import { currentSeat, legalBids, type GameState } from '@yaozifen/game-core';
import { soundManager } from '@yaozifen/web/audio/soundManager';

let host: HTMLDivElement; let root: Root; let controller: GameController;
beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  vi.stubGlobal('localStorage', new Storage());
  vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('启动测试显式离线'); }));
  vi.useFakeTimers(); soundManager.setMuted(true);
  Object.defineProperty(window, '__TAURI_INTERNALS__', {configurable:true, value:{}});
  host = document.createElement('div'); document.body.append(host); root = createRoot(host);
});
afterEach(async () => { await act(async () => root.unmount()); host.remove(); Reflect.deleteProperty(window, '__TAURI_INTERNALS__'); vi.useRealTimers(); vi.unstubAllGlobals(); });
async function mount(debug = false, singleHand = false) {
  localStorage.setItem('baoshan_debug_mode', String(debug));
  const manager = new DecisionEngineManager({useServerDecision:false});
  manager.setProfiles(offlineProfiles()); manager.assignSeat(1, manager.getProfiles()[0].profileId);
  const nextAction = vi.fn((game: GameState) => game.phase === 'bidding'
    ? {kind:'bid' as const,seat:currentSeat(game),bid:legalBids(game)[0] ?? null} : null);
  const agent = {nextAction};
  function Harness() { controller = useGame({engineManager:manager, singleHand, agents:{0:agent,1:agent,2:agent,3:agent}}); return null; }
  await act(async () => root.render(React.createElement(Harness)));
  return nextAction;
}
it.each([[false,false], [true,false], [false,true]])('普通、Debug 和练习打开均先暂停（debug=%s，练习=%s）', async (debug, singleHand) => {
  const evaluate = await mount(debug, singleHand);
  const node = controller.sessionCursor.nodeId;
  expect(controller.sessionMode).toBe('paused');
  await act(async () => { await vi.advanceTimersByTimeAsync(6000); });
  expect(controller.sessionMode).toBe('paused');
  expect(controller.sessionCursor.nodeId).toBe(node);
  expect(evaluate).not.toHaveBeenCalled();
  await act(async () => controller.setIsStepMode(false));
  await act(async () => { await vi.advanceTimersByTimeAsync(2200); });
  await act(async () => { await vi.advanceTimersByTimeAsync(700); });
  expect(controller.sessionMode).toBe('auto');
  expect(controller.sessionCursor.nodeId).not.toBe(node);
  await act(async () => controller.pause());
  const paused = controller.sessionCursor.nodeId;
  await act(async () => { await vi.advanceTimersByTimeAsync(6000); });
  expect(controller.sessionMode).toBe('paused');
  expect(controller.sessionCursor.nodeId).toBe(paused);
});
it.each(['退出 Debug', '进入观战'] as const)('%s 只切换界面，等待开始按钮', async action => {
  const evaluate = await mount(true);
  const node = controller.sessionCursor.nodeId;
  await act(async () => action === '退出 Debug' ? controller.setIsDebugMode(false) : controller.startSpectating());
  await act(async () => { await vi.advanceTimersByTimeAsync(6000); });
  expect(controller.sessionMode).toBe('paused');
  expect(controller.sessionCursor.nodeId).toBe(node);
  expect(evaluate).not.toHaveBeenCalled();
});
it('暂停时人工叫分或重开不会隐式开启自动对局', async () => {
  await mount(false);
  await act(async () => { controller.pause(); controller.engineManager.assignSeat(1, 'human'); });
  while (controller.presentation) await act(async () => controller.advancePresentation());
  await act(async () => controller.doBid(70));
  expect(controller.game.highestBid).toBe(70);
  expect(controller.sessionMode).toBe('paused');
  await act(async () => controller.restart(42));
  expect(controller.sessionMode).toBe('paused');
});
