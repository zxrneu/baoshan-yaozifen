/** 观战工具行几何与交互回归：使用真实浏览器验证紧凑按钮、触控尺寸与独立操作。 */
import { test, expect } from '@playwright/test';

test('观战工具行在桌面与横屏紧凑排列，音效和退出不再横贯侧栏', async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('baoshan_debug_mode', 'true'));
  for (const viewport of [{ width: 1920, height: 1080 }, { width: 1280, height: 720 }, { width: 844, height: 390 }]) {
    await page.setViewportSize(viewport);
    await page.goto('/');
    await page.getByRole('button', { name: '观看 AI 对局', exact: true }).click();
    const panel = page.getByLabel('观战节奏控制', { exact: true });
    const toolbar = panel.getByRole('group', { name: '观战操作', exact: true });
    await toolbar.scrollIntoViewIfNeeded();
    const bounds = (await toolbar.boundingBox())!;
    const sound = toolbar.getByRole('button', { name: '观战音效', exact: true });
    const exit = toolbar.getByRole('button', { name: '退出观战', exact: true });
    const soundBox = (await sound.boundingBox())!;
    const exitBox = (await exit.boundingBox())!;
    expect(Math.abs(soundBox.y - exitBox.y)).toBeLessThan(1);
    expect(soundBox.x + soundBox.width).toBeLessThanOrEqual(exitBox.x);
    for (const control of await toolbar.locator('button, select').all()) {
      const box = (await control.boundingBox())!;
      expect(box.height).toBeGreaterThanOrEqual(44);
      expect(box.width).toBeLessThan(160);
      expect(box.x).toBeGreaterThanOrEqual(bounds.x);
      expect(box.x + box.width).toBeLessThanOrEqual(bounds.x + bounds.width);
    }
    const previous = await sound.getAttribute('aria-pressed');
    await sound.click();
    await expect(sound).toHaveAttribute('aria-pressed', previous === 'true' ? 'false' : 'true');
    await toolbar.getByLabel('观看速度', { exact: true }).selectOption('slow');
    await expect(toolbar.getByLabel('观看速度', { exact: true })).toHaveValue('slow');
    await page.screenshot({ path: `output/ui-review/spectator-toolbar-${viewport.width}.png` });
    await exit.click();
    await expect(panel).toHaveCount(0);
    await expect(page.getByRole('button', { name: '开始', exact: true })).toBeVisible();
  }
});
