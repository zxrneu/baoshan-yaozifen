// @vitest-environment happy-dom
/** 图形化战况和工具栏回归：验证可见状态、无障碍名称及操作，不读取暗牌。 */
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import HandScoreboard from '../src/components/HandScoreboard';
import GameTools from '../src/components/GameTools';
import { createGame } from '../src/engine';

let host: HTMLDivElement;
let root: Root;
beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  host = document.createElement('div'); document.body.append(host); root = createRoot(host);
});
afterEach(async () => { await act(async () => root.unmount()); host.remove(); vi.unstubAllGlobals(); });

it('主牌以带名称的花色图形展示，未定主时不编造花色', async () => {
  const game = createGame(42);
  await act(async () => root.render(React.createElement(HandScoreboard, { game, humanSeat: 1 })));
  expect(host.querySelector('[role="img"][aria-label="等待定主"]')).not.toBeNull();
  expect(host.querySelector('[role="img"][aria-label^="主牌："]')).toBeNull();
  game.phase = 'playing'; game.declarer = 0; game.highestBid = 85; game.trump = 'H';
  await act(async () => root.render(React.createElement(HandScoreboard, { game, humanSeat: 1 })));
  const trump = host.querySelector('[role="img"][aria-label="主牌：红桃"]');
  expect(trump).not.toBeNull();
  expect(trump?.querySelector('svg[aria-hidden="true"]')).not.toBeNull();
  expect(host.querySelector('[aria-label="闲家锁定进度"]')?.getAttribute('aria-valuemax')).toBe('20');
});

it('图标工具保留文字和操作入口，出牌确认同时表达设置及调试强制状态', async () => {
  const history = vi.fn(); const toggle = vi.fn(); const speed = vi.fn();
  const props = {
    phase: 'playing' as const, completedTricks: 3, speed: 'normal' as const,
    confirmBeforePlay: false, isConfirmForced: true, onToggleConfirmBeforePlay: toggle,
    onSpeedChange: speed, onOpenHistory: history, onOpenLedger: vi.fn(),
    onOpenLastTrick: vi.fn(), onOpenRules: vi.fn(), onOpenSettings: vi.fn(),
  };
  await act(async () => root.render(React.createElement(GameTools, props)));
  const buttons = [...host.querySelectorAll<HTMLButtonElement>('button')];
  for (const button of buttons) {
    expect(button.textContent?.trim()).not.toBe('');
    expect(button.querySelector('svg[aria-hidden="true"]')).not.toBeNull();
  }
  const confirm = host.querySelector<HTMLButtonElement>('[aria-label^="出牌二次确认设置"]')!;
  expect(confirm.getAttribute('aria-pressed')).toBe('false');
  expect(confirm.textContent).toContain('调试强制');
  await act(async () => buttons.find(button => button.textContent?.includes('出牌记录'))!.click());
  await act(async () => host.querySelector<HTMLButtonElement>('[aria-label^="对局速度"]')!.click());
  await act(async () => confirm.click());
  expect(history).toHaveBeenCalledOnce(); expect(speed).toHaveBeenCalledWith('slow'); expect(toggle).toHaveBeenCalledOnce();
});
