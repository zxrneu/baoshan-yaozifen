// @vitest-environment happy-dom
/** 短教学行为回归：通过真实选牌与提交验证反馈、规则边界和独立状态。 */
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it } from 'vitest';
import TutorialModal from '@yaozifen/web/components/TutorialModal';
import { CardInspectionContext } from '@yaozifen/web/components/cardInspection';

let root: Root;
let host: HTMLDivElement;
beforeEach(async () => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  host = document.createElement('div'); document.body.append(host); root = createRoot(host);
  // 活动牌桌可能处于观战；题目仍须可自主选择，不能继承牌桌的放大行为。
  await act(async () => root.render(React.createElement(TutorialHarness)));
});
afterEach(async () => { await act(async () => root.unmount()); host.remove(); });
function TutorialHarness() {
  const [open, setOpen] = React.useState(true);
  return React.createElement(CardInspectionContext.Provider, { value: { inspectOnly: true, inspect: () => {} } },
    open ? React.createElement(TutorialModal, { onClose: () => setOpen(false) })
      : React.createElement('button', { onClick: () => setOpen(true) }, '重新打开教学'));
}
function button(name: string) {
  const value = [...host.querySelectorAll<HTMLButtonElement>('button')].find(button => button.textContent?.trim() === name);
  expect(value, name).toBeDefined(); return value!;
}
function card(label: string) {
  const value = [...host.querySelectorAll<HTMLButtonElement>('[aria-label="题目手牌"] button')]
    .find(button => button.getAttribute('aria-label')?.startsWith(label));
  expect(value, label).toBeDefined(); return value!;
}
async function click(value: HTMLButtonElement) { await act(async () => value.click()); }
async function enterFollowing() {
  for (const label of ['A♠，10分', '10♥，10分', '5♦，5分']) await click(card(label));
  await click(button('确认分牌')); await click(button('下一段'));
}

it('分牌题选择 A、10、5 后仍须人工提交，成功反馈分值再进入跟门段', async () => {
  const submit = button('确认分牌');
  expect(submit.disabled).toBe(true);
  await click(card('A♠，10分')); await click(card('10♥，10分')); await click(card('5♦，5分'));
  expect(card('A♠，10分').getAttribute('aria-pressed')).toBe('true');
  expect(host.querySelector('[aria-label="教学进度"]')?.textContent).toContain('1 / 3');
  expect(button('下一段').disabled).toBe(true);
  await click(submit);
  expect(host.querySelector('[role="status"]')?.textContent).toContain('25 分');
  await click(button('下一段'));
  expect(host.querySelector('[aria-label="教学进度"]')?.textContent).toContain('2 / 3');
});

it('漏选或误选非分牌时留在原题并保留选择，纠正后可再次提交', async () => {
  await click(card('A♠，10分')); await click(card('10♥，10分'));
  await click(button('确认分牌'));
  expect(host.querySelector('[role="alert"]')).not.toBeNull();
  expect(button('下一段').disabled).toBe(true);
  expect(card('A♠，10分').getAttribute('aria-pressed')).toBe('true');
  await click(card('5♦，5分')); await click(card('K♣'));
  await click(button('确认分牌'));
  expect(host.querySelector('[role="alert"]')).not.toBeNull();
  expect(button('下一段').disabled).toBe(true);
  await click(card('K♣')); await click(button('确认分牌'));
  expect(host.querySelector('[role="alert"]')).toBeNull();
  expect(button('下一段').disabled).toBe(false);
});

it.each(['7♥', 'Q♥'])('有红桃时可跟任意同门 %s，异门和主牌都不可出且选牌不自动提交', async label => {
  await enterFollowing();
  const led = host.querySelector('[aria-label="公开领牌"]');
  expect(led).not.toBeNull(); expect(led?.textContent).toContain('9');
  expect(card('8♣').disabled).toBe(true);
  expect(card('2♦').disabled).toBe(true);
  expect(card('8♣').getAttribute('aria-label')).toContain('必须跟红桃');
  await click(card('8♣'));
  expect(button('确认出牌').disabled).toBe(true);
  await click(card(label));
  expect(card(label).getAttribute('aria-pressed')).toBe('true');
  expect(button('继续：缺门时').disabled).toBe(true);
  await click(button('确认出牌'));
  expect(host.querySelector('[role="status"]')?.textContent).toContain('跟红桃');
  expect(button('继续：缺门时').disabled).toBe(false);
});

it.each(['8♣', '2♦'])('没有红桃时既可出主牌也可垫牌，%s 确认后完成教学并可重新开始', async label => {
  await enterFollowing(); await click(card('7♥')); await click(button('确认出牌'));
  await click(button('继续：缺门时'));
  expect(host.querySelector('[aria-label="教学进度"]')?.textContent).toContain('3 / 3');
  expect(card('8♣').disabled).toBe(false); expect(card('2♦').disabled).toBe(false);
  expect(host.querySelector('[role="status"]')).toBeNull();
  expect(button('完成教学').disabled).toBe(true);
  await click(card(label));
  expect(button('完成教学').disabled).toBe(true);
  await click(button('确认出牌'));
  expect(host.querySelector('[role="status"]')?.textContent).toContain('没有红桃');
  await click(button('完成教学'));
  expect(host.querySelector('[aria-label="题目手牌"]')).toBeNull();
  expect(host.textContent).toContain('基础练习完成');
  await click(button('返回牌桌'));
  expect(host.querySelector('[role="dialog"]')).toBeNull();
  await click(button('重新打开教学'));
  expect(host.querySelector('[aria-label="教学进度"]')?.textContent).toContain('1 / 3');
  expect(button('确认分牌').disabled).toBe(true);
});

it('可跳过两段教学且不冒充练习完成，切换段落后焦点移到新标题', async () => {
  await click(button('跳过本段'));
  expect(host.querySelector('[aria-label="教学进度"]')?.textContent).toContain('2 / 3');
  expect(document.activeElement).toBe(host.querySelector('h2'));
  await click(button('跳过本段'));
  expect(host.textContent).toContain('已跳过部分题目');
  expect(host.textContent).not.toContain('基础练习完成');
  expect(document.activeElement).toBe(host.querySelector('h2'));
  await click(button('返回牌桌'));
  expect(host.querySelector('[role="dialog"]')).toBeNull();
});

it('按 Escape 可随时退出教学，重新进入从未作答的首题开始', async () => {
  await click(card('A♠，10分'));
  await act(async () => document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true })));
  expect(host.querySelector('[role="dialog"]')).toBeNull();
  await click(button('重新打开教学'));
  expect(button('确认分牌').disabled).toBe(true);
  expect(card('A♠，10分').getAttribute('aria-pressed')).toBe('false');
});
