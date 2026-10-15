/** 桌面几何回归：验证正方形、信息常驻、侧边弹窗和牌面居中，不以源码样式代替实际矩形。 */
import { test, expect } from '@playwright/test';

test.beforeEach(async ({ page }) => { await page.setViewportSize({width:1920,height:1080}); });

test('各尺寸和四座旋转的中央花色居中，且不与点数、分值和底牌标记相交', async ({page}) => {
  await page.goto('/tests/fixtures/card-layout.html');
  for (const example of await page.locator('[data-example]').all()) {
    const card = example.getByRole('button');
    const bounds = (await card.boundingBox())!;
    const pip = (await card.locator('[class*="pip"]').boundingBox())!;
    expect(Math.abs(pip.x + pip.width / 2 - bounds.x - bounds.width / 2)).toBeLessThan(1);
    expect(Math.abs(pip.y + pip.height / 2 - bounds.y - bounds.height / 2)).toBeLessThan(1);
    for (const marker of await card.locator('[class*="corner"], [class*="ptsBadge"], [class*="kittyFlag"], [class*="trumpFlag"]').all()) {
      if (!await marker.isVisible()) continue;
      const box = (await marker.boundingBox())!;
      const overlapWidth = Math.min(pip.x + pip.width, box.x + box.width) - Math.max(pip.x, box.x);
      const overlapHeight = Math.min(pip.y + pip.height, box.y + box.height) - Math.max(pip.y, box.y);
      expect(overlapWidth <= 0 || overlapHeight <= 0, `${await example.getAttribute('data-example')}：花色与 ${await marker.textContent()} 重叠（${overlapWidth.toFixed(2)} × ${overlapHeight.toFixed(2)}）`).toBe(true);
    }
  }
});

test('桌面普通对局的牌桌为正方形，右侧直接显示公开信息', async ({page}) => {
  await page.addInitScript(() => localStorage.setItem('baoshan_debug_mode', 'true'));
  await page.goto('/');
  await page.getByRole('button', {name:'退出 Debug',exact:true}).click();
  const bounds = (await page.getByLabel('对局牌桌', {exact:true}).boundingBox())!;
  expect(Math.abs(bounds.width - bounds.height)).toBeLessThan(1);
  const side = page.getByLabel('对局工具栏');
  await expect(side.getByLabel('当前行动')).toBeVisible();
  await expect(side.getByLabel('对局记录', {exact:true})).toBeVisible();
});

for (const width of [1920, 1280]) test(`${width}px 普通牌桌沿用 Debug 的桌沿朝向，南家信息居中且手牌不被操作栏遮挡`, async ({page}) => {
  await page.setViewportSize({width, height:width === 1280 ? 720 : 1080});
  await page.addInitScript(() => localStorage.setItem('baoshan_debug_mode', 'true'));
  await page.goto('/');
  await page.getByRole('button', {name:'退出 Debug',exact:true}).click();
  const table = page.getByLabel('对局牌桌', {exact:true});
  const bounds = (await table.boundingBox())!;
  for (const name of ['东', '西']) {
    const engine = (await table.getByRole('button', {name:`${name}家当前引擎`,exact:true}).boundingBox())!;
    expect(engine.height, `${name}家信息应沿侧边旋转`).toBeGreaterThan(engine.width);
    expect(engine.x >= bounds.x && engine.x + engine.width <= bounds.x + bounds.width).toBe(true);
  }
  const south = (await table.getByRole('button', {name:'南家当前引擎',exact:true}).boundingBox())!;
  expect(Math.abs(south.x + south.width / 2 - bounds.x - bounds.width / 2)).toBeLessThan(2);
  const controls = (await page.getByLabel('对局操作', {exact:true}).boundingBox())!;
  expect(controls.x).toBeGreaterThanOrEqual(bounds.x+bounds.width);
  for (const card of await table.getByLabel('你的手牌，共 12 张', {exact:true}).getByRole('button').all()) {
    const box = (await card.boundingBox())!;
    expect(box.y).toBeGreaterThanOrEqual(bounds.y);
    expect(box.y + box.height).toBeLessThanOrEqual(bounds.y + bounds.height);
  }
  await expect(table.getByLabel('暗牌', {exact:true})).toHaveCount(9);
});

for (const width of [1920,1280]) test(`${width}px 普通对局充分利用信息栏宽度，鼠标手牌单行且触屏牌位完整`, async ({page}, info) => {
  await page.setViewportSize({width,height:width === 1280 ? 720 : 1080});
  await page.addInitScript(() => localStorage.setItem('baoshan_debug_mode', 'true'));
  await page.goto('/');
  await page.getByRole('button', {name:'退出 Debug',exact:true}).click();
  const side = page.getByLabel('对局工具栏');
  const box = (await side.boundingBox())!;
  for (const label of ['本副战况', '对局工具']) {
    const content = (await side.getByLabel(label, {exact:true}).boundingBox())!;
    expect(content.width / box.width, `${label} 充分使用侧栏宽度`).toBeGreaterThan(.95);
  }
  const hand = page.getByLabel('你的手牌，共 12 张', {exact:true});
  const cards = await hand.getByRole('button').all();
  expect(cards).toHaveLength(12);
  const positions = await Promise.all(cards.map(card => card.boundingBox()));
  if (await page.evaluate(() => matchMedia('(pointer: fine)').matches)) {
    expect(Math.max(...positions.map(box => box!.y)) - Math.min(...positions.map(box => box!.y))).toBeLessThan(1);
  } else {
    for (let i=0;i<positions.length;i++) for (let j=i+1;j<positions.length;j++) {
      const a=positions[i]!, b=positions[j]!;
      expect(Math.min(a.x+a.width,b.x+b.width) <= Math.max(a.x,b.x) || Math.min(a.y+a.height,b.y+b.height) <= Math.max(a.y,b.y)).toBe(true);
    }
  }
  await page.screenshot({path:info.outputPath('normal-dashboard.png')});
});

for (const bid of [70, 100]) test(`${bid} 分扣底后普通牌桌的明暗牌、操作和侧边弹窗各有独立空间`, async ({page}, info) => {
  await page.setViewportSize({width:1280, height:720});
  await page.addInitScript(() => localStorage.setItem('baoshan_debug_mode', 'true'));
  await page.goto('/');
  async function finishPresentation() {
    await expect(page.getByRole('button', {name:'继续展示下一步',exact:true})).toBeVisible();
    const next = page.getByRole('button', {name:'继续展示下一步',exact:true});
    for (let index=0;index<8 && await next.isVisible();index++) await next.click();
    await expect(next).toHaveCount(0);
  }
  await finishPresentation();
  await page.getByRole('button', {name:`叫 ${bid} 分`,exact:true}).click();
  await finishPresentation();
  for (let index=0;index<3;index++) {
    await page.getByRole('group', {name:'直接叫分档位'}).getByRole('button', {name:'不叫',exact:true}).click();
    await finishPresentation();
  }
  await page.getByRole('button', {name:/黑桃.*张/}).click();
  await finishPresentation();
  await page.getByRole('button', {name:'退出 Debug',exact:true}).click();
  const kittyReveal = page.getByRole('dialog', {name:'庄家摸底揭晓',exact:true});
  if (await kittyReveal.isVisible()) await page.keyboard.press('Escape');
  const buryTable = (await page.getByLabel('对局牌桌', {exact:true}).boundingBox())!;
  const buryControls = (await page.getByLabel('对局操作', {exact:true}).boundingBox())!;
  expect(buryControls.x).toBeGreaterThanOrEqual(buryTable.x+buryTable.width);
  for (const card of await page.getByLabel('你的手牌，共 16 张', {exact:true}).getByRole('button').all()) {
    const box = (await card.boundingBox())!;
    expect(box.y).toBeGreaterThanOrEqual(buryTable.y);
    expect(box.y+box.height).toBeLessThanOrEqual(buryTable.y+buryTable.height);
  }
  await page.getByRole('button', {name:'✨ 智能推荐扣底',exact:true}).click();
  await page.getByRole('button', {name:'确认扣底（4/4）',exact:true}).click();
  await finishPresentation();
  const table = page.getByLabel('对局牌桌', {exact:true});
  await expect(table.getByLabel('暗牌', {exact:true})).toHaveCount(bid === 100 ? 10 : 13);
  await expect(table.getByLabel('北家明牌，所有人可见', {exact:true})).toHaveCount(bid === 100 ? 1 : 0);
  const bounds = (await table.boundingBox())!;
  const controls = (await page.getByLabel('对局操作', {exact:true}).boundingBox())!;
  expect(controls.x).toBeGreaterThanOrEqual(bounds.x+bounds.width);
  for (const card of await table.getByRole('button').filter({has:page.locator('svg path')}).all()) {
    const box = (await card.boundingBox())!;
    expect(box.x).toBeGreaterThanOrEqual(bounds.x);
    expect(box.y).toBeGreaterThanOrEqual(bounds.y);
    expect(box.x + box.width).toBeLessThanOrEqual(bounds.x + bounds.width);
    expect(box.y + box.height).toBeLessThanOrEqual(bounds.y + bounds.height);
    expect(Math.min(box.x+box.width,controls.x+controls.width) <= Math.max(box.x,controls.x)
      || Math.min(box.y+box.height,controls.y+controls.height) <= Math.max(box.y,controls.y)).toBe(true);
  }
  await page.screenshot({path:info.outputPath(`normal-playing-${bid}.png`)});
  await page.getByRole('button', {name:'打开设置',exact:true}).click();
  const dialog = page.getByRole('dialog', {name:'设置',exact:true});
  await expect(dialog).toBeVisible();
  await dialog.evaluate(async element => {await Promise.all(element.getAnimations().map(animation => animation.finished));});
  expect((await dialog.boundingBox())!.x).toBeGreaterThanOrEqual(bounds.x+bounds.width);
});

test('观战的战况、行动与记录常驻右侧，四家牌桌保持正方形', async ({page}, info) => {
  await page.addInitScript(() => localStorage.setItem('baoshan_debug_mode', 'true'));
  await page.goto('/');
  await page.getByRole('button', {name:'AI 接管本局（公开手牌）',exact:true}).click();
  const side = page.getByLabel('观战节奏控制', {exact:true});
  await expect(page.getByRole('group', {name:'对局运行控制'}).getByRole('button', {name:'开始',exact:true})).toBeVisible();
  for (const name of ['本副战况', '当前行动', '对局记录']) await expect(side.getByLabel(name, {exact:true})).toBeVisible();
  const table = (await page.getByLabel('正方形上帝调试牌桌', {exact:true}).boundingBox())!;
  expect(Math.abs(table.width - table.height)).toBeLessThan(1);
  await page.screenshot({path:info.outputPath('spectator-dashboard.png')});
});

test('使用自定义外框的摸底提示也停靠侧边，不遮挡牌桌', async ({page}) => {
  await page.goto('/tests/fixtures/mobile-table.html?phase=bury&kitty');
  const dialog = page.getByRole('dialog', {name:'庄家摸底揭晓', exact:true});
  await expect(dialog).toBeVisible();
  await dialog.evaluate(async element => { await Promise.all(element.getAnimations().map(animation => animation.finished)); });
  const panel = (await dialog.boundingBox())!;
  const table = (await page.getByLabel('牌桌', {exact:true}).boundingBox())!;
  expect(panel.x).toBeGreaterThanOrEqual(table.x + table.width);
  await page.keyboard.press('Escape');
  await expect(dialog).toHaveCount(0);
});

for (const width of [1920, 1280]) test(`${width}px Debug 诊断信息同时可读，常用弹窗在侧边且不遮挡四家手牌`, async ({page}, info) => {
  await page.setViewportSize({width, height: width === 1280 ? 720 : 1080});
  await page.addInitScript(() => localStorage.setItem('baoshan_debug_mode', 'true'));
  await page.goto('/');
  const next = page.getByRole('button', {name:'继续展示下一步',exact:true});
  await expect(next).toBeVisible();
  for (let i=0; i<8 && await next.isVisible(); i++) await next.click();
  const tableBounds = (await page.getByLabel('正方形上帝调试牌桌', {exact:true}).boundingBox())!;
  expect(tableBounds.y + tableBounds.height).toBeLessThanOrEqual(page.viewportSize()!.height);
  for (const label of ['思维推演', '候选比选', '历史追溯']) {
    const section = page.getByLabel(label, {exact:true});
    await expect(section).toBeVisible();
    await expect(section.locator(':scope > div').first()).toBeInViewport({ratio:1});
  }
  await expect(page.getByRole('tab')).toHaveCount(0);
  await page.screenshot({path:info.outputPath('debug-dashboard.png')});
  for (const [open, label] of [['新手教学', '新手教学'], ['⚙️ 引擎参数设置', '设置'], ['对局历史', '对局历史']]) {
    await page.getByRole('button', {name:open,exact:true}).click();
    const dialog = page.getByRole('dialog', {name:label,exact:true});
    await expect(dialog).toBeVisible();
    await dialog.evaluate(async element => { await Promise.all(element.getAnimations().map(animation => animation.finished)); });
    const panel = (await dialog.boundingBox())!;
    const table = (await page.getByLabel('正方形上帝调试牌桌', {exact:true}).boundingBox())!;
    expect(panel.x, `${open} 应完全位于牌桌右侧`).toBeGreaterThanOrEqual(table.x + table.width);
    for (const hand of await page.locator('[data-seat-hand]').all()) {
      const box = (await hand.boundingBox())!;
      const x = Math.min(panel.x + panel.width, box.x + box.width) - Math.max(panel.x, box.x);
      const y = Math.min(panel.y + panel.height, box.y + box.height) - Math.max(panel.y, box.y);
      expect(x <= 0 || y <= 0, `${open} 遮挡手牌`).toBe(true);
    }
    await page.keyboard.press('Escape');
    await expect(dialog).toHaveCount(0);
  }
});
