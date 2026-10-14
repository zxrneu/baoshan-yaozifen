// @vitest-environment happy-dom
/** 阶段操作回归：验证可观察提示与确认行为，避免把统计误称为 AI 推荐。 */
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import ControlPanel from '../src/components/ControlPanel';
let host: HTMLDivElement; let root: Root;
beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  host = document.createElement('div'); document.body.append(host); root = createRoot(host);
});
afterEach(async () => { await act(async () => root.unmount()); host.remove(); vi.unstubAllGlobals(); });
function props(): React.ComponentProps<typeof ControlPanel> {
  return { seat: 1, humanSeat: 1, phase: 'playing', highestBid: 85, bidOptions: [90,95,100], kittySize: 4,
    selected: [], humanHand: [{ suit: 'S', rank: 'K' }, { suit: 'H', rank: 'A' }], selectedPlayCard: null,
    trick: [{ seat: 0, card: { suit: 'S', rank: 'Q' } }], result: null, confirmBeforePlay: true,
    doBid: vi.fn(), doTrump: vi.fn(), doBury: vi.fn(), autoSelectBury: vi.fn(), clearSelectedBury: vi.fn(),
    confirmPlayCard: vi.fn(), goNextHand: vi.fn(), restart: vi.fn() };
}
async function render(p: React.ComponentProps<typeof ControlPanel>) { await act(async () => root.render(React.createElement(ControlPanel, p))); }
describe('阶段操作栏', () => {
  it('出牌前明确必须跟的花色，选牌后主按钮显示该张牌并且只确认一次', async () => {
    const p = props(); await render(p);
    expect(host.textContent).toContain('须跟黑桃♠');
    const empty = [...host.querySelectorAll('button')].find(b => b.textContent === '选择一张牌'); expect(empty?.disabled).toBe(true);
    p.selectedPlayCard = p.humanHand[0]; await render(p);
    const confirm = [...host.querySelectorAll('button')].find(b => b.textContent === '出牌 K♠'); expect(confirm?.className).toContain('primary-btn');
    await act(async () => confirm!.click()); expect(p.confirmPlayCard).toHaveBeenCalledOnce();
  });
  it('缺领出花色时提示可出任意牌，不要求不存在的同门牌', async () => {
    const p = props(); p.humanHand = [{ suit: 'H', rank: 'A' }]; await render(p);
    expect(host.textContent).toContain('缺黑桃♠ · 可出任意牌');
    expect(host.textContent).not.toContain('须跟');
  });
  it('关闭确认后显式提示点牌即出，并移除确认按钮', async () => {
    const p = props(); p.confirmBeforePlay = false; await render(p);
    expect(host.textContent).toContain('点牌即出'); expect(host.querySelectorAll('button')).toHaveLength(0);
  });
  it('定主的最长花色只标注张数最多，不将花色统计称为推荐', async () => {
    const p = props(); p.phase = 'trump'; p.humanHand.push({ suit: 'S', rank: '2' }); await render(p);
    expect(host.textContent).toContain('张数最多'); expect(host.textContent).not.toContain('推荐');
    expect(host.textContent).toContain('2张·0分');
  });
  it('扣底未选满时保持禁用，满四张后确认按钮生效并支持清空', async () => {
    const p = props(); p.phase = 'bury'; await render(p);
    expect(host.querySelector<HTMLButtonElement>('.primary-btn')?.disabled).toBe(true);
    p.selected = ['K', 'Q', 'J', '2'].map(rank => ({ rank: rank as 'K'|'Q'|'J'|'2', suit: 'S' })); await render(p);
    expect(host.querySelector<HTMLButtonElement>('.primary-btn')?.disabled).toBe(false);
    await act(async () => [...host.querySelectorAll('button')].find(b => b.textContent === '清空')!.click());
    expect(p.clearSelectedBury).toHaveBeenCalledOnce();
  });
});
