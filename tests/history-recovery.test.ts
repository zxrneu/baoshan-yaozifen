/** 存档恢复回归（DIP）：完整规则轨迹、重启、损坏拒绝与配置/观察边界。 */
import { describe, expect, it } from 'vitest';
import { GameSession, type SessionCommand } from '@yaozifen/match-runtime/session';
import { createGame, currentSeat, legalMoves } from '@yaozifen/game-core';
import { cardPoints } from '@yaozifen/game-core/cards';
import { HistoryRecorder } from '@yaozifen/history-core/autosave';
import { SqliteHistoryRepository } from '@yaozifen/server/history/sqliteRepository';
import { historyDetail } from '@yaozifen/server/history/http';
import { exportHand, readHandDetail } from '@yaozifen/history-core/transport';
import { contentDigest } from '@yaozifen/protocol/json';
import { historySnapshotDigest } from '@yaozifen/protocol/snapshot';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const configuration = () => ({ profiles: [], seats: [0,1,2,3].map(seat => ({ seat, kind: 'human' as const })) });
function command(session: GameSession): SessionCommand {
  const state = session.getSnapshot().game; const seat = currentSeat(state);
  switch (state.phase) {
    case 'bidding': return { kind:'bid', seat, bid:state.bidding.length===0 ? 70 : null };
    case 'trump': return { kind:'trump', seat, trump:'S' };
    case 'bury': return { kind:'bury', seat, cards:state.hands[seat].filter(card=>cardPoints(card)===0).slice(0,4) };
    case 'playing': return { kind:'play', seat, card:legalMoves(state,seat)[0] };
    case 'handEnd': return { kind:'nextHand' };
    default: throw new Error('样本意外结束整场');
  }
}
describe('持久化恢复与验收边界', () => {
  it('超过内存一千节点仍保存全部动作，每副结算完整，跨副起点与 nextHand 在同一事务', async () => {
    const repo = new SqliteHistoryRepository({ path:':memory:' }); const session = new GameSession(createGame(731,{ targetWins:1000 }));
    const save = new HistoryRecorder(session,{ write:async packet=>{repo.writeHistory(packet);},configuration });
    for (let index=0; index<1010; index++) session.commit(command(session),session.getSnapshot().cursor,'manual');
    await save.flush(); expect(save.getSnapshot().status).toBe('saved');
    const hands = repo.listHands(repo.listMatches()[0].matchId);
    const nodes = hands.flatMap(hand=>repo.listBranches(hand.handId).flatMap(branch=>repo.listActionNodes(branch.branchId)));
    expect(nodes).toHaveLength(1010); expect(session.getReplay().commands).toHaveLength(999);
    expect(hands.length).toBeGreaterThan(10);
    expect(hands.slice(0,-1).every(hand=>!!hand.result && hand.endedAt!==null)).toBe(true);
    for (const hand of hands) expect(() => readHandDetail(exportHand(historyDetail(repo,hand.handId)))).not.toThrow();
    save.dispose(); repo.close();
  },30000);
  it('关闭重开 SQLite 后恢复到最后确认节点，继续提交沿用持久身份', async () => {
    const dir=mkdtempSync(join(tmpdir(),'history-resume-')); const file=join(dir,'test.db');
    let repo = new SqliteHistoryRepository({path:file}); const session = new GameSession(createGame(731));
    const save = new HistoryRecorder(session,{write:async packet=>{repo.writeHistory(packet);},configuration});
    session.commit(command(session),session.getSnapshot().cursor,'human'); await save.flush();
    const matchId=repo.listMatches()[0].matchId; const handId=repo.listHands(matchId)[0].handId;
    save.dispose(); repo.close(); repo=new SqliteHistoryRepository({path:file});
    const detail=readHandDetail(exportHand(historyDetail(repo,handId))); const next=new GameSession(createGame(11));
    const nextSave=new HistoryRecorder(next,{write:async packet=>{repo.writeHistory(packet);},configuration}); await nextSave.flush();
    nextSave.resume(detail); expect(next.getSnapshot().mode).toBe('paused'); expect(historySnapshotDigest(next.getSnapshot().game)).toBe(historySnapshotDigest(session.getSnapshot().game));
    next.commit(command(next),next.getSnapshot().cursor,'human'); await nextSave.flush();
    expect(repo.listActionNodes(detail.branches[0].branchId)).toHaveLength(2); expect(repo.getMatch(matchId)?.status).toBe('in_progress');
    nextSave.dispose(); repo.close(); rmSync(dir,{recursive:true,force:true});
  });
  it('未知版本、损坏摘要与重新计算摘要后的非法路径都不能覆盖活动局', async () => {
    const repo=new SqliteHistoryRepository({path:':memory:'}); const session=new GameSession(createGame(731));
    const save=new HistoryRecorder(session,{write:async packet=>{repo.writeHistory(packet);},configuration});
    session.commit(command(session),session.getSnapshot().cursor,'human'); await save.flush();
    const detail=historyDetail(repo,repo.listHands(repo.listMatches()[0].matchId)[0].handId);
    const active=historySnapshotDigest(session.getSnapshot().game); const envelope=JSON.parse(exportHand(detail));
    expect(()=>readHandDetail(JSON.stringify({...envelope,protocolVersion:999}))).toThrow(/版本/);
    envelope.data.nodes[0].command.bid=80;
    expect(()=>readHandDetail(JSON.stringify(envelope))).toThrow(/摘要/);
    envelope.digest=contentDigest(envelope.data);
    expect(()=>readHandDetail(JSON.stringify(envelope))).toThrow(/摘要|动作/);
    expect(historySnapshotDigest(session.getSnapshot().game)).toBe(active);
    save.dispose(); repo.close();
  });
});
