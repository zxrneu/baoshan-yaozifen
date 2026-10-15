// @vitest-environment happy-dom
/** 玩家指引回归（SRP）：真实页面验证暂停后下一步、接管含义与误触快捷键边界。 */
import React from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Storage } from 'happy-dom';
import { actAndLoad as act } from './helpers/lazyViews';
import type { GameController } from '@yaozifen/web/hooks/useGame';
import { createGame } from '@yaozifen/game-core';
import { defaultEngineManager } from '@yaozifen/ai-core/engines/index';
import { soundManager } from '@yaozifen/web/audio/soundManager';

const overrides = vi.hoisted(() => ({ value: {} as Partial<GameController> }));
vi.mock('@yaozifen/web/hooks/useGame', async importOriginal => {
  const actual = await importOriginal<typeof import('@yaozifen/web/hooks/useGame')>();
  return { ...actual, useGame: () => ({ ...actual.useGame(), ...overrides.value }) };
});
import App from '@yaozifen/web/App';

let host: HTMLDivElement;
let root: Root;
beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  vi.stubGlobal('localStorage', new Storage());
  vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('玩家指引测试显式离线'); }));
  defaultEngineManager.setUseServerDecision(false);
  defaultEngineManager.setActiveType('bridge');
  soundManager.setMuted(true);
  overrides.value = { presentation: null, isDebugMode: false, isSpectating: false,
    saveState: { status: 'unsupported', pending: 0 }, sessionMode: 'paused' };
  host = document.createElement('div'); document.body.append(host); root = createRoot(host);
});
afterEach(async () => {
  await act(async () => root.unmount()); host.remove();
  vi.restoreAllMocks(); vi.unstubAllGlobals();
});
async function render() { await act(async () => root.render(React.createElement(App))); }

describe('专家评审后的玩家指引', () => {
  it.each(['bidding', 'trump', 'bury', 'playing'] as const)('普通局 %s 暂停在其他玩家时，就地说明点击开始且不自行推进', async phase => {
    const game = createGame(42); game.phase = phase; game.declarer = 0; game.trump = 'S';
    const start = vi.fn();
    Object.assign(overrides.value, { game, seat: 0, humanSeat: 1, humanTurn: false, setIsStepMode: start });
    await render();
    const actions = host.querySelector('[aria-label="对局操作"]')!;
    expect(actions.textContent).toMatch(/已暂停.*开始.*东家/);
    expect(start).not.toHaveBeenCalled();
    await act(async () => host.querySelector<HTMLButtonElement>('[aria-label="对局运行控制"] button')!.click());
    expect(start).toHaveBeenCalledWith(false);
    overrides.value.sessionMode = 'auto'; await render();
    expect(actions.textContent).not.toContain('已暂停');
  });

  it('保存失败时提示先重试保存，不引导点击已禁用的开始', async () => {
    const game = createGame(42);
    Object.assign(overrides.value, { game, seat: 0, humanSeat: 1, humanTurn: false,
      saveState: { status: 'error', pending: 1, error: '评审注入保存失败' } });
    await render();
    expect(host.querySelector('[aria-label="对局操作"]')?.textContent).toMatch(/保存失败.*重试保存/);
    expect(host.querySelector<HTMLButtonElement>('[aria-label="对局运行控制"] button')?.disabled).toBe(true);
  });

  it('接管入口在操作前明确公开手牌并启动当前局的观战模式', async () => {
    const start = vi.fn(); overrides.value.startSpectating = start;
    await render();
    const entry = [...host.querySelectorAll('button')].find(button => /AI.*接管本局.*公开手牌/.test(button.textContent ?? ''));
    expect(entry).toBeDefined();
    await act(async () => entry!.click());
    expect(start).toHaveBeenCalledOnce();
  });

  it.each(['r', 'R'])('Debug 页面背景按 %s 不重开，显式重开入口仍保留', async key => {
    const restart = vi.fn(); overrides.value = { ...overrides.value, isDebugMode: true, restart };
    await render();
    await act(async () => window.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true })));
    expect(restart).not.toHaveBeenCalled();
    const explicit = [...host.querySelectorAll('button')].find(button => button.textContent?.trim() === '重开此副');
    expect(explicit).toBeDefined();
    await act(async () => explicit!.click());
    expect(restart).toHaveBeenCalledOnce();
  });
});
