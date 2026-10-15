/** 模拟入口验收（DIP）：真实 SQLite、冻结配置和同种子换边历史闭环。 */
import { afterEach, expect, it } from 'vitest';
import { EventEmitter } from 'node:events';
import { createApiHandler } from '@yaozifen/server/apiHandler';
import { SqliteHistoryRepository } from '@yaozifen/server/history/sqliteRepository';
import { readHandDetail } from '@yaozifen/history-core/transport';
const repos: SqliteHistoryRepository[] = [];
afterEach(() => repos.forEach(repo => repo.close()));
async function request(handler: ReturnType<typeof createApiHandler>, method: string, url: string, body?: unknown) {
    const req = Object.assign(new EventEmitter(), { method, url });
    let status = 0;
    let result = '';
    const promise = handler.handleApiRequest(req, { writeHead(code) { status = code; }, end(data) { result = String(data ?? ''); } }, new URL(url, 'http://test').pathname);
    req.emit('data', body === undefined ? '' : JSON.stringify(body));
    req.emit('end');
    await promise;
    return { status, body: result ? JSON.parse(result) : null, text: result };
}
it('批跑冻结四座配置并保存两局，报告以赢副和组级区间计分且可打开复盘', async () => {
    const repo = new SqliteHistoryRepository({ path: ':memory:' });
    repos.push(repo);
    const handler = createApiHandler({ historyRepository: () => repo });
    const profile = handler.engineRegistry.getProfile('default-bridge');
    const ref = { profileId: profile.profileId, version: profile.version };
    const started = await request(handler, 'POST', '/api/history/simulations', { seeds: [731], seats: [ref, ref, ref, ref], mode: 'lifecycle', decisionBudgetMs: 1000, runBudgetMs: 30000, concurrency: 1, maxActions: 512, maxRedeals: 3 });
    expect(started.status).toBe(202);
    const id = started.body.runId;
    let report = started.body;
    for (let i = 0; i < 1000 && report.status === 'running'; i++) {
        await new Promise(resolve => setTimeout(resolve, 10));
        report = (await request(handler, 'GET', `/api/history/simulations/${id}`)).body;
    }
    expect(report.status).toBe('completed');
    expect(report.boards).toHaveLength(1);
    expect(report.summary.interval.groups).toBe(1);
    expect(report.summary.aWins + report.summary.bWins).toBe(2);
    for (const game of report.boards[0].games) {
        const detail = readHandDetail((await request(handler, 'GET', `/api/history/hands/${game.handId}`)).text);
        expect(detail.hand.result).toBeTruthy();
        expect(detail.match.source).toBe('simulation');
        expect(detail.evaluations.length).toBeGreaterThan(0);
        expect(JSON.stringify(detail.evaluations.map(item => item.observation))).not.toContain('"seed"');
        expect(detail.assignments.every(item => item.profileVersionId === profile.profileVersionId)).toBe(true);
    }
}, 30000);
