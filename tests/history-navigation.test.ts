// @vitest-environment happy-dom
/** 历史导航回归（SRP）：逐层进入、返回定位、失败重试和迟到请求隔离。 */
import { afterEach, expect, it, vi } from 'vitest';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import GameHistoryModal from '../src/components/GameHistoryModal';
import { HistoryClient } from '../src/history/client';
import { createGame } from '../src/engine';
import type { HandDetail } from '../src/history/transport';

let cleanup: (() => Promise<void>) | undefined;
afterEach(async () => { await cleanup?.(); vi.unstubAllGlobals(); });
async function mount() {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  const match: HandDetail['match'] = { matchId:'saved', startedAt:1, endedAt:null, status:'in_progress', source:'human', targetWins:5, ruleSetId:'basic-v1', ruleVersion:1, appVersion:'test', implementationVersion:'test' };
  const hand: HandDetail['hand'] = { handId:'hand', matchId:'saved', handIndex:0, startedAt:1, endedAt:null, unplayedPoints:null, result:null, declarer:null, bid:null, trump:null, startSnapshot:createGame(731) };
  const detail: HandDetail = { match, hand, branches:[{branchId:'actual', handId:'hand', kind:'actual', sourceNodeId:null, tipNodeId:null, name:'实际对局', createdAt:1}], nodes:[], evaluations:[], assignments:[], profiles:[] };
  const client = new HistoryClient();
  const matches = vi.spyOn(client,'matches').mockImplementation(async query => query?.offset ? [match] : Array.from({length:20}, (_,index)=>({...match,matchId:`match-${index}`})));
  const hands = vi.spyOn(client,'hands').mockResolvedValue([hand]);
  const details = vi.spyOn(client,'detail').mockResolvedValue(detail);
  const host = document.createElement('div'); document.body.append(host); const root = createRoot(host);
  cleanup = async () => { await act(async () => root.unmount()); host.remove(); };
  await act(async () => root.render(React.createElement(GameHistoryModal,{client,onClose:vi.fn(),onResume:vi.fn()})));
  const button = (name:string) => [...host.querySelectorAll('button')].find(value=>value.textContent?.trim()===name);
  const click = async (name:string) => { expect(button(name),name).toBeDefined(); await act(async()=>button(name)!.click()); };
  return {host,client,matches,hands,details,button,click};
}

it('查看副牌和详情切换到独立页面并聚焦，返回保留页码和滚动位置', async () => {
  const {host,click,button,matches} = await mount();
  await click('下一页');
  const body = host.querySelector<HTMLElement>('[aria-label="历史内容"]'); expect(body).not.toBeNull();
  body!.scrollTop=240;
  await click('查看副牌');
  expect(button('查看副牌')).toBeUndefined();
  expect(document.activeElement?.textContent).toBe('副牌列表');
  expect(body!.scrollTop).toBe(0);
  await click('查看详情');
  expect(button('查看详情')).toBeUndefined();
  expect(document.activeElement?.textContent).toBe('第 1 副详情');
  await click('返回副牌列表'); expect(button('查看详情')).toBeDefined();
  await click('返回对局列表');
  expect(host.textContent).toContain('第 2 页'); expect(body!.scrollTop).toBe(240);
  expect(document.activeElement).toBe(button('查看副牌')); expect(matches).toHaveBeenCalledTimes(2);
});

it('进入后立即显示目标页加载提示，失败可重试且不混入旧详情', async () => {
  const {host,hands,click,button} = await mount(); let reject!: (cause:Error)=>void;
  hands.mockImplementationOnce(()=>new Promise((_,fail)=>{reject=fail;}));
  await click('查看副牌');
  expect(host.textContent).toContain('正在加载副牌'); expect(button('查看副牌')).toBeUndefined();
  await act(async()=>reject(new Error('显式请求失败')));
  expect(host.querySelector('[role="alert"]')?.textContent).toContain('副牌列表加载失败');
  await click('重试加载'); expect(button('查看详情')).toBeDefined();
});

it('返回列表后迟到的副牌响应不会重新打开已离开的页面', async () => {
  const {host,hands,click,button} = await mount(); let release!: (value:Awaited<ReturnType<HistoryClient['hands']>>)=>void;
  hands.mockImplementationOnce(()=>new Promise(resolve=>{release=resolve;}));
  await click('查看副牌'); await click('返回对局列表');
  await act(async()=>release([]));
  expect(button('查看副牌')).toBeDefined(); expect(host.textContent).not.toContain('副牌列表');
});

it('详情加载失败可以在当前副牌页重试，空副牌明确显示提示', async () => {
  const {host,details,hands,click} = await mount();
  await click('查看副牌'); details.mockRejectedValueOnce(new Error('显式详情失败'));
  await click('查看详情'); expect(host.querySelector('[role="alert"]')).not.toBeNull();
  await click('重试加载'); expect(host.textContent).toContain('第 1 副详情');
  await click('返回副牌列表'); await click('返回对局列表'); hands.mockResolvedValueOnce([]);
  await click('查看副牌'); expect(host.textContent).toContain('这场对局还没有保存的副牌');
});
