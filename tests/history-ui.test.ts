// @vitest-environment happy-dom
/** 历史界面回归（SRP）：分页筛选、详情、校验导出和恢复必须可以由玩家操作。 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import React from 'react';
import { actAndLoad as act } from './helpers/lazyViews';
import { createRoot } from 'react-dom/client';
import App from '../src/App';
import { defaultEngineManager } from '../src/ai/engines';
import { Storage } from 'happy-dom';
import { createGame } from '../src/engine';
import { wireSnapshot } from '../src/history/transport';
import { contentDigest } from '../src/history/json';

let clean: (() => Promise<void>) | undefined;
afterEach(async () => { await clean?.(); vi.unstubAllGlobals(); });
describe('完整牌桌历史入口', () => {
  it('Tauri 无服务离线模式明确显示不支持历史，保留原有游戏控制', async () => {
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT',true); const storage=new Storage(); storage.setItem('baoshan_debug_mode','true'); vi.stubGlobal('localStorage',storage);
    Reflect.set(window,'__TAURI_INTERNALS__',{}); const oldMode=defaultEngineManager.isUseServerDecision(); defaultEngineManager.setUseServerDecision(false);
    const fetcher=vi.fn(async()=>{throw new Error('显式离线故障');});vi.stubGlobal('fetch',fetcher);
    const host=document.createElement('div');document.body.append(host);const root=createRoot(host);
    clean=async()=>{await act(async()=>root.unmount());host.remove();Reflect.deleteProperty(window,'__TAURI_INTERNALS__');defaultEngineManager.setUseServerDecision(oldMode);};
    await act(async()=>root.render(React.createElement(App)));
    expect(host.textContent).toContain('离线模式暂不支持历史');expect(fetcher).not.toHaveBeenCalled();
    expect([...host.querySelectorAll('button')].some(button=>button.textContent?.trim() === '继续动作展示 (Space)')).toBe(true);
    expect(host.querySelector('section[aria-label="沙盒工具"]')).not.toBeNull();
    expect([...host.querySelectorAll('button')].some(button=>button.textContent?.trim() === '开始')).toBe(true);
  });
  it('严格模式的 effect 重挂不会重复创建对局或并发消费待保存队列', async () => {
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true); const storage=new Storage(); storage.setItem('baoshan_debug_mode','true'); vi.stubGlobal('localStorage',storage);
    const starts: string[]=[];
    vi.stubGlobal('fetch',vi.fn(async (_url: string, init?:RequestInit)=>{ const packet=JSON.parse(String(init?.body ?? '{}')); if(packet.match) starts.push(packet.match.matchId); return new Response(JSON.stringify({saved:true}),{status:200}); }));
    const host=document.createElement('div'); document.body.append(host); const root=createRoot(host);
    clean=async()=>{await act(async()=>root.unmount());host.remove();};
    await act(async()=>root.render(React.createElement(React.StrictMode,null,React.createElement(App))));
    expect(new Set(starts).size).toBe(1); expect(host.textContent).toContain('已保存');
  });
  it('显示保存状态与历史列表，能筛选、查看起点详情并暂停恢复', async () => {
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true); const storage = new Storage(); storage.setItem('baoshan_debug_mode','true'); vi.stubGlobal('localStorage', storage);
    const match = { matchId: 'old', startedAt: 1, endedAt: null, status: 'in_progress', source: 'human', targetWins: 5, ruleSetId: 'basic-v1', ruleVersion: 1 };
    const hand = { handId: 'hand', matchId: 'old', handIndex: 0, startedAt: 1, result: null, declarer: null, bid: null, trump: null, startSnapshot: wireSnapshot(createGame(731)) };
    const data = { match, hand, branches: [{ branchId:'branch', handId:'hand', kind:'actual', sourceNodeId:null, tipNodeId:null }], nodes:[], evaluations:[], assignments:[], profiles:[] };
    const requests: string[] = [];
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      requests.push(url);
      const body = url.includes('/write') ? { saved: true } : url.includes('/hands/hand') ? { format:'game-history', protocolVersion:2, data, digest:contentDigest(data) }
        : url.includes('/old/hands') ? [hand] : [match];
      return new Response(JSON.stringify(body), { status:200 });
    }));
    const host = document.createElement('div'); document.body.append(host); const root = createRoot(host);
    clean = async () => { await act(async () => root.unmount()); host.remove(); };
    await act(async () => root.render(React.createElement(App)));
    expect(host.textContent).toContain('已保存');
    const button = (name: string) => [...host.querySelectorAll('button')].find(value => value.textContent?.trim() === name);
    expect(button('对局历史')).toBeDefined();
    await act(async () => button('对局历史')?.click());
    expect(host.querySelector('[role="dialog"][aria-label="对局历史"]')).not.toBeNull();
    await act(async () => button('查看副牌')?.click());
    await act(async () => button('查看详情')?.click());
    expect(host.textContent).toContain('已保存动作：0');
    expect(button('导出校验文件')).toBeDefined();
    await act(async () => button('恢复未结束副牌')?.click());
    expect(host.textContent).toContain('已恢复，当前暂停');
    expect(requests.some(url => url.includes('/api/history/matches?'))).toBe(true);
  });
});
