/** 真实异步视图的交互测试等待：持续刷新 React，直至用户可见的加载状态结束。 */
import { act } from 'react';
import { setTimeout as delay } from 'node:timers/promises';

function loading() {
  return document.querySelector('[role="dialog"][aria-label="加载中"]')
    || [...document.querySelectorAll('[role="status"]')].find(element => element.textContent === '正在加载调试面板…');
}
export async function actAndLoad(callback: () => unknown | Promise<unknown>): Promise<void> {
  await act(async () => { await callback(); });
  for (let attempt = 0; attempt < 200 && loading(); attempt++) {
    await act(async () => { await delay(10); });
  }
  if (loading()) throw new Error('实际视图未能结束按需加载');
}
