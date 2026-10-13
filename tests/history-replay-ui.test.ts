// @vitest-environment happy-dom
/** 复盘玩家入口回归（SRP）：真实存档中的动作可以只读逐步查看。 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import HistoryReplay from '../src/components/HistoryReplay';
import { replayFixture } from './fixtures/replay';
import { SIDE_NAMES } from '../src/engine';
import GameHistoryModal from '../src/components/GameHistoryModal';
import { HistoryClient } from '../src/history/client';
import { SqliteHistoryRepository } from '../server/history/sqliteRepository';
import { historyDetail } from '../server/history/http';
import { GameSession } from '../src/workbench/session';
import { HistoryRecorder } from '../src/history/autosave';
import { RemoteDecisionEngine } from '../src/ai/engines/remoteEngine';
import { observeDecision } from '../src/ai/decisionObservation';
import { createGame, currentSeat } from '../src/engine';

let cleanup: (() => Promise<void>) | undefined;
afterEach(async () => { await cleanup?.(); vi.unstubAllGlobals(); vi.restoreAllMocks(); vi.useRealTimers(); });
async function mount(diagnostics=false) {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  const repo = new SqliteHistoryRepository({ path: ':memory:' });
  const session = new GameSession(createGame(731));
  const recorder = new HistoryRecorder(session, { write: async packet => repo.writeHistory(packet), configuration: () => ({ profiles: [], seats: [] }) });
  for (let i = 0; i < 4; i++) session.commit({ kind:'bid', seat:currentSeat(session.getSnapshot().game), bid:i === 0 ? 70 : null }, session.getSnapshot().cursor);
  await recorder.flush();
  const match = repo.listMatches()[0]; const hand = repo.listHands(match.matchId)[0];
  if(diagnostics) {
    const branch=repo.listBranches(hand.handId)[0]; const first=repo.listActionNodes(branch.branchId)[0];
    const base={nodeId:`root:${branch.branchId}`,sessionId:'old',seat:1,phase:'bidding' as const,purpose:'hint' as const,observation:observeDecision(hand.startSnapshot,1),candidates:[],status:'evaluated' as const,latencyMs:25,createdAt:1};
    repo.recordEvaluation({...base,evaluationId:'suggestion',requestId:'hint',recommended:{action:{kind:'bid',seat:1,bid:75}}});
    repo.recordEvaluation({...base,evaluationId:'adopted',requestId:'step',recommended:{action:{kind:'bid',seat:1,bid:70}},fallbackReason:'显式测试回退'});
    repo.updateEvaluationStatus('adopted','applied',first.nodeId);
  }
  const client = new HistoryClient(); vi.spyOn(client, 'matches').mockResolvedValue([match]);
  vi.spyOn(client, 'hands').mockResolvedValue([hand]); vi.spyOn(client, 'detail').mockImplementation(async()=>historyDetail(repo,hand.handId));
  const write = vi.spyOn(client, 'write').mockImplementation(async packet => repo.writeHistory(packet));
  const resume = vi.fn(); const host = document.createElement('div'); document.body.append(host); const root = createRoot(host);
  cleanup = async () => { await act(async () => root.unmount()); host.remove(); recorder.dispose(); repo.close(); };
  await act(async () => root.render(React.createElement(GameHistoryModal, { onClose:vi.fn(), onResume:resume, client })));
  const click = async (name: string) => { const button = [...host.querySelectorAll('button')].find(value => value.textContent?.trim() === name); expect(button, name).toBeDefined(); await act(async () => button!.click()); };
  await click('查看副牌'); await click('查看详情');
  return { host, click, resume, write, session };
}
describe('历史原路径只读复盘', () => {
  it('原路径已跨到下一副时，分支比较仍展示原副真实结算', async () => {
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT',true); const {repo,detail}=await replayFixture();
    const client=new HistoryClient(); vi.spyOn(client,'write').mockImplementation(async packet=>repo.writeHistory(packet));
    vi.spyOn(client,'detail').mockImplementation(async()=>historyDetail(repo,detail.hand.handId));
    const host=document.createElement('div'); document.body.append(host); const root=createRoot(host);
    cleanup=async()=>{await act(async()=>root.unmount());host.remove();repo.close();};
    await act(async()=>root.render(React.createElement(HistoryReplay,{detail,client,onUpdated:vi.fn()})));
    const click=async(name:string)=>{await act(async()=>[...host.querySelectorAll('button')].find(value=>value.textContent===name)!.click());};
    await click('新建分支'); await click('提交分支动作');
    const actual=[...host.querySelectorAll('tbody tr')].find(row=>row.textContent?.includes('实际对局'));
    expect(actual?.textContent).toContain(`${SIDE_NAMES[detail.hand.result!.winnerSide]}胜`);
  });

  it('已采用评估显示真实执行动作，未采用建议与耗时回退按节点还原', async () => {
    const { host, click }=await mount(true); await click('开始复盘');
    expect(host.textContent).toContain('未采用评估'); expect(host.textContent).toContain('已采用评估');
    expect(host.textContent).toContain('建议：叫 75 分'); expect(host.textContent).toContain('实际动作：南 叫 70 分');
    expect(host.textContent).toContain('25 ms'); expect(host.textContent).toContain('显式测试回退');
  });
  it('播放实际推进到末端并自动暂停，不发起模型请求', async () => {
    const { host, click, write }=await mount(); const decision=vi.spyOn(RemoteDecisionEngine.prototype,'chooseAction');
    await click('开始复盘'); vi.useFakeTimers(); await click('播放');
    await act(async()=>{vi.advanceTimersByTime(4000);});
    expect(host.textContent).toContain('节点 4 / 4'); expect(host.textContent).not.toContain('暂停播放');
    expect(decision).not.toHaveBeenCalled(); expect(write).not.toHaveBeenCalled();
  });
  it('全牌复盘下模拟依然只投影阶段观察，逐动作确认保存并能继续同一分支', async () => {
    const { host, click, write }=await mount();
    const decision=vi.spyOn(RemoteDecisionEngine.prototype,'chooseAction').mockImplementation(async observation=>{
      expect(observation).not.toHaveProperty('hands'); expect(observation).not.toHaveProperty('seed'); expect(observation).not.toHaveProperty('revealedHand');
      return {action:{kind:'bid',seat:observation.seat,bid:null},engineType:'bridge',latencyMs:3};
    });
    await click('开始复盘');
    const checkbox=[...host.querySelectorAll<HTMLInputElement>('input[type="checkbox"]')][0];
    await act(async()=>checkbox.click()); await click('新建分支'); await click('模拟一步'); await click('模拟一步');
    expect(decision).toHaveBeenCalledTimes(2); expect(write).toHaveBeenCalledTimes(2);
    expect(host.querySelectorAll('[aria-label="复盘路径"] option')).toHaveLength(2);
    expect(host.textContent).toContain('节点 2 / 2');
  });
  it('模拟等待时跳转节点会取消请求，忽略取消的迟到模型动作不能提交', async () => {
    const { host, click, write }=await mount(); let release!:()=>void; let received:AbortSignal|undefined;
    vi.spyOn(RemoteDecisionEngine.prototype,'chooseAction').mockImplementation(async (observation,signal)=>{
      received=signal; await new Promise<void>(resolve=>{release=resolve;});
      return {action:{kind:'bid',seat:observation.seat,bid:null},engineType:'bridge',latencyMs:3};
    });
    await click('开始复盘'); await click('新建分支'); await click('模拟一步');
    await click('下一步'); expect(received?.aborted).toBe(true);
    await act(async()=>{release(); await Promise.resolve();});
    expect(write).not.toHaveBeenCalled(); expect(host.textContent).toContain('节点 1 / 4');
  });

  it('从节点建立反事实分支并提交不同叫分，原路径仍可选择和比较', async () => {
    const { host, click, write, resume } = await mount(); await click('开始复盘');
    await click('新建分支');
    const bid = host.querySelector<HTMLSelectElement>('[aria-label="分支叫分"]')!;
    expect(bid).not.toBeNull();
    await act(async () => { bid.value='75'; bid.dispatchEvent(new Event('change',{bubbles:true})); });
    await click('提交分支动作');
    expect(write).toHaveBeenCalledTimes(1); expect(resume).not.toHaveBeenCalled();
    expect(host.textContent).toContain('叫 75 分');
    expect(host.querySelectorAll('[aria-label="复盘路径"] option')).toHaveLength(2);
    expect(host.textContent).toContain('原局与分支比较');
    const path = host.querySelector<HTMLSelectElement>('[aria-label="复盘路径"]')!;
    await act(async () => { path.value=path.options[0].value; path.dispatchEvent(new Event('change',{bubbles:true})); });
    expect(host.textContent).toContain('节点 0 / 4');
  });

  it('打开复盘后能前后步进、时间线跳转、播放暂停，既不恢复活动局也不写历史', async () => {
    const { host, click, resume, write, session } = await mount();
    const active = session.getSnapshot();
    await click('开始复盘');
    expect(host.textContent).toContain('节点 0 / 4');
    await click('下一步'); expect(host.textContent).toContain('节点 1 / 4'); expect(host.textContent).toContain('叫 70 分');
    await click('上一步'); expect(host.textContent).toContain('节点 0 / 4');
    const timeline = host.querySelector<HTMLSelectElement>('[aria-label="复盘时间线"]')!;
    expect(timeline).not.toBeNull();
    await act(async () => { timeline.value = '4'; timeline.dispatchEvent(new Event('change', { bubbles:true })); });
    expect(host.textContent).toContain('定主');
    await click('上一步'); await click('播放'); expect(host.textContent).toContain('暂停播放'); await click('暂停播放');
    expect(resume).not.toHaveBeenCalled(); expect(write).not.toHaveBeenCalled(); expect(session.getSnapshot()).toBe(active);
  });
  it('切换座位显示当时合法观察，缺少诊断明确显示未采集', async () => {
    const { host, click } = await mount(); await click('开始复盘');
    expect(host.textContent).toContain('未采集');
    const view = host.querySelector<HTMLSelectElement>('[aria-label="复盘座位视角"]')!;
    expect(view).not.toBeNull();
    await act(async () => { view.value = '2'; view.dispatchEvent(new Event('change', { bubbles:true })); });
    const observation = host.querySelector('[aria-label="当时可见观察"]');
    expect(observation?.textContent).toContain('"seat": 2');
    expect(observation?.textContent).not.toContain('seed'); expect(observation?.textContent).not.toContain('"hands"');
  });
});
