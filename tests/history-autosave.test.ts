/** 自动存档行为回归（DIP）：通过真实会话与注入失败验证保存边界，不依赖服务端口。 */
import { describe, expect, it, vi } from 'vitest';
import { GameSession } from '../src/workbench/session';
import { createGame, currentSeat } from '../src/engine';
import { SqliteHistoryRepository } from '../server/history/sqliteRepository';
import { HistoryRecorder } from '../src/history/autosave';
import { observeDecision } from '../src/ai/decisionObservation';
import { historySnapshotDigest } from '../src/history/snapshot';

// 首轮先验证尚未接入时不会产生历史，不以缺失导入作为失败证据。
function recorder(session: GameSession, repo: SqliteHistoryRepository, write = async (packet: unknown) => { repo.writeHistory(packet as Parameters<typeof repo.writeHistory>[0]); }) {
  return new HistoryRecorder(session, { write, configuration: () => ({ profiles: [], seats: [0,1,2,3].map(seat => ({ seat, kind: 'human' })) }) });
}
describe('提交边界自动保存', () => {
  it('本副复盘身份只在保存确认后提供，跨副后指向新的真实路径', async () => {
    const repo = new SqliteHistoryRepository({ path: ':memory:' });
    const { before, command } = (await import('./fixtures/history')).historyEndingAction();
    const session = new GameSession(before); const save = recorder(session, repo);
    expect(save.currentHand?.()).toBeNull();
    session.commit(command, session.getSnapshot().cursor);
    await save.flush();
    const match = repo.listMatches()[0]; const hand = repo.listHands(match.matchId)[0];
    const branch = repo.listBranches(hand.handId)[0];
    expect(save.currentHand()).toEqual({ handId: hand.handId, branchId: branch.branchId, nodeId: branch.tipNodeId });
    session.commit({ kind: 'nextHand' }, session.getSnapshot().cursor);
    expect(save.currentHand()).toBeNull();
    await save.flush();
    const next = repo.listHands(match.matchId)[1];
    expect(save.currentHand()?.handId).toBe(next.handId);
    expect(save.currentHand()?.handId).not.toBe(hand.handId);
    save.dispose(); repo.close();
  });

  it('练习的待保存日志与原标准对局独立，重试不会清除原局记录', async () => {
    const storage = new Map<string, string>();
    const journal = { getItem: (key: string) => storage.get(key) ?? null, setItem: (key: string, value: string) => { storage.set(key, value); }, removeItem: (key: string) => { storage.delete(key); } };
    const standard = new HistoryRecorder(new GameSession(createGame(731)), { write: async () => { throw new Error('标准对局保存失败'); }, configuration: () => ({ profiles: [], seats: [] }), journal });
    await standard.flush(); const original = storage.get('baoshan_history_pending_v2');
    const practice = new HistoryRecorder(new GameSession(createGame(91, { targetWins: 1 })), { write: async () => { throw new Error('练习保存失败'); }, configuration: () => ({ profiles: [], seats: [] }), journal, journalKey: 'baoshan_practice_pending_v2' });
    await practice.flush();
    expect(storage.get('baoshan_history_pending_v2')).toBe(original);
    expect(storage.get('baoshan_practice_pending_v2')).toBeDefined();
    standard.dispose(); practice.dispose();
  });

  it('退出练习后的旧保存确认不能清除新练习的待保存日志', async () => {
    const storage = new Map<string, string>();
    const journal = { getItem: (key: string) => storage.get(key) ?? null, setItem: (key: string, value: string) => { storage.set(key, value); }, removeItem: (key: string) => { storage.delete(key); } };
    let finish!: () => void;
    const first = new HistoryRecorder(new GameSession(createGame(1, { targetWins: 1 })), { write: () => new Promise<void>(resolve => { finish = resolve; }), configuration: () => ({ profiles: [], seats: [] }), journal, journalKey: 'practice' });
    const task = first.flush(); await Promise.resolve(); first.dispose();
    const second = new HistoryRecorder(new GameSession(createGame(2, { targetWins: 1 })), { write: async () => { throw new Error('新练习保存失败'); }, configuration: () => ({ profiles: [], seats: [] }), journal, journalKey: 'practice' });
    await second.flush(); const pending = storage.get('practice');
    finish(); await task;
    expect(storage.get('practice')).toBe(pending);
    second.dispose();
  });

  it('起始快照和全部合法提交自动入库，重复重试不复制，非法动作不入库', async () => {
    const repo = new SqliteHistoryRepository({ path: ':memory:' }); const session = new GameSession(createGame(731));
    const save = recorder(session, repo);
    const seat = currentSeat(session.getSnapshot().game);
    session.commit({ kind: 'bid', seat, bid: 70 }, session.getSnapshot().cursor, 'human');
    await save.flush();
    expect(repo.listMatches()).toHaveLength(1);
    const hand = repo.listHands(repo.listMatches()[0].matchId)[0];
    const branch = repo.listBranches(hand.handId)[0];
    expect(repo.listActionNodes(branch.branchId)).toHaveLength(1);
    expect(historySnapshotDigest(repo.listActionNodes(branch.branchId)[0].state)).toBe(historySnapshotDigest(session.getSnapshot().game));
    expect(() => session.commit({ kind: 'bid', seat, bid: 70 }, session.getSnapshot().cursor)).toThrow();
    await save.retry(); expect(repo.listActionNodes(branch.branchId)).toHaveLength(1);
    save.dispose(); repo.close();
  });
  it('确认丢失显式暂停自动推进，保留待保存包，同身份重试后恢复已保存状态', async () => {
    const repo = new SqliteHistoryRepository({ path: ':memory:' }); const session = new GameSession(createGame(731));
    let fail = false;
    const write = vi.fn(async (packet: unknown) => { repo.writeHistory(packet as Parameters<typeof repo.writeHistory>[0]); if (fail) throw new Error('显式注入响应丢失'); });
    const save = recorder(session, repo, write); await save.flush(); fail = true;
    session.setMode('auto'); session.commit({ kind: 'bid', seat: currentSeat(session.getSnapshot().game), bid: 70 }, session.getSnapshot().cursor, 'ai');
    await save.flush();
    expect(save.getSnapshot().status).toBe('error'); expect(session.getSnapshot().mode).toBe('paused');
    fail = false; await save.retry(); expect(save.getSnapshot().status).toBe('saved');
    const hand = repo.listHands(repo.listMatches()[0].matchId)[0]; expect(repo.listActionNodes(repo.listBranches(hand.handId)[0].branchId)).toHaveLength(1);
    save.dispose(); repo.close();
  });
  it('首个动作前的未采用建议即时保存，取消后变为失效，不能混入执行路径', async () => {
    const repo = new SqliteHistoryRepository({ path: ':memory:' }); const session = new GameSession(createGame(731));
    const save = recorder(session, repo); const snapshot = session.getSnapshot();
    save.recordEvaluation(snapshot.cursor.nodeId, { evaluationId:'root-eval', requestId:'r1', sessionId:snapshot.cursor.sessionId,
      seat:currentSeat(snapshot.game), phase:'bidding', purpose:'hint', observation:observeDecision(snapshot.game,currentSeat(snapshot.game)),
      candidates:[], recommended:{ kind:'bid', bid:70 }, status:'evaluated', latencyMs:1, createdAt:Date.now() });
    await save.flush();
    const hand = repo.listHands(repo.listMatches()[0].matchId)[0]; const branch = repo.listBranches(hand.handId)[0];
    expect(repo.listEvaluations(`root:${branch.branchId}`)).toHaveLength(1);
    session.cancelRequests(); await Promise.resolve(); await save.flush();
    expect(repo.listEvaluations(`root:${branch.branchId}`)[0].status).toBe('stale');
    expect(repo.listActionNodes(branch.branchId)).toHaveLength(0);
    save.dispose(); repo.close();
  });
  it('重开保留中断记录，撤销后接管不覆盖原路径', async () => {
    const repo = new SqliteHistoryRepository({ path: ':memory:' }); const session = new GameSession(createGame(731));
    const save = recorder(session, repo);
    session.commit({ kind: 'bid', seat: currentSeat(session.getSnapshot().game), bid: 70 }, session.getSnapshot().cursor, 'ai');
    session.undo();
    session.commit({ kind: 'bid', seat: currentSeat(session.getSnapshot().game), bid: 80 }, session.getSnapshot().cursor, 'manual');
    await save.flush();
    const first = repo.listMatches()[0]; const hand = repo.listHands(first.matchId)[0];
    expect(repo.listBranches(hand.handId)).toHaveLength(2);
    expect(repo.listBranches(hand.handId).map(branch => repo.listActionNodes(branch.branchId)[0].state.highestBid).sort()).toEqual([70,80]);
    session.replace(createGame(21)); await save.flush();
    expect(repo.getMatch(first.matchId)?.status).toBe('abandoned'); expect(repo.listMatches()).toHaveLength(2);
    save.dispose(); repo.close();
  });
});

it('损坏的浏览器待保存日志保留原文，不得用新局起点覆盖后伪装恢复成功', async () => {
  const storage=new Map<string,string>([['baoshan_history_pending_v2','损坏的历史原文']]);
  const session=new GameSession(createGame(731)); const writes=vi.fn(async()=>{});
  const save=new HistoryRecorder(session,{write:writes,configuration:()=>({profiles:[],seats:[]}),journal:{getItem:key=>storage.get(key)??null,setItem:(key,value)=>{storage.set(key,value);},removeItem:key=>{storage.delete(key);}}});
  await save.retry();
  expect(storage.get('baoshan_history_pending_v2')).toBe('损坏的历史原文');
  expect(save.getSnapshot().status).toBe('error'); expect(writes).not.toHaveBeenCalled();
  save.dispose();
});

it('采纳首手建议时评估明确关联执行节点，取消通知不能把已采用评估改成失效', async () => {
  const repo=new SqliteHistoryRepository({path:':memory:'}); const session=new GameSession(createGame(731)); const save=recorder(session,repo);
  const {game,cursor}=session.getSnapshot(); const action={kind:'bid' as const,seat:currentSeat(game),bid:70}; const context={...cursor,requestId:'adopted',purpose:'hint' as const};
  save.recordEvaluation(cursor.nodeId,{evaluationId:'adopted-eval',requestId:context.requestId,sessionId:cursor.sessionId,seat:action.seat,phase:'bidding',purpose:'hint',observation:observeDecision(game,action.seat),candidates:[],recommended:action,status:'evaluated',latencyMs:0,createdAt:Date.now()});
  session.commit(action,cursor,'hint',{action,context}); await Promise.resolve(); await save.flush();
  const hand=repo.listHands(repo.listMatches()[0].matchId)[0]; const branch=repo.listBranches(hand.handId)[0];
  expect(repo.listEvaluations(`root:${branch.branchId}`)[0]).toMatchObject({status:'applied',appliedNodeId:branch.tipNodeId});
  save.dispose();repo.close();
});

it('保存已结束快照的真实结果，后续重开不会把已完成整场改成中断', async () => {
  const {historyEndingAction}=await import('./fixtures/history'); const {after}=historyEndingAction();
  const ended={...after,phase:'matchEnd' as const,targetWins:1,rules:{...after.rules,targetWins:1}};
  const repo=new SqliteHistoryRepository({path:':memory:'}); const session=new GameSession(ended); const save=recorder(session,repo);
  await save.flush(); const match=repo.listMatches()[0];
  expect(match.status).toBe('completed'); expect(repo.listHands(match.matchId)[0].result).toEqual(ended.result);
  session.replace(createGame(73)); await save.flush(); expect(repo.getMatch(match.matchId)?.status).toBe('completed');
  save.dispose();repo.close();
});
