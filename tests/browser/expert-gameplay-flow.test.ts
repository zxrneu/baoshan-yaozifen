/** 专家评审流程回归：人工选牌后交给 AI，单步应继续当前局且保持暂停。 */
import { test, expect } from '@playwright/test';

test('Debug 非行动明牌可用 Enter 与空格查看，关闭后焦点返回原牌', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 720 });
  await page.addInitScript(() => localStorage.setItem('baoshan_debug_mode', 'true'));
  await page.goto('/');
  await page.getByRole('button', { name: '查看东家手牌', exact: true }).click();
  const card = page.locator('[data-seat-hand="0"] button').first();
  for (const key of ['Enter', 'Space']) {
    await card.focus();
    await page.keyboard.press(key);
    const dialog = page.getByRole('dialog', { name: '查看牌张', exact: true });
    await expect(dialog).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(dialog).toHaveCount(0);
    await expect(card).toBeFocused();
  }
});

test('人工已选牌进入观战，下一步仍能完成一次出牌并保持暂停', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 720 });
  await page.addInitScript(() => localStorage.setItem('baoshan_debug_mode', 'true'));
  await page.goto('/');
  async function finishPresentation() {
    const next = page.getByRole('button', { name: '继续展示下一步', exact: true });
    await expect(next).toBeVisible();
    for (let index = 0; index < 8 && await next.isVisible(); index++) await next.click();
    await expect(next).toHaveCount(0);
  }
  await finishPresentation();
  await page.getByRole('button', { name: '叫 70 分', exact: true }).click(); await finishPresentation();
  for (let index = 0; index < 3; index++) {
    await page.getByRole('group', { name: '直接叫分档位' }).getByRole('button', { name: '不叫', exact: true }).click();
    await finishPresentation();
  }
  await page.getByRole('button', { name: /黑桃.*张/ }).click(); await finishPresentation();
  await page.getByRole('button', { name: '✨ 智能推荐扣底', exact: true }).click();
  await page.getByRole('button', { name: '确认扣底（4/4）', exact: true }).click(); await finishPresentation();
  await page.getByRole('button', { name: '退出 Debug', exact: true }).click();
  const hand = page.getByLabel('你的手牌，共 12 张', { exact: true });
  const blockedCenters = await hand.locator('button').evaluateAll(cards => cards.flatMap(card => {
    const box = card.getBoundingClientRect();
    const target = document.elementFromPoint(box.x + box.width / 2, box.y + box.height / 2)?.closest('button');
    return target === card ? [] : [{ card: card.getAttribute('aria-label'), hit: target?.getAttribute('aria-label') ?? null }];
  }));
  expect(blockedCenters, '所有普通手牌中心均应命中本牌').toEqual([]);
  await hand.locator('button[aria-pressed]').first().click();
  await expect(hand.locator('[aria-pressed="true"]')).toHaveCount(1);
  await page.getByRole('button', { name: 'AI 接管本局（公开手牌）', exact: true }).click();
  const panel = page.getByLabel('观战节奏控制', { exact: true });
  await panel.getByRole('button', { name: '下一步', exact: true }).click();
  await finishPresentation();
  await expect(page.locator('[data-seat-hand="1"] button')).toHaveCount(11);
  await expect(page.getByRole('button', { name: '开始', exact: true })).toHaveAttribute('aria-pressed', 'false');
  await expect(page.getByRole('group', { name: '当前墩牌张', exact: true }).getByRole('button')).toHaveCount(1);
  await panel.getByRole('button', { name: '退出观战', exact: true }).click();
  await expect(page.getByLabel('你的手牌，共 11 张', { exact: true }).locator('[aria-pressed="true"]')).toHaveCount(0);
});
