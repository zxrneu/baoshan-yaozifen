// @vitest-environment happy-dom
/** 页面交互回归：复用真实编排，仅注入阶段和操作回调，以验证入口与快捷键边界。 */
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Storage } from 'happy-dom';
import type { useGame } from '../src/hooks/useGame';
import { createGame } from '../src/engine';
import { defaultEngineManager } from '../src/ai/engines';
import { soundManager } from '../src/audio/soundManager';
const overrides = vi.hoisted(() => ({ value: {} as Partial<ReturnType<typeof useGame>> }));
vi.mock('../src/hooks/useGame', async importOriginal => {
  const actual = await importOriginal<typeof import('../src/hooks/useGame')>();
  return { ...actual, useGame: () => ({ ...actual.useGame(), ...overrides.value }) };
});
import App from '../src/App';
let host: HTMLDivElement; let root: Root;
beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true); vi.stubGlobal('localStorage', new Storage());
  vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('页面回归显式离线'); }));
  defaultEngineManager.setUseServerDecision(false); defaultEngineManager.setActiveType('bridge'); soundManager.setMuted(true);
  overrides.value = { saveState: { status: 'unsupported', pending: 0 } };
  host = document.createElement('div'); document.body.append(host); root = createRoot(host);
});
afterEach(async () => { await act(async () => root.unmount()); host.remove(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });
async function render() { await act(async () => root.render(React.createElement(App))); }
function button(text: string) { return [...host.querySelectorAll('button')].find(button => button.textContent?.trim() === text); }
describe('牌桌操作与快捷键边界', () => {
  it('牌桌和弹窗位于同一横屏区域，可整体旋转而不重建对局', async () => {
    await render(); const surface=host.querySelector('[aria-label="横屏游戏区域"]'); expect(surface).not.toBeNull();
    expect(surface?.contains(host.querySelector('main'))).toBe(true);
    await act(async()=>{ [...host.querySelectorAll('button')].find(button=>button.textContent==='规则')!.click(); });
    expect(surface?.contains(host.querySelector('[aria-label="游戏规则"]'))).toBe(true);
  });
  it.each([[0, 'right'], [1, 'top'], [2, 'left']] as const)('一百分明牌随观察座位 %s 旋转到 %s，保留实际公开座位信息', async (humanSeat, position) => {
    const game=createGame(14); game.phase='playing'; game.declarer=1; game.highestBid=100; game.trump='S';
    overrides.value={...overrides.value,game,humanSeat}; await render();
    const table=host.querySelector('main');
    expect(table?.getAttribute('data-revealed-seat')).toBe('3');
    expect(table?.getAttribute('data-revealed-position')).toBe(position);
  });
  it('普通牌桌暂停时给出继续入口，不必进入开发者设置', async () => {
    const resume=vi.fn(); overrides.value={...overrides.value,sessionMode:'paused',humanTurn:false,setIsStepMode:resume};
    await render(); const action=button('继续对局'); expect(action).toBeDefined();
    await act(async()=>action!.click()); expect(resume).toHaveBeenCalledWith(false);
  });
  it('保存失败暂停时继续入口禁用，必须先恢复保存', async () => {
    overrides.value={...overrides.value,sessionMode:'paused',saveState:{status:'error',pending:1,error:'保存失败'}};
    await render(); expect(button('继续对局')?.disabled).toBe(true);
  });
  it('在对局日志摘要按空格只展开日志，不触发调试代走', async () => {
    const step=vi.fn(async()=>{}); overrides.value={...overrides.value,isDebugMode:true,stepNext:step};
    await render(); const summary=host.querySelector('summary')!; summary.focus();
    await act(async()=>{ summary.dispatchEvent(new KeyboardEvent('keydown',{key:' ',bubbles:true,cancelable:true})); });
    expect(step).not.toHaveBeenCalled();
  });
  it('结算可关闭回看，仍保留下一副入口且不会自动推进', async () => {
    const next=vi.fn(); const game=createGame(13); game.phase='handEnd';
    game.result={declarer:0,bid:70,trump:'S',declarerPoints:70,defenderPoints:30,buriedPoints:0,success:true,winnerSide:0};
    overrides.value={...overrides.value,game,isDebugMode:false,goNextHand:next}; await render();
    const review=button('回看牌桌'); expect(review).toBeDefined(); await act(async()=>review!.click());
    expect(host.querySelector('[aria-label="本副结算"]')).toBeNull(); expect(button('下一副')).toBeDefined(); expect(next).not.toHaveBeenCalled();
  });
});
