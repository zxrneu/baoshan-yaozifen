/** 复盘节点回归（SRP）：规则状态、观察和诊断按保存位置还原。 */
import { describe, expect, it } from 'vitest';
import { cardPoints } from '@yaozifen/game-core/cards';
import { currentSeat, partnerOf } from '@yaozifen/game-core';
import { observeDecision } from '@yaozifen/game-view/decisionObservation';
import { replayPath, replayObservation, evaluationsAt, validatedReplay } from '@yaozifen/history-core/replay';
import { historySnapshotDigest } from '@yaozifen/protocol/snapshot';
import { replayFixture } from './fixtures/replay';
import { historyDetail } from '@yaozifen/server/history/http';

describe('完整历史原动作回放', () => {
  it('整场结算节点保持最终赢家、胜副和未打出分，结算观察只含本座及公开信息', async () => {
    const { repo, detail }=await replayFixture(70,1);
    try {
      const state=replayPath(detail,detail.branches[0].branchId).at(-1)!.state;
      expect(state.phase).toBe('matchEnd'); expect(state.scores.reduce((sum,value)=>sum+value,0)).toBe(1);
      expect(state.result).toEqual(detail.hand.result); expect(state.result?.unplayedPoints).toBe(detail.hand.unplayedPoints);
      const observation=replayObservation(state,0); expect(observation).not.toHaveProperty('seed'); expect(observation).not.toHaveProperty('hands');
    } finally { repo.close(); }
  });

  it('每节点状态和观察一致，覆盖四阶段、跟牌、提前结算、跨副与分数守恒', async () => {
    const { repo, detail, states } = await replayFixture();
    try {
      const frames = replayPath(validatedReplay(detail), detail.branches[0].branchId);
      expect(frames).toHaveLength(states.length);
      expect(new Set(frames.map(frame => frame.state.phase))).toEqual(new Set(['bidding','trump','bury','playing','handEnd']));
      expect(frames.some(frame => frame.state.trick.length > 0 && frame.state.trick.length < 4)).toBe(true);
      expect(detail.hand.unplayedPoints).toBeGreaterThan(0);
      frames.forEach((frame, index) => {
        expect(historySnapshotDigest(frame.state)).toBe(historySnapshotDigest(states[index]));
        const state = frame.state;
        expect(state.declarerTrickPoints + state.defenderTrickPoints + state.buriedPoints + [...state.hands.flat(), ...state.trick.map(entry => entry.card)].reduce((sum,card) => sum+cardPoints(card),0) + (state.phase === 'bury' ? 0 : state.kitty.reduce((sum,card) => sum+cardPoints(card),0))).toBe(100);
        if (currentSeat(state) >= 0) for (let seat=0; seat<4; seat++) expect(replayObservation(state,seat)).toEqual(observeDecision(states[index],seat));
      });
      expect(frames.at(-1)?.node?.command.kind).toBe('nextHand');
    } finally { repo.close(); }
  });
  it('100 分搭档暗牌只在成功扣底后公开，并随出牌持续减少；复盘输出无 seed', async () => {
    const { repo, detail } = await replayFixture(100);
    try {
      const frames = replayPath(detail,detail.branches[0].branchId);
      for (const frame of frames) {
        const state=frame.state; const observation=replayObservation(state,1);
        expect(observation).not.toHaveProperty('seed'); expect(observation).not.toHaveProperty('hands');
        if (['bidding','trump','bury'].includes(state.phase)) expect(observation).not.toHaveProperty('revealedHand');
        if (state.phase === 'playing') expect(observation).toHaveProperty('revealedHand',{seat:partnerOf(state.declarer!),cards:state.hands[partnerOf(state.declarer!)]});
      }
      expect(frames.filter(frame => frame.state.phase === 'playing').at(-1)?.state.hands[partnerOf(detail.hand.declarer!)]!.length).toBeLessThan(12);
    } finally { repo.close(); }
  });
  it('首点评估、动作前评估、节点后评估分别关联；采用建议和实际动作保持独立', async () => {
    const { repo, detail } = await replayFixture();
    try {
      const branch=detail.branches[0]; const first=detail.nodes[0]; const seat=currentSeat(detail.hand.startSnapshot);
      const base={sessionId:'test',seat,phase:'bidding' as const,purpose:'hint' as const,observation:observeDecision(detail.hand.startSnapshot,seat),candidates:[],recommended:{bid:75},status:'evaluated' as const,latencyMs:15,createdAt:1};
      repo.recordEvaluation({...base,nodeId:`root:${branch.branchId}`,requestId:'root',evaluationId:'root-eval'});
      repo.recordEvaluation({...base,nodeId:first.nodeId,observationPoint:'before',requestId:'before',evaluationId:'before-eval'});
      repo.updateEvaluationStatus('before-eval','applied',first.nodeId);
      repo.recordEvaluation({...base,nodeId:first.nodeId,observation:observeDecision(first.state,seat),requestId:'after',evaluationId:'after-eval'});
      const saved=historyDetail(repo,detail.hand.handId); const frames=replayPath(saved,branch.branchId);
      const evaluations=evaluationsAt(saved,frames[0],seat,branch.branchId);
      expect(evaluations.map(value=>value.requestId).sort()).toEqual(['before','root']);
      expect(evaluations.find(value=>value.status==='applied')?.appliedNodeId).toBe(first.nodeId);
      expect(evaluationsAt(saved,frames[1],seat,branch.branchId).map(value=>value.requestId)).toEqual(['after']);
      expect(first.command).toMatchObject({bid:70});
    } finally { repo.close(); }
  });
});
