// @vitest-environment happy-dom
/** 界面行为回归：验证键盘弹窗、只读卡牌和可见信息，不依赖外部服务。 */
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import Modal from '../src/components/Modal';
import RulesModal from '../src/components/RulesModal';
import LastTrickModal from '../src/components/LastTrickModal';
import KittyRevealBanner from '../src/components/KittyRevealBanner';
import HandResultModal from '../src/components/HandResultModal';
import PlayHistoryModal from '../src/components/PlayHistoryModal';
import PointsTrackerModal from '../src/components/PointsTrackerModal';
import CardView from '../src/CardView';
import OpponentSeat from '../src/components/OpponentSeat';
import revealedStyles from '../src/components/RevealedHand.module.css';
import SkinPicker from '../src/components/SkinPicker';
import { createGame } from '../src/engine';
import { makeCard } from '../src/cards';
let host: HTMLDivElement; let root: Root; let trigger: HTMLButtonElement;
beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  trigger = document.createElement('button'); document.body.append(trigger); trigger.focus();
  host = document.createElement('div'); document.body.append(host); root = createRoot(host);
});
afterEach(async () => { await act(async () => root.unmount()); host.remove(); trigger.remove(); vi.unstubAllGlobals(); });
async function render(element: React.ReactNode) { await act(async () => root.render(element)); }
async function key(key: string, shiftKey = false) {
  await act(async () => { document.activeElement?.dispatchEvent(new KeyboardEvent('keydown', { key, shiftKey, bubbles: true, cancelable: true })); });
}
describe('弹窗的键盘与焦点', () => {
  it('多个弹窗共用背景时，关闭任一层不会提前恢复背景输入', async () => {
    const outside = document.createElement('button'); outside.inert = true; document.body.append(outside);
    const base = (first: boolean, second: boolean) => React.createElement('div', null,
      React.createElement('button', {'aria-label':'牌桌背景'}, '出牌'),
      first && React.createElement(Modal,{label:'第一层',children:React.createElement('button',null,'第一层关闭')}),
      second && React.createElement(Modal,{label:'第二层',children:React.createElement('button',null,'第二层关闭')}));
    try {
      await render(base(true,false)); const background = host.querySelector('[aria-label="牌桌背景"]')!;
      expect(background.closest('[inert]')).not.toBeNull();
      await render(base(true,true));
      expect(host.querySelector('[aria-label="第二层"]')?.closest('[inert]')).toBeNull();
      await render(base(false,true)); expect(background.closest('[inert]')).not.toBeNull();
      await render(base(false,false)); expect(background.closest('[inert]')).toBeNull();
      expect(outside.inert).toBe(true);
    } finally { outside.remove(); }
  });
  it('皮肤弹窗位于游戏区域的普通模态层，支持旋转及 Escape', async () => {
    await render(React.createElement(SkinPicker,{skin:'classic',onChange:()=>{}}));
    await act(async()=>{ host.querySelector<HTMLButtonElement>('button')!.click(); });
    const dialog=host.querySelector('[role="dialog"]'); expect(dialog).not.toBeNull();
    expect(host.querySelector('dialog')).toBeNull();
    await key('Escape'); expect(host.querySelector('[role="dialog"]')).toBeNull();
  });
  it('规则弹窗有名称、模态语义，打开后焦点进入并循环，关闭返回入口', async () => {
    await render(React.createElement(RulesModal, { onClose: () => { root.render(null); } }));
    const dialog = host.querySelector('[role="dialog"]');
    expect(dialog).not.toBeNull(); expect(dialog?.getAttribute('aria-modal')).toBe('true');
    expect(dialog?.contains(document.activeElement)).toBe(true);
    const buttons = [...dialog!.querySelectorAll('button')];
    buttons.at(-1)!.focus(); await key('Tab'); expect(document.activeElement).toBe(buttons[0]);
    await key('Tab', true); expect(document.activeElement).toBe(buttons.at(-1));
    await key('Escape'); expect(host.querySelector('[role="dialog"]')).toBeNull(); expect(document.activeElement).toBe(trigger);
  });
  it('上一轮回看独立使用时也能按 Escape 关闭', async () => {
    const close = vi.fn(); await render(React.createElement(LastTrickModal,{lastTrick:[],lastWinner:null,lastPoints:0,onClose:close}));
    await key('Escape'); expect(close).toHaveBeenCalledOnce();
  });
  it('摸底提示支持 Escape 且不把按键传给牌桌', async () => {
    const close=vi.fn(); const background=vi.fn(); window.addEventListener('keydown',background);
    try {
      await render(React.createElement(KittyRevealBanner,{kittyCards:[makeCard('S','K')],onDismiss:close}));
      await key('Escape'); expect(close).toHaveBeenCalledOnce(); expect(background).not.toHaveBeenCalled();
    } finally { window.removeEventListener('keydown',background); }
  });
});
describe('牌桌文案与只读卡牌', () => {
  it('对手明牌的朝向使用显示位置，换座后不沿用绝对座位', async () => {
    await render(React.createElement(OpponentSeat,{seat:3,displaySeat:2,cardCount:1,isTurn:false,isDeclarer:false,isPartner:true,hasDeclarer:true,isTeammate:false,isRevealed:true,revealedCards:[makeCard('S','K')]}));
    expect(host.querySelector(`.${revealedStyles.left}`)).not.toBeNull();
  });
  it('允许透视的头像提供有名称的按钮和展开状态', async () => {
    const peek=vi.fn(); await render(React.createElement(OpponentSeat,{seat:0,cardCount:12,isTurn:false,isDeclarer:false,isPartner:false,hasDeclarer:false,isTeammate:false,onTogglePeek:peek}));
    const avatar=host.querySelector('button[aria-label="查看东家手牌"]'); expect(avatar).not.toBeNull();
    expect(avatar?.getAttribute('aria-expanded')).toBe('false');
    await act(async()=>{ (avatar as HTMLButtonElement).click(); }); expect(peek).toHaveBeenCalledOnce();
  });
  it('展示牌和明确不可操作的牌不进入 Tab 顺序，可操作牌仍能点击', async () => {
    const click=vi.fn(); await render(React.createElement('div',null,
      React.createElement(CardView,{card:makeCard('S','K')}),
      React.createElement(CardView,{card:makeCard('H','K'),playable:false}),
      React.createElement(CardView,{card:makeCard('C','K'),playable:true,onClick:click})));
    const buttons=[...host.querySelectorAll('button')];
    expect(buttons[0].disabled || buttons[0].tabIndex < 0).toBe(true);
    expect(buttons[1].disabled || buttons[1].tabIndex < 0).toBe(true);
    await act(async()=>buttons[2].click()); expect(click).toHaveBeenCalledOnce();
  });
  it('规则名称与游戏标题一致', async () => {
    await render(React.createElement(RulesModal,{onClose:()=>{}})); expect(host.textContent).toContain('保山幺子分 · 规则速查');
  });
  it('查分器正确显示十二张分牌', async () => {
    await render(React.createElement(PointsTrackerModal,{game:createGame(12),humanSeat:1,onClose:()=>{}}));
    expect(host.textContent).toContain('12 张分牌');
  });
  it('牌谱按实际观察座位标注你，不固定为南家', async () => {
    await render(React.createElement(PlayHistoryModal,{game:createGame(12),humanSeat:0,onClose:()=>{}}));
    expect(host.textContent).toContain('东（你）'); expect(host.textContent).not.toContain('南（你）');
  });
  it('结算按实际玩家所属队标记你，并提供回看入口', async () => {
    await render(React.createElement(HandResultModal,{
      result:{declarer:0,bid:70,trump:'S',declarerPoints:70,defenderPoints:30,buriedPoints:0,success:true,winnerSide:0},
      kitty:[],scores:[1,0],targetWins:5,matchEnded:false,humanSeat:0,goNextHand:()=>{},restart:()=>{},onClose:()=>{},
    }));
    expect(host.textContent).toContain('东西方（你）'); expect(host.textContent).not.toContain('南北方（你）');
    expect([...host.querySelectorAll('button')].some(button=>button.textContent?.includes('回看牌桌'))).toBe(true);
  });
});
