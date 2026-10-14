/** 真实浏览器历史闭环：操作正式牌桌、真实 HTTP 与 SQLite，显式注入保存失败。 */
import { test, expect, type Page } from '@playwright/test';
import type { HistoryWrite, HandDetail } from '../../src/history/transport';
import type { DecisionRequest, DecisionResponse } from '../../src/ai/engines/decisionProtocol';

test.beforeEach(async ({ page }) => {
  // Debug 初始暂停，避免不受控自动推进；不注入完整牌局或私有测试接口。
  await page.addInitScript(() => localStorage.setItem('baoshan_debug_mode', 'true'));
});

async function saved(page: Page) {
  await expect(page.getByLabel('对局保存状态')).toHaveText('已保存');
}

async function dismissPresentations(page: Page) {
  const next = page.getByRole('button', { name: '继续展示下一步', exact: true });
  for (let count = 0; count < 8 && await next.isVisible(); count++) await next.click();
  await expect(next).toHaveCount(0);
}

async function openHistory(page: Page, matchId: string, handId: string) {
  await page.getByRole('button', { name: '对局历史', exact: true }).click();
  const modal = page.getByRole('dialog', { name: '对局历史' });
  await modal.locator(`button[data-history-id="${matchId}"]`).click();
  await modal.locator(`button[data-history-id="${handId}"]`).click();
  await expect(modal.getByRole('button', { name: '开始复盘', exact: true })).toBeVisible();
  return modal;
}

test('叫分、定主、扣底与出牌保存后，刷新仍可只读复盘并创建独立分支', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  const initialSave = page.waitForResponse(response => response.url().endsWith('/api/history/write') && response.ok());
  await page.goto('/');
  const packet = (await initialSave).request().postDataJSON() as HistoryWrite;
  expect(packet.hand).toBeDefined(); expect(packet.match).toBeDefined();
  if (!packet.hand?.handId || !packet.match?.matchId) throw new Error('首个保存请求缺少对局或副牌身份');
  const handId = packet.hand.handId; const matchId = packet.match.matchId;
  await saved(page); await dismissPresentations(page);
  await page.getByRole('button', { name: '叫 70 分', exact: true }).click();
  await dismissPresentations(page);
  for (let seat = 0; seat < 3; seat++) {
    await page.getByRole('group', { name: '直接叫分档位' }).getByRole('button', { name: '不叫', exact: true }).click();
    await dismissPresentations(page);
  }
  await page.getByRole('button', { name: /黑桃.*张/ }).click();
  await dismissPresentations(page);
  await page.getByRole('button', { name: '✨ 智能推荐扣底', exact: true }).click();
  await page.getByRole('button', { name: '确认扣底（4/4）', exact: true }).click();
  await dismissPresentations(page);
  const playSave = page.waitForResponse(response => response.url().endsWith('/api/history/write') &&
    response.ok() && (response.request().postDataJSON() as HistoryWrite).commit?.node.command.kind === 'play');
  const decision = page.waitForResponse(response => response.url().endsWith('/api/decision') && response.ok());
  await page.getByRole('button', { name: /AI 代走一步/ }).click();
  const decisionResponse = await decision;
  const request = decisionResponse.request().postDataJSON() as DecisionRequest;
  expect(request.phase).toBe('playing');
  expect(request.engineType).toBe('bridge');
  expect(request.profileId).toBe('default-bridge');
  const decisionResult = await decisionResponse.json() as DecisionResponse;
  expect(decisionResult.success).toBe(true);
  expect(decisionResult.action.kind).toBe('play');
  await playSave; await saved(page);

  const readDetail = async () => {
    const response = await page.request.get(`/api/history/hands/${handId}`);
    expect(response.ok()).toBe(true);
    return (await response.json() as { data: HandDetail }).data;
  };
  const original = await readDetail();
  expect(original.nodes.map(node => node.command.kind)).toEqual(['bid', 'bid', 'bid', 'bid', 'trump', 'bury', 'play']);
  await page.reload(); await saved(page);
  const modal = await openHistory(page, matchId, handId);
  await modal.getByRole('button', { name: '开始复盘', exact: true }).click();
  const replay = modal.getByRole('region', { name: '历史复盘' });
  await expect(replay.getByRole('heading', { name: '只读复盘 · 节点 0 / 7' })).toBeVisible();
  await replay.getByRole('button', { name: '最新记录', exact: true }).click();
  await expect(replay.getByRole('heading', { name: '只读复盘 · 节点 7 / 7' })).toBeVisible();
  await replay.getByRole('button', { name: '回到起点', exact: true }).click();
  expect((await readDetail()).nodes).toEqual(original.nodes);

  await replay.getByText('分支推演与独立续打', { exact: true }).click();
  await replay.getByLabel('分支名称', { exact: true }).fill('浏览器回归分支');
  await replay.getByRole('button', { name: '新建分支', exact: true }).click();
  await replay.getByLabel('分支叫分', { exact: true }).selectOption('75');
  await replay.getByRole('button', { name: '提交分支动作', exact: true }).click();
  await expect(replay.getByLabel('复盘路径').locator('option:checked')).toHaveText('浏览器回归分支');
  const branched = await readDetail();
  const actualId = original.branches.find(branch => branch.kind === 'actual')!.branchId;
  expect(branched.nodes.filter(node => node.branchId === actualId)).toEqual(original.nodes);
  expect(branched.branches.some(branch => branch.name === '浏览器回归分支')).toBe(true);
  const firstBid = original.nodes[0].command;
  if (firstBid.kind !== 'bid') throw new Error('原路径首个动作必须是叫分');
  expect(branched.nodes.filter(node => node.branchId !== actualId).map(node => node.command)).toEqual([
    { ...firstBid, bid: 75 },
  ]);
  expect(errors).toEqual([]);
});

test('保存请求明确失败时显示未保存，重试沿用原记录身份并可在历史中查询', async ({ page }) => {
  let failedPacket: HistoryWrite | undefined;
  await page.route('**/api/history/write', async route => {
    failedPacket ??= route.request().postDataJSON() as HistoryWrite;
    await route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ error: '显式注入保存失败' }) });
  });
  await page.goto('/');
  await expect(page.getByLabel('对局保存状态')).toHaveText('未保存');
  await expect(page.getByRole('button', { name: '重试保存', exact: true })).toBeVisible();
  expect(failedPacket?.hand).toBeDefined();
  if (!failedPacket?.hand?.handId || !failedPacket.match?.matchId) throw new Error('失败请求缺少对局或副牌身份');
  await page.unroute('**/api/history/write');
  const retried = page.waitForResponse(response => response.url().endsWith('/api/history/write') && response.ok());
  await page.getByRole('button', { name: '重试保存', exact: true }).click();
  expect((await retried).request().postDataJSON()).toEqual(failedPacket);
  await saved(page);
  const modal = await openHistory(page, failedPacket.match.matchId, failedPacket.hand.handId);
  await expect(modal.getByText('已保存动作：0', { exact: false })).toBeVisible();
});
