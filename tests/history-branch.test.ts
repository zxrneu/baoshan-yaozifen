/** 反事实分支回归（DIP）：保留父节点及原后续，失败重试与迟到决策可控。 */
import { describe, expect, it, vi } from 'vitest';
import { HistoryBranch } from '@yaozifen/history-core/branch';
import { replayFixture } from './fixtures/replay';
import { replayPath } from '@yaozifen/history-core/replay';
import { currentSeat, legalMoves } from '@yaozifen/game-core';
import { historySnapshotDigest } from '@yaozifen/protocol/snapshot';
import { historyDetail } from '@yaozifen/server/history/http';
import { encodeWrite, decodeWrite, type HistoryWrite } from '@yaozifen/history-core/transport';
import type { DecisionEngine } from '@yaozifen/ai-core/engines/engineTypes';
const configuration = { profiles:[], seats:[0,1,2,3].map(seat=>({seat,kind:'human' as const})) };

describe('历史节点独立分支', () => {
  it('保存后拒绝过期或不同副的详情，重试仅同步读取而不重复提交动作', async () => {
    const { repo, detail }=await replayFixture();
    try {
      let stale=true; const write=vi.fn(async(packet:HistoryWrite)=>repo.writeHistory(packet));
      const branch=new HistoryBranch(detail,null,{configuration,write,reload:async()=>stale ? detail : historyDetail(repo,detail.hand.handId)});
      await expect(branch.apply({kind:'bid',seat:1,bid:75})).rejects.toThrow(/同步|详情|节点/);
      expect(branch.hasPendingSave()).toBe(false); expect(branch.hasUnsyncedDetail()).toBe(true);
      expect(branch.getState().highestBid).toBe(75); stale=false; await branch.retry();
      expect(write).toHaveBeenCalledTimes(1); expect(branch.getDetail().branches).toHaveLength(2);
    } finally { repo.close(); }
  });

  it('确认保存后重新读取服务端实际配置版本，导出与数据库保持一致', async () => {
    const { repo, detail }=await replayFixture();
    try {
      const local={profileVersionId:'client-version',profileId:'service',version:'client',configHash:'client',type:'llm',name:'默认 llm',parameters:{execution:'server'},createdAt:1};
      const actual={...local,profileVersionId:'server-version',version:'server',configHash:'server',parameters:{execution:'server',options:{model:'实际模型'}}};
      const branch=new HistoryBranch(detail,null,{
        configuration:{profiles:[local],seats:[{seat:1,kind:'ai',profileVersionId:local.profileVersionId}]},
        write:async packet=>{packet=decodeWrite(JSON.parse(encodeWrite(packet)));packet.profiles=[actual];packet.commit!.seatAssignments![0].profileVersionId=actual.profileVersionId;repo.writeHistory(packet);},
        reload:async()=>historyDetail(repo,detail.hand.handId),
      });
      await branch.apply({kind:'bid',seat:1,bid:75});
      expect(branch.getDetail().assignments.at(-1)?.profileVersionId).toBe('server-version');
      expect(branch.getDetail().profiles.at(-1)?.parameters).toEqual(actual.parameters);
    } finally { repo.close(); }
  });

  it('同一节点可有多个 child，嵌套分支可回放，真实路径和结算均保持不变', async () => {
    const { repo, detail }=await replayFixture();
    try {
      const original=JSON.stringify(detail); const first=detail.nodes[0];
      const a=new HistoryBranch(detail,first.nodeId,{write:async packet=>repo.writeHistory(packet),configuration,name:'方案 A'});
      const b=new HistoryBranch(detail,first.nodeId,{write:async packet=>repo.writeHistory(packet),configuration,name:'方案 B'});
      await a.apply({kind:'bid',seat:currentSeat(first.state),bid:75});
      await b.apply({kind:'bid',seat:currentSeat(first.state),bid:null});
      const saved=historyDetail(repo,detail.hand.handId);
      expect(saved.branches).toHaveLength(3); expect(saved.nodes.filter(node=>node.parentId===first.nodeId)).toHaveLength(3);
      expect(saved.hand).toEqual(detail.hand); expect(repo.listActionNodes(detail.branches[0].branchId)).toEqual(detail.nodes);
      const branch=saved.branches.find(value=>value.name==='方案 A')!;
      expect(replayPath(saved,branch.branchId).at(-1)?.state.highestBid).toBe(75);
      const nested=new HistoryBranch(saved,branch.tipNodeId,{write:async packet=>repo.writeHistory(packet),configuration});
      await nested.apply({kind:'bid',seat:currentSeat(a.getState()),bid:80});
      expect(repo.listBranches(detail.hand.handId)).toHaveLength(4); expect(JSON.stringify(detail)).toBe(original);
    } finally { repo.close(); }
  });
  it('从副起点换动作，非法动作不会存库，明确写失败后相同包重试幂等且不丢原路径', async () => {
    const { repo, detail }=await replayFixture();
    try {
      let fail=true; const packets:HistoryWrite[]=[];
      const branch=new HistoryBranch(detail,null,{configuration,write:async packet=>{packets.push(packet);repo.writeHistory(packet);if(fail)throw new Error('显式丢失提交确认');}});
      const original=historySnapshotDigest(detail.hand.startSnapshot);
      await expect(branch.apply({kind:'bid',seat:0,bid:10})).rejects.toThrow(); expect(packets).toHaveLength(0);
      await expect(branch.apply({kind:'bid',seat:currentSeat(detail.hand.startSnapshot),bid:75})).rejects.toThrow();
      expect(historySnapshotDigest(branch.getState())).toBe(original);
      fail=false; await branch.retry();
      expect(packets[1]).toEqual(packets[0]); expect(repo.listBranches(detail.hand.handId)).toHaveLength(2);
      expect(branch.getState().highestBid).toBe(75); expect(repo.getHand(detail.hand.handId)).toEqual(detail.hand);
    } finally { repo.close(); }
  });
  it.each(['节点','配置','取消'])('%s 切换使忽略 AbortSignal 的迟到结果失效，不写入分支', async reason => {
    const { repo, detail }=await replayFixture();
    try {
      const node=detail.nodes.find(value=>value.state.phase==='playing')!; let release!:()=>void; let signal:AbortSignal|undefined;
      const write=vi.fn(async(packet:HistoryWrite)=>repo.writeHistory(packet));
      const engine:DecisionEngine={type:'algorithm',chooseCard:async(observation,candidates,received)=>{signal=received;await new Promise<void>(resolve=>{release=resolve;});expect(observation).not.toHaveProperty('seed');expect(observation).not.toHaveProperty('hands');return {card:candidates[0],engineType:'algorithm',latencyMs:1};}};
      const branch=new HistoryBranch(detail,node.nodeId,{configuration,write}); const task=branch.step(engine);
      await Promise.resolve();
      if(reason==='配置') branch.configurationChanged(configuration); else branch.cancel();
      release(); expect(await task).toBe(false); expect(signal?.aborted).toBe(true); expect(write).not.toHaveBeenCalled();
    } finally { repo.close(); }
  });
  it('模拟只接收阶段合法观察，保存已采用评估，跟牌动作与分支结算可重新打开', async () => {
    const { repo, detail }=await replayFixture(100);
    try {
      const node=detail.nodes.find(value=>value.state.phase==='playing')!;
      const engine:DecisionEngine={type:'algorithm',chooseCard:vi.fn(async(observation,candidates)=>{expect(observation).not.toHaveProperty('seed');expect(observation).not.toHaveProperty('hands');expect(observation.revealedHand).toEqual({seat:3,cards:node.state.hands[3]});return {card:candidates[0],engineType:'algorithm' as const,latencyMs:7};})};
      const branch=new HistoryBranch(detail,node.nodeId,{configuration,write:async packet=>repo.writeHistory(packet)});
      expect(await branch.step(engine)).toBe(true);
      while(branch.getState().phase==='playing') {
        const state=branch.getState(); const seat=currentSeat(state); await branch.apply({kind:'play',seat,card:legalMoves(state,seat)[0]});
      }
      const saved=historyDetail(repo,detail.hand.handId); const path=saved.branches.find(value=>value.kind==='branch')!;
      expect(replayPath(saved,path.branchId).at(-1)?.state.result).not.toBeNull();
      expect(saved.evaluations.at(-1)).toMatchObject({status:'applied',latencyMs:7,observationPoint:'before'});
      expect(saved.hand.result).toEqual(detail.hand.result); expect(branch.getDetail().branches).toHaveLength(2);
    } finally { repo.close(); }
  });
});
