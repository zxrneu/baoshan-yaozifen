// @vitest-environment happy-dom
/** 真实牌桌的弹窗边界：查看信息暂停对局，背景不可操作，关闭后等待明确继续。 */
import React from 'react';
import { actAndLoad as act } from './helpers/lazyViews';
import { createRoot, type Root } from 'react-dom/client';
import { Storage } from 'happy-dom';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import App from '../src/App';
import { defaultEngineManager } from '../src/ai/engines';
import { soundManager } from '../src/audio/soundManager';

let host: HTMLDivElement; let root: Root;
beforeEach(async () => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  vi.stubGlobal('localStorage', new Storage());
  vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('弹窗交互审查显式离线'); }));
  Object.defineProperty(window, '__TAURI_INTERNALS__', {configurable:true, value:{}});
  defaultEngineManager.setUseServerDecision(false); soundManager.setMuted(true);
  host = document.createElement('div'); document.body.append(host); root = createRoot(host);
  await act(async () => root.render(React.createElement(App)));
  vi.useFakeTimers();
});
afterEach(async () => { await act(async () => root.unmount()); host.remove(); Reflect.deleteProperty(window, '__TAURI_INTERNALS__'); vi.useRealTimers(); vi.unstubAllGlobals(); });
function button(label: string) {
  const value = [...host.querySelectorAll<HTMLButtonElement>('button')].find(element => element.getAttribute('aria-label') === label || element.textContent?.trim() === label || (label === '出牌记录' && element.textContent?.startsWith(label)));
  expect(value, `应能找到 ${label}`).toBeDefined(); return value!;
}
it.each(['规则', '打开设置', '对局历史', '分牌盘点', '出牌记录', '换皮肤 经典棋牌'])('自动运行时打开%s，暂停并隔离背景；关闭后保持暂停', async entry => {
  await act(async () => button('开始').click());
  expect(button('暂停')).toBeDefined();
  await act(async () => button(entry).click());
  const dialog = host.querySelector<HTMLElement>('[role="dialog"]')!;
  expect(dialog).not.toBeNull();
  const run = host.querySelector('[aria-label="对局运行控制"]')!;
  expect(run.textContent).toBe('开始');
  expect(run.closest('[inert]')).not.toBeNull();
  const table = host.querySelector<HTMLElement>('[aria-label="对局牌桌"]')!;
  expect(table.closest('[inert]')).not.toBeNull();
  expect(dialog.closest('[inert]')).toBeNull();
  const before = table.textContent;
  await act(async () => vi.advanceTimersByTimeAsync(6000));
  expect(table.textContent).toBe(before);
  await act(async () => document.activeElement?.dispatchEvent(new KeyboardEvent('keydown', {key:'Escape',bubbles:true,cancelable:true})));
  expect(host.querySelector('[role="dialog"]')).toBeNull();
  expect(table.closest('[inert]')).toBeNull();
  expect(run.textContent).toBe('开始');
});
it('设置中切换 Debug 重建牌桌后，新牌桌仍隔离输入，方向提示保留可访问性', async () => {
  await act(async () => button('打开设置').click());
  await act(async () => button('🛠️ 开发者选项').click());
  await act(async () => button('🎮 开启调试模式').click());
  const table = host.querySelector('[aria-label="正方形上帝调试牌桌"]')!;
  expect(table).not.toBeNull();
  expect(table.closest('[inert]')).not.toBeNull();
  expect(host.querySelector('[role="dialog"]')?.closest('[inert]')).toBeNull();
  const notice = [...host.querySelectorAll<HTMLElement>('[role="status"]')].find(element => element.textContent?.includes('请横屏'))!;
  expect(notice).toBeDefined(); expect(notice.closest('[inert]')).toBeNull();
});
