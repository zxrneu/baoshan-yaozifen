/** 历史 HTTP 集成（DIP）：临时 SQLite 与内存请求验证存档、分页和重启查询。 */
import { afterEach, describe, expect, it } from 'vitest';
import { EventEmitter } from 'node:events';
import { createApiHandler, type ApiHandlerConfig } from '../server/apiHandler';
import { SqliteHistoryRepository } from '../server/history/sqliteRepository';
import { createGame, currentSeat, bid } from '../src/engine';
import { sanitizeHistorySnapshot } from '../src/history/snapshot';

const repositories: SqliteHistoryRepository[] = [];
afterEach(() => repositories.forEach(repo => repo.close()));
function api() {
  const repo = new SqliteHistoryRepository({ path: ':memory:' });
  repositories.push(repo);
  const config = { historyRepository: () => repo } as ApiHandlerConfig;
  return { repo, handler: createApiHandler(config) };
}
async function request(handler: ReturnType<typeof createApiHandler>, method: string, url: string, body?: unknown) {
  const req = Object.assign(new EventEmitter(), { method, url });
  let status = 0; let text = '';
  const task = handler.handleApiRequest(req, { writeHead(code) { status = code; }, end(data) { text = String(data ?? ''); } }, new URL(url, 'http://test').pathname);
  req.emit('data', body === undefined ? '' : JSON.stringify(body)); req.emit('end');
  const handled = await task;
  return { handled, status, body: text ? JSON.parse(text) : null };
}
const wireState = (state: ReturnType<typeof createGame>) => ({ protocolVersion: 2, ruleSetId: 'basic-v1', ruleVersion: 1, snapshot: sanitizeHistorySnapshot(state) });
function start() {
  return { protocolVersion: 2, match: { matchId: 'm_test', startedAt: 1, source: 'human', targetWins: 5 },
    hand: { handId: 'h_test', matchId: 'm_test', handIndex: 0, startedAt: 1, startSnapshot: wireState(createGame(731)) },
    branch: { branchId: 'b_test', handId: 'h_test', name: '实际对局', createdAt: 1 } };
}
describe('历史 HTTP 保存与读取', () => {
  it('保存起点和合法动作，重试幂等，详情包含可恢复的完整历史', async () => {
    const { repo, handler } = api();
    expect((await request(handler, 'POST', '/api/history/write', start())).status).toBe(200);
    const before = createGame(731); const command = { kind: 'bid', seat: currentSeat(before), bid: 70 };
    const state = bid(before, command.seat, command.bid);
    const packet = { protocolVersion: 2, commit: { matchId: 'm_test', node: { nodeId: 'n_test', branchId: 'b_test', seq: 0, source: 'human', command, state: wireState(state), createdAt: 2 } } };
    expect((await request(handler, 'POST', '/api/history/write', packet)).status).toBe(200);
    expect((await request(handler, 'POST', '/api/history/write', packet)).status).toBe(200);
    expect(repo.listActionNodes('b_test')).toHaveLength(1);
    const detail = await request(handler, 'GET', '/api/history/hands/h_test');
    expect(detail.status).toBe(200);
    expect(detail.body.data.nodes[0].state.snapshot.seed).toBe(state.seed);
    expect(detail.body.digest).toMatch(/^sha256:/);
    expect((await request(handler, 'GET', '/api/history/matches/m_test/hands')).body[0].bid).toBe(70);
    expect((await request(handler, 'GET', '/api/history/matches?limit=1&offset=0&status=in_progress')).body).toHaveLength(1);
  });
  it('起点附属配置失败时整体回滚，未知版本与非法动作明确拒绝', async () => {
    const { repo, handler } = api();
    const packet = { ...start(), assignments: [{ assignmentId: 'bad', handId: 'h_test', branchId: 'b_test', seat: 0, kind: 'ai', profileVersionId: 'missing', createdAt: 1 }] };
    expect((await request(handler, 'POST', '/api/history/write', packet)).status).toBe(400);
    expect(repo.getMatch('m_test')).toBeNull();
    expect((await request(handler, 'POST', '/api/history/write', { ...start(), protocolVersion: 999 })).status).toBe(400);
    expect((await request(handler, 'GET', '/api/history/matches?limit=-1')).status).toBe(400);
  });
});

describe('历史筛选与服务端实际配置', () => {
  it('时间、引擎和叫分筛选共同约束数据库结果', async () => {
    const { repo, handler } = api();
    await request(handler, 'POST', '/api/history/write', start());
    repo.createMatch({matchId:'later', source:'bench', startedAt:100, targetWins:5});
    expect((await request(handler,'GET','/api/history/matches?from=50')).body.map((match: { matchId:string })=>match.matchId)).toEqual(['later']);
    expect((await request(handler,'GET','/api/history/matches?engineType=llm')).body).toEqual([]);
    expect((await request(handler,'GET','/api/history/matches?bid=100')).body).toEqual([]);
    expect((await request(handler,'GET','/api/history/matches?from=-1')).status).toBe(400);
  });
});

it('服务端配置快照记录实际 Laya 模型和生效预算，凭据与完整端点不进入历史', async () => {
  const repo=new SqliteHistoryRepository({path:':memory:'}); repositories.push(repo);
  const handler=createApiHandler({historyRepository:()=>repo,laya:{baseUrl:'http://private.test',model:'server-model',timeoutMs:2400}});
  const profile = {profileVersionId:'client-profile',profileId:'default-laya',version:'v1',configHash:'client',type:'laya',name:'默认 Laya',parameters:{execution:'server',options:{model:'client-model',timeoutMs:1500}},createdAt:1};
  const packet={...start(),profiles:[profile],assignments:[{assignmentId:'seat',handId:'h_test',branchId:'b_test',seat:0,kind:'ai',profileVersionId:'client-profile',createdAt:1}]};
  expect((await request(handler,'POST','/api/history/write',packet)).status).toBe(200);
  const assigned=repo.listSeatAssignments('h_test')[0]; const actual=repo.getProfileVersion(assigned.profileVersionId!)!;
  expect(actual.parameters.options).toMatchObject({model:'server-model',timeoutMs:2400});
  expect(JSON.stringify(actual)).not.toContain('http://private.test');
});
