/** 交互审查：使用真实牌桌验证查看暂停、背景输入与侧边面板布局。 */
import { test, expect } from '@playwright/test';

test('规则与设置打开时暂停，背景不可点击；关闭后不会自行恢复', async ({page}) => {
  await page.setViewportSize({width:1280,height:720});
  await page.goto('/');
  const run = page.getByRole('group',{name:'对局运行控制'});
  for (const [entry, label] of [['规则','游戏规则'],['打开设置','设置']]) {
    await run.getByRole('button',{name:'开始',exact:true}).click();
    await page.getByRole('button',{name:entry,exact:true}).click();
    const dialog = page.getByRole('dialog',{name:label,exact:true});
    await expect(dialog).toBeVisible();
    await expect(run.getByRole('button',{name:'开始',exact:true})).toHaveCount(1);
    expect(await page.getByLabel('对局牌桌',{exact:true}).evaluate(element => Boolean(element.closest('[inert]')))).toBe(true);
    expect(await dialog.evaluate(element => Boolean(element.closest('[inert]')))).toBe(false);
    await page.keyboard.press('Escape');
    await expect(dialog).toHaveCount(0);
    await expect(run.getByRole('button',{name:'开始',exact:true})).toBeVisible();
    expect(await page.getByLabel('对局牌桌',{exact:true}).evaluate(element => Boolean(element.closest('[inert]')))).toBe(false);
  }
});

test('手机横屏换皮肤不把弹窗插入顶栏挤走牌桌，关闭后返回原位置', async ({page}, info) => {
  await page.setViewportSize({width:844,height:390});
  await page.goto('/');
  const table = page.getByLabel('对局牌桌',{exact:true});
  const documentY = () => table.evaluate(element => element.getBoundingClientRect().y + element.closest('.game-content')!.scrollTop);
  const before = await documentY();
  await page.getByRole('button',{name:/换皮肤/}).click();
  const dialog = page.getByRole('dialog',{name:'皮肤选择'});
  await expect(dialog).toBeVisible();
  await dialog.evaluate(async element => { await Promise.all(element.getAnimations().map(animation => animation.finished)); });
  expect(await documentY()).toBeCloseTo(before,0);
  const modal = (await dialog.boundingBox())!; const hand = (await table.boundingBox())!;
  expect(modal.y).toBeGreaterThanOrEqual(hand.y + hand.height);
  await expect(dialog.getByRole('button',{name:'关闭皮肤选择'})).toBeInViewport();
  await expect(dialog.getByRole('button',{name:'就用这款',exact:true})).toBeInViewport();
  await page.screenshot({path:info.outputPath('mobile-skin-panel.png')});
  await page.keyboard.press('Escape');
  await expect(dialog).toHaveCount(0);
  await expect(page.getByRole('button',{name:/换皮肤/})).toBeFocused();
  await expect(table).toBeInViewport({ratio:1});
});


test.describe('触屏点击可靠性', () => {
  test.use({hasTouch:true});
  test('触屏动画推进按钮至少 44px，便于可靠点击', async ({page}) => {
    await page.setViewportSize({width:1280,height:720});
    await page.goto('/');
    const next = (await page.getByRole('button',{name:'继续展示下一步',exact:true}).boundingBox())!;
    expect(next.width).toBeGreaterThanOrEqual(44); expect(next.height).toBeGreaterThanOrEqual(44);
  });
  test('1280px 触屏手牌使用完整且不相交的点击区域', async ({page}) => {
    await page.setViewportSize({width:1280,height:720});
    await page.goto('/');
    const hand = page.getByLabel('你的手牌，共 12 张',{exact:true});
    const boxes = await Promise.all((await hand.getByRole('button').all()).map(card => card.boundingBox()));
    for (let i=0;i<boxes.length;i++) {
      expect(boxes[i]!.width).toBeGreaterThanOrEqual(44);
      for (let j=i+1;j<boxes.length;j++) {
        const a=boxes[i]!, b=boxes[j]!;
        expect(Math.min(a.x+a.width,b.x+b.width) <= Math.max(a.x,b.x) || Math.min(a.y+a.height,b.y+b.height) <= Math.max(a.y,b.y)).toBe(true);
      }
    }
  });
});
