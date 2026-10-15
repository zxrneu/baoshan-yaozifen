/** 触屏命中回归：采样真实牌面边缘并发出坐标点击，不以按钮矩形代替热区验证。 */
import { test, expect } from '@playwright/test';

test.use({ hasTouch: true, viewport: { width: 844, height: 390 } });

for (const phase of ['playing', 'bury'] as const) {
  for (const instant of phase === 'playing' ? [false, true] : [false]) {
  for (const selected of [false, true]) test(`${phase} ${instant ? '点牌即出' : '确认出牌'} ${selected ? '已选牌' : '未选牌'}时，牌面边缘与角标均命中本牌`, async ({ page }) => {
    await page.goto(`/tests/fixtures/expert-touch-hand.html?${phase === 'bury' ? 'bury&' : ''}${instant ? 'instant&' : ''}${selected ? 'selected' : ''}`);
    const cards = page.getByLabel(`你的手牌，共 ${phase === 'bury' ? 16 : 12} 张`, { exact: true }).getByRole('button');
    await expect(cards).toHaveCount(phase === 'bury' ? 16 : 12);
    await expect(cards.last()).toBeInViewport({ ratio: 1 });
    for (const card of await cards.all()) {
      const box = (await card.boundingBox())!;
      expect(Math.min(box.width, box.height)).toBeGreaterThanOrEqual(44);
    }
    const missed = await cards.evaluateAll(elements => elements.flatMap(element => {
      const rect = element.getBoundingClientRect();
      const samples = [[1, rect.height / 2], [rect.width - 1, rect.height / 2],
        [rect.width / 2, 1], [rect.width / 2, rect.height - 1], [rect.width / 2, rect.height / 2],
        [8, 8], [rect.width - 8, 8], [8, rect.height - 8], [rect.width - 8, rect.height - 8]];
      return samples.flatMap(([x, y]) => {
        const hit = document.elementFromPoint(rect.x + x, rect.y + y)?.closest('button');
        return hit === element ? [] : [{ card: element.getAttribute('aria-label'), x, y, hit: hit?.getAttribute('aria-label') }];
      });
    }));
    expect(missed).toEqual([]);
    const target = cards.filter({ hasNot: page.locator('[aria-label="主牌"]') }).locator(':scope[aria-pressed]').first();
    const box = (await target.boundingBox())!;
    const label = (await target.getAttribute('aria-label'))!;
    const rank = label.match(/^(A|K|Q|10)/)![0];
    const suit = ({ '♠': 'S', '♥': 'H', '♣': 'C', '♦': 'D' } as const)[label.charAt(rank.length) as '♠' | '♥' | '♣' | '♦'];
    await page.touchscreen.tap(box.x + box.width - 1, box.y + box.height / 2);
    await expect(page.getByLabel('实际点击牌', { exact: true })).toHaveText(`${rank}${suit}`);
  });
  }
}
