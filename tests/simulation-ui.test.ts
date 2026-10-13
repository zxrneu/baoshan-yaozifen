// @vitest-environment happy-dom
/** 模拟交互验收（SRP）：四座冻结选择、报告下钻及明确取消/续跑入口。 */
import { afterEach, expect, it, vi } from 'vitest';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import GameHistoryModal from '../src/components/GameHistoryModal';
import { HistoryClient } from '../src/history/client';
import { replayFixture } from './fixtures/replay';
import { makeProfile, normalizeOptions } from '../src/ai/engines/profiles';
let cleanup: (() => Promise<void>) | undefined;
afterEach(async () => { await cleanup?.(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });
it('历史入口可按四座启动换边，报告每局可打开复盘并保留取消续跑按钮', async () => {
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
    const profile = makeProfile({ id: 'fast', name: '极速', type: 'bridge', options: {} }, normalizeOptions('bridge', { mode: 'fast' }));
    const { repo, detail } = await replayFixture();
    const actual = detail.branches.find(branch => branch.kind === 'actual')!;
    const requests: Array<{
        path: string;
        body: unknown;
    }> = [];
    const savedReport = { runId: 'run', status: 'running', request: { mode: 'lifecycle', seats: Array(4).fill({ profileId: 'fast', version: profile.version }) }, boards: [{ boardId: 'board', index: 0, seed: 731, games: [{ handId: detail.hand.handId, branchId: actual.branchId, status: 'completed', actions: 40, redeals: 0 }], faults: [] }], summary: { interval: { groups: 0, difference: 0, lower: -1, upper: 1 }, aWins: 0, bWins: 0, completedGames: 1, contracts: {}, faults: {}, decisions: { actualModelCalls: 8, actualModelRetries: 3, requestDecisionCount: 5, unmeasuredRequestDecisions: 0, actualFallbacks: 0, nativeIllegal: 0, noActionFailures: 0, sources: {}, p50Ms: null, p95Ms: null }, note: '小样本不宣布牌力排序' } };
    vi.stubGlobal('fetch', vi.fn(async (path: string, init?: RequestInit) => {
        requests.push({ path, body: init?.body ? JSON.parse(String(init.body)) : undefined });
        if (path === '/api/engine-profiles')
            return new Response(JSON.stringify({ profiles: [profile] }));
        if (path === '/api/history/simulations' && init?.method === 'POST')
            return new Response(JSON.stringify(savedReport));
        if (path === '/api/history/simulations/run/cancel')
            return new Response(JSON.stringify({ ...savedReport, status: 'cancelled', summary: { ...savedReport.summary,
                decisions: { ...savedReport.summary.decisions, actualModelCalls: null, actualModelRetries: null, unmeasuredRequestDecisions: 1 } } }));
        if (path === '/api/history/simulations/run/resume')
            return new Response(JSON.stringify(savedReport));
        return new Response('[]');
    }));
    const client = new HistoryClient();
    vi.spyOn(client, 'matches').mockResolvedValue([]);
    const read = vi.spyOn(client, 'detail').mockResolvedValue(detail);
    const host = document.createElement('div');
    document.body.append(host);
    const root = createRoot(host);
    cleanup = async () => { await act(async () => root.unmount()); host.remove(); repo.close(); };
    await act(async () => root.render(React.createElement(GameHistoryModal, { onClose: vi.fn(), onResume: vi.fn(), client })));
    const click = async (label: string) => { const button = [...host.querySelectorAll('button')].find(item => item.textContent === label); expect(button, label).toBeDefined(); await act(async () => button!.click()); };
    await click('模拟对战');
    for (const seat of ['东', '南', '西', '北'])
        expect(host.querySelector(`[aria-label="模拟${seat}家配置"]`)).not.toBeNull();
    await click('开始换边批跑');
    const request = requests.find(item => item.path === '/api/history/simulations' && item.body)?.body;
    expect(request).toMatchObject({ mode: 'lifecycle', seats: Array(4).fill({ profileId: 'fast', version: profile.version }) });
    expect(host.textContent).toContain('取消批跑');
    expect(host.textContent).toContain('小样本不宣布牌力排序');
    expect(host.textContent).toContain('HTTP 请求 8 次');
    expect(host.textContent).toContain('重试 3 次');
    await click('取消批跑');
    expect(host.textContent).toContain('续跑未完成副牌');
    expect(host.textContent).toContain('HTTP 请求 未采集 次');
    expect(host.textContent).toContain('请求统计未采集 1 次');
    await click('续跑未完成副牌');
    expect(host.textContent).toContain('取消批跑');
    await click('打开第 1 组第 1 局复盘');
    expect(read).toHaveBeenCalledWith(detail.hand.handId);
    expect(host.querySelector('[aria-label="历史复盘"]')).not.toBeNull();
});
