// @vitest-environment happy-dom
/** 开发者设置交互回归：挂载完整 App，验证入口、透视生命周期与规则明牌；只替换外部请求。 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { Storage } from 'happy-dom';
import App from '../src/App';
import { defaultEngineManager, decisionLogger, thinkingService } from '../src/ai/engines';
import { soundManager } from '../src/audio/soundManager';

let host: HTMLDivElement;
let root: Root;

function button(name: string | RegExp, scope: ParentNode = host): HTMLButtonElement {
  const matches = [...scope.querySelectorAll('button')].filter(element => {
    const label = element.getAttribute('aria-label') ?? element.textContent?.trim() ?? '';
    return typeof name === 'string' ? label === name : name.test(label);
  });
  expect(matches, `应有一个按钮：${String(name)}`).toHaveLength(1);
  return matches[0];
}

async function click(name: string | RegExp, scopeSelector?: string): Promise<void> {
  const scope = scopeSelector ? host.querySelector(scopeSelector) : host;
  expect(scope).not.toBeNull();
  await act(async () => { button(name, scope ?? host).click(); });
  // 每次规则动作后逐项确认展示，避免测试绕过真实推进屏障。
  while (host.querySelector('[aria-label="动作展示"]')) {
    await act(async () => { button('继续展示下一步').click(); });
  }
}

async function openDeveloperSettings(): Promise<void> {
  await click('打开设置');
  await click('🛠️ 开发者选项');
}

async function enterDebug(): Promise<void> {
  await openDeveloperSettings();
  await click('🎮 开启调试模式');
  await click('完成');
}

async function exitDebug(): Promise<void> {
  await click('⚙️ 引擎参数设置');
  // 状态清理测试独立于快捷入口落错页，旧版也能走到关闭动作。
  await click('🛠️ 开发者选项');
  await click('🛠️ 关闭调试模式');
  await click('完成');
}

function peekCount(): number {
  const main = host.querySelector('main[aria-label="对局牌桌"]');
  expect(main).not.toBeNull();
  return main?.textContent?.match(/👀透视/g)?.length ?? 0;
}

async function enablePeekPermission(): Promise<void> {
  const checkbox = host.querySelector<HTMLInputElement>('#godModeCheck');
  expect(checkbox).not.toBeNull();
  await act(async () => { checkbox?.click(); });
  await click('💾 保存并应用配置');
}

beforeEach(async () => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  // Node 新版的同名属性可能遮蔽 DOM 存储；每个用例显式使用隔离的内存存储。
  vi.stubGlobal('localStorage', new Storage());
  vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('交互回归禁止访问外部服务'); }));
  vi.spyOn(Date, 'now').mockReturnValue(20261012);
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
  window.localStorage.clear();
  defaultEngineManager.setUseServerDecision(false);
  defaultEngineManager.setActiveType('bridge');
  decisionLogger.clear();
  thinkingService.clear();
  soundManager.setMuted(true);
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
  await act(async () => { root.render(React.createElement(App)); });
});

afterEach(async () => {
  await act(async () => { root.unmount(); });
  host.remove();
  window.localStorage.clear();
  vi.clearAllTimers();
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('开发者设置的完整页面交互', () => {
  it('玩家页用打法描述，不把引擎名称包装为未经评测的强度等级', async () => {
    await click('打开设置');
    const modal = host.querySelector('.modal-box');
    expect(modal?.textContent).not.toMatch(/大师|高手|不失误|接近桥牌专家/);
    expect(modal?.textContent).not.toMatch(/openai_api_base|API 密钥|reasoning_effort/);
  });

  it('全明手在开发者设置中可开启与关闭，普通工具栏仍不暴露工程入口', async () => {
    await openDeveloperSettings();
    await enablePeekPermission();
    expect(button(/^👀 全明手/).disabled).toBe(false);
    await click(/^👀 全明手/);
    await click('完成');
    expect(peekCount()).toBe(3);
    expect(host.querySelector('nav')?.textContent).not.toMatch(/全明手|决策日志|AI 引擎/);
    await openDeveloperSettings();
    expect(button(/^👀 全明手/).getAttribute('aria-pressed')).toBe('true');
    await click(/^👀 全明手/);
    await click('完成');
    expect(peekCount()).toBe(0);
  });

  it('工作台的引擎参数入口直接落到开发者页，重开普通设置仍落到玩家页', async () => {
    await enterDebug();
    await click('⚙️ 引擎参数设置');
    expect(button('🛠️ 开发者选项').getAttribute('aria-selected')).toBe('true');
    await click('🛠️ 关闭调试模式');
    await click('完成');
    await click('打开设置');
    expect(button('玩家设置').getAttribute('aria-selected')).toBe('true');
  });

  it('进入再关闭调试不会把临时透视权限或明手带回普通牌桌', async () => {
    await enterDebug();
    expect(host.querySelector('[aria-label="正方形上帝调试牌桌"]')).not.toBeNull();
    await exitDebug();
    expect(peekCount()).toBe(0);
    await openDeveloperSettings();
    expect(host.querySelector<HTMLInputElement>('#godModeCheck')?.checked).toBe(false);
    expect(button(/^👀 全明手/).disabled).toBe(true);
  });

  it('从持久化的调试模式启动再退出，也恢复普通暗牌', async () => {
    await act(async () => { root.unmount(); });
    window.localStorage.setItem('baoshan_debug_mode', 'true');
    root = createRoot(host);
    await act(async () => { root.render(React.createElement(App)); });
    await exitDebug();
    expect(peekCount()).toBe(0);
    expect(window.localStorage.getItem('baoshan_debug_mode')).toBe('false');
  });

  it('退出调试清空已透视座位，同时保留用户明确保存的透视权限', async () => {
    await openDeveloperSettings();
    await enablePeekPermission();
    await click(/^👀 全明手/);
    await click('🎮 开启调试模式');
    await click('完成');
    await exitDebug();
    expect(peekCount()).toBe(0);
    await openDeveloperSettings();
    expect(host.querySelector<HTMLInputElement>('#godModeCheck')?.checked).toBe(true);
    expect(button(/^👀 全明手/).disabled).toBe(false);
    expect(button(/^👀 全明手/).getAttribute('aria-pressed')).toBe('false');
  });

  it('清理调试透视后，100 分成功扣底产生的规则明牌仍然公开', async () => {
    await enterDebug();
    await click('叫 100 分');
    await click('不叫', '[aria-label="直接叫分档位"]');
    await click('不叫', '[aria-label="直接叫分档位"]');
    await click('不叫', '[aria-label="直接叫分档位"]');
    await click(/黑桃/);
    await click('✨ 智能推荐扣底');
    await click('确认扣底（4/4）');
    await exitDebug();
    expect(peekCount()).toBe(0);
    expect(host.querySelector('main')?.getAttribute('data-phase')).toBe('playing');
    expect(host.querySelector('main')?.getAttribute('data-revealed-seat')).toBe('3');
    expect(host.querySelector('main')?.textContent).toContain('明牌');
  });
});
