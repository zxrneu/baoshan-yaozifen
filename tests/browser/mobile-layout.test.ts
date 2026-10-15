/** 手机首屏布局回归：检验真实矩形、方向遮罩与手牌点击。 */
import { test, expect } from '@playwright/test';

test.beforeEach(async ({ page }) => { await page.setViewportSize({ width: 844, height: 390 }); });
for (const mode of ['普通','Debug','观战']) test(`${mode} 动作展示在右侧，普通手牌与推进按钮同时可见`, async ({page}, info) => {
  await page.addInitScript(debug => localStorage.setItem('baoshan_debug_mode', String(debug)), mode!=='普通');
  await page.goto('/');
  if (mode==='观战') {
    await page.getByRole('button', {name:'AI 接管本局（公开手牌）',exact:true}).click();
    await page.getByRole('button', {name:'下一步',exact:true}).click();
  }
  // Debug 原有工作台在手机上可滚动，桌面始终检查右侧边界。
  if (mode!=='普通') await page.setViewportSize({width:1280,height:720});
  const table=page.getByLabel(mode==='普通' ? '对局牌桌' : '正方形上帝调试牌桌', {exact:true});
  const bounds=(await table.boundingBox())!;
  const action=page.getByLabel('动作展示', {exact:true});
  await expect(action).toBeVisible();
  const box=(await action.boundingBox())!;
  expect(box.x).toBeGreaterThanOrEqual(bounds.x+bounds.width);
  await expect(action.getByRole('button', {name:'继续展示下一步',exact:true})).toBeInViewport({ratio:1});
  if (mode==='普通') for (const card of await table.getByLabel('你的手牌，共 12 张', {exact:true}).getByRole('button').all()) {
    await expect(card).toBeInViewport({ratio:1});
  }
  await page.screenshot({path:info.outputPath(`sidebar-action-${mode}.png`)});
});
for (const query of ['', '?phase=bury', '?revealed']) {
  test(`844×390 手动操作和全部手牌位于首屏 ${query}`, async ({ page }) => {
    await page.goto(`/tests/fixtures/mobile-table.html${query}`);
    const table = page.getByLabel('牌桌', { exact: true });
    await expect(table).toBeVisible();
    const cards = page.getByLabel('我的手牌').getByRole('button');
    await expect(cards.first()).toBeVisible();
    const bounds = await table.boundingBox();
    expect(bounds!.y + bounds!.height).toBeLessThanOrEqual(390);
    for (const element of await page.getByLabel('对局操作', { exact: true }).locator('button').all()) {
      await expect(element).toBeInViewport({ ratio: 1 });
    }
    for (const element of await cards.all()) await expect(element).toBeInViewport({ ratio: 1 });
    if (!query.includes('bury')) {
      await cards.first().click();
      await expect(cards.first()).toHaveAttribute('aria-pressed', 'true');
    }
  });
}

test('竖屏提示横屏且保留选牌状态，恢复横屏后可继续操作', async ({ page }) => {
  await page.goto('/tests/fixtures/mobile-table.html');
  const card = page.getByLabel('我的手牌').getByRole('button').first();
  await card.click();
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.getByText('请横屏')).toBeVisible();
  expect(await page.getByLabel('横屏游戏区域').evaluate(element => Math.abs(new DOMMatrixReadOnly(getComputedStyle(element).transform).b))).toBe(0);
  await page.setViewportSize({ width: 844, height: 390 });
  await expect(page.getByText('请横屏')).toBeHidden();
  await expect(card).toHaveAttribute('aria-pressed', 'true');
});

test('北家决策气泡向桌内展开，避开顶栏和庄家信息', async ({ page }) => {
  await page.goto('/tests/fixtures/mobile-table.html');
  await page.getByRole('button', { name: '显示决策结论' }).click();
  const bubble = page.getByText('💡 决策结论').locator('..').locator('..');
  const bubbleBounds = await bubble.boundingBox();
  const header = await page.getByLabel('牌桌顶栏').boundingBox();
  const hud = await page.getByText('西家坐庄 · 95 分', { exact: true }).boundingBox();
  expect(bubbleBounds!.y).toBeGreaterThanOrEqual(header!.y + header!.height);
  expect(bubbleBounds!.y).toBeGreaterThanOrEqual(hud!.y + hud!.height);
});

test('正式牌桌叫分、扣底后回到手机横屏，全部手牌和出牌按钮无需滚动', async ({ page }, info) => {
  await page.addInitScript(() => localStorage.setItem('baoshan_debug_mode', 'true'));
  await page.goto('/');
  async function finishPresentation() {
    await expect(page.getByRole('button', {name:'继续展示下一步',exact:true})).toBeVisible();
    const next = page.getByRole('button', { name: '继续展示下一步', exact: true });
    for (let index = 0; index < 8 && await next.isVisible(); index++) await next.click();
    await expect(next).toHaveCount(0);
  }
  await finishPresentation();
  await page.getByRole('button', { name: '叫 70 分', exact: true }).click(); await finishPresentation();
  for (let index = 0; index < 3; index++) {
    await page.getByRole('group', { name: '直接叫分档位' }).getByRole('button', { name: '不叫', exact: true }).click(); await finishPresentation();
  }
  await page.getByRole('button', { name: /黑桃.*张/ }).click(); await finishPresentation();
  await page.getByRole('button', { name: '✨ 智能推荐扣底', exact: true }).click();
  await page.getByRole('button', { name: '确认扣底（4/4）', exact: true }).click(); await finishPresentation();
  await page.getByRole('button', { name: '退出 Debug', exact: true }).click();
  const table = page.getByLabel('对局牌桌', { exact: true });
  const cards = table.locator('button[aria-pressed]');
  await expect(cards).toHaveCount(12);
  for (const card of await cards.all()) await expect(card).toBeInViewport({ ratio: 1 });
  await expect(page.getByRole('button', { name: '选择一张牌', exact: true })).toBeInViewport({ ratio: 1 });
  await cards.first().click();
  await expect(cards.first()).toHaveAttribute('aria-pressed', 'true');
  await page.screenshot({ path: info.outputPath('mobile-table.png') });
});
