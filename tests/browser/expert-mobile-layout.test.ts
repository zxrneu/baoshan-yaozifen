/** 专家评审回归：手机四家分区、首屏节奏控制与座位入口触控边界。 */
import { test, expect } from '@playwright/test';

for (const viewport of [{ width: 844, height: 390 }, { width: 667, height: 375 }]) {
  for (const mode of ['Debug', '观战']) test(`${viewport.width}×${viewport.height} ${mode} 四家分区与主操作首屏可达`, async ({ page }) => {
    await page.setViewportSize(viewport);
    await page.addInitScript(() => localStorage.setItem('baoshan_debug_mode', 'true'));
    await page.goto('/');
    if (mode === '观战') await page.getByRole('button', { name: 'AI 接管本局（公开手牌）', exact: true }).click();
    const table = page.locator('[data-view]').filter({ has: page.locator('[data-seat-hand="0"]') });
    await expect(table).toBeVisible();
    await expect(table).toBeInViewport({ ratio: 1 });
    const panel = page.getByLabel(mode === '观战' ? '观战节奏控制' : '全功能上帝调试控制台', { exact: true });
    const next = mode === '观战' ? panel.getByRole('button', { name: '下一步', exact: true }) : panel.getByTitle('推进下一步 (快捷键 Space)', { exact: true });
    await expect(next).toBeInViewport({ ratio: 1 });
    if (mode === '观战') await expect(panel.getByRole('button', { name: '退出观战', exact: true })).toBeInViewport({ ratio: 1 });
    const regions = table.locator('[data-seat-hand]');
    await expect(regions).toHaveCount(4);
    const handBounds = [];
    for (const hand of await regions.all()) {
      await expect(hand).toBeInViewport({ ratio: 1 });
      const box = (await hand.boundingBox())!;
      handBounds.push(box);
      expect(box.width).toBeGreaterThanOrEqual(88);
      expect(box.height).toBeGreaterThanOrEqual(61);
      const card = hand.locator('button, [aria-label="暗牌"]').first();
      const cardBox = (await card.boundingBox())!;
      expect(cardBox.width).toBeGreaterThanOrEqual(44);
      expect(cardBox.height).toBeGreaterThanOrEqual(61);
    }
    for (let a = 0; a < handBounds.length; a++) for (let b = a + 1; b < handBounds.length; b++) {
      const x = handBounds[a], y = handBounds[b];
      expect(Math.min(x.x + x.width, y.x + y.width) <= Math.max(x.x, y.x) || Math.min(x.y + x.height, y.y + y.height) <= Math.max(x.y, y.y)).toBe(true);
    }
    for (const control of await table.locator('[data-seat-header] button:enabled').all()) {
      await expect(control).toBeInViewport({ ratio: 1 });
      const box = (await control.boundingBox())!;
      expect(box.width).toBeGreaterThanOrEqual(44);
      expect(box.height).toBeGreaterThanOrEqual(44);
    }
    await page.screenshot({ path: `output/playwright/expert-fixed-mobile-${mode === 'Debug' ? 'debug' : 'spectator'}-${viewport.width}.png` });
  });
}

test('触屏桌面四家座位入口均保留44px独立命中区', async ({ page }) => {
  test.skip(!await page.evaluate(() => matchMedia('(pointer: coarse)').matches), '只验证触屏命中尺寸');
  await page.setViewportSize({ width: 1280, height: 720 });
  await page.addInitScript(() => localStorage.setItem('baoshan_debug_mode', 'true'));
  await page.goto('/');
  for (const control of await page.locator('[data-seat-header] button:enabled').all()) {
    const box = (await control.boundingBox())!;
    expect(Math.min(box.width, box.height)).toBeGreaterThanOrEqual(44);
  }
});

test('手机四家手牌可独立滑动，拖动不选牌且当前墩不侵入手牌', async ({ page }, info) => {
  test.skip(!await page.evaluate(() => matchMedia('(pointer: coarse)').matches), '验证真实触屏拖动');
  await page.setViewportSize({ width: 667, height: 375 });
  await page.addInitScript(() => localStorage.setItem('baoshan_debug_mode', 'true'));
  await page.goto('/');
  async function finishPresentation() {
    const next = page.getByRole('button', { name: '继续展示下一步', exact: true });
    await expect(next).toBeVisible();
    for (let index = 0; index < 8 && await next.isVisible(); index++) await next.click();
    await expect(next).toHaveCount(0);
  }
  await finishPresentation();
  await expect(page.getByRole('button', { name: '叫 70 分', exact: true })).toBeInViewport({ ratio: 1 });
  await page.getByRole('button', { name: '叫 70 分', exact: true }).click(); await finishPresentation();
  for (let index = 0; index < 3; index++) {
    await page.getByRole('group', { name: '直接叫分档位' }).getByRole('button', { name: '不叫', exact: true }).click(); await finishPresentation();
  }
  for (const button of await page.getByLabel('当前玩家操作', { exact: true }).getByRole('button').all()) await expect(button).toBeInViewport({ ratio: 1 });
  await page.getByRole('button', { name: /黑桃.*张/ }).click(); await finishPresentation();
  await expect(page.getByRole('button', { name: '确认扣底（0/4）', exact: true })).toBeInViewport({ ratio: 1 });
  await page.getByRole('button', { name: '✨ 智能推荐扣底', exact: true }).click();
  await expect(page.getByRole('button', { name: '确认扣底（4/4）', exact: true })).toBeInViewport({ ratio: 1 });
  await page.getByRole('button', { name: '确认扣底（4/4）', exact: true }).click(); await finishPresentation();
  const hand = page.locator('[data-seat-hand="1"]');
  const bounds = (await hand.boundingBox())!;
  const touch = await page.context().newCDPSession(page);
  const x = bounds.x + bounds.width - 15, y = bounds.y + bounds.height / 2;
  await touch.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y }] });
  for (let distance = 15; distance <= 120; distance += 15) await touch.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: x - distance, y }] });
  await touch.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await expect.poll(() => hand.evaluate(element => element.scrollLeft)).toBeGreaterThan(20);
  await expect(hand.locator('[aria-pressed="true"]')).toHaveCount(0);
  await hand.getByRole('button').first().click();
  await expect(hand.getByRole('button').first()).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByRole('button', { name: /^出牌/ })).toBeInViewport({ ratio: 1 });
  await page.getByRole('button', { name: /^出牌/ }).click(); await finishPresentation();
  const trick = page.getByRole('group', { name: '当前墩牌张', exact: true });
  await expect(trick).toBeInViewport({ ratio: 1 });
  const card = (await trick.getByRole('button').first().boundingBox())!;
  for (const region of await page.locator('[data-seat-hand]').all()) {
    const area = (await region.boundingBox())!;
    expect(Math.min(area.x + area.width, card.x + card.width) <= Math.max(area.x, card.x) || Math.min(area.y + area.height, card.y + card.height) <= Math.max(area.y, card.y)).toBe(true);
  }
  await page.screenshot({ path: info.outputPath('mobile-playing-667.png') });
});

test('普通对局触屏的四家引擎入口均保留44px独立命中区', async ({ page }) => {
  test.skip(!await page.evaluate(() => matchMedia('(pointer: coarse)').matches), '只验证触屏命中尺寸');
  await page.addInitScript(() => localStorage.setItem('baoshan_debug_mode', 'true'));
  for (const viewport of [{ width: 1280, height: 720 }, { width: 667, height: 375 }]) {
    await page.setViewportSize(viewport);
    await page.goto('/');
    await page.getByRole('button', { name: '退出 Debug', exact: true }).click();
    for (const direction of ['东', '南', '西', '北']) {
      const control = page.getByRole('button', { name: `${direction}家当前引擎`, exact: true });
      const box = (await control.boundingBox())!;
      expect(Math.min(box.width, box.height), `${direction}家引擎入口`).toBeGreaterThanOrEqual(44);
    }
  }
});
