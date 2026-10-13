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

function hand(seat: number): Element {
  const element = host.querySelector(`[data-seat-hand="${seat}"]`);
  expect(element).not.toBeNull();
  return element!;
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

  it('调试牌桌在四家信息条末尾提供独立看牌开关，包括人工玩家', async () => {
    await enterDebug();
    expect(hand(0).querySelectorAll('[aria-label="暗牌"]')).toHaveLength(12);
    expect(hand(1).querySelectorAll('[aria-label="暗牌"]')).toHaveLength(0);
    for (const [seat, name] of ['东', '南', '西', '北'].entries()) {
      const initiallyVisible = seat === 1;
      const toggle = button(`${initiallyVisible ? '关闭' : '查看'}${name}家手牌`);
      expect(toggle.closest(`[data-seat-header="${seat}"]`)).not.toBeNull();
      expect(toggle.parentElement?.lastElementChild).toBe(toggle);
      expect(toggle.textContent).toBe(initiallyVisible ? '关牌' : '看牌');
      await click(`${initiallyVisible ? '关闭' : '查看'}${name}家手牌`);
      expect(hand(seat).querySelectorAll('[aria-label="暗牌"]')).toHaveLength(initiallyVisible ? 12 : 0);
      expect(button(`${initiallyVisible ? '查看' : '关闭'}${name}家手牌`).getAttribute('aria-pressed')).toBe(String(!initiallyVisible));
      // 切换本家不会同时翻开其他玩家。
      if (seat === 0) expect(hand(2).querySelectorAll('[aria-label="暗牌"]')).toHaveLength(12);
      await click(`${initiallyVisible ? '查看' : '关闭'}${name}家手牌`);
      expect(hand(seat).querySelectorAll('[aria-label="暗牌"]')).toHaveLength(initiallyVisible ? 0 : 12);
    }
  });

  it('普通牌桌和 AI 观战不出现调试看牌按钮，旧透视配置也不公开普通暗牌', async () => {
    window.localStorage.setItem('baoshan_engine_settings_v1', JSON.stringify({ godMode: true }));
    await act(async () => root.unmount());
    root = createRoot(host);
    await act(async () => root.render(React.createElement(App)));
    while (host.querySelector('[aria-label="动作展示"]')) {
      await act(async () => button('继续展示下一步').click());
    }
    expect(host.querySelector('button[aria-label$="家手牌"]')).toBeNull();
    expect(peekCount()).toBe(0);
    await click('观看 AI 对局');
    expect(host.querySelector('button[aria-label$="家手牌"]')).toBeNull();
    for (let seat = 0; seat < 4; seat++) expect(hand(seat).querySelectorAll('[aria-label="暗牌"]')).toHaveLength(0);
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

  it('退出调试后清理临时看牌，再进入不会保留之前打开的其他座位', async () => {
    await enterDebug();
    await click('查看东家手牌');
    expect(hand(0).querySelectorAll('[aria-label="暗牌"]')).toHaveLength(0);
    await exitDebug();
    expect(peekCount()).toBe(0);
    expect(host.querySelector('button[aria-label$="家手牌"]')).toBeNull();
    await enterDebug();
    expect(hand(0).querySelectorAll('[aria-label="暗牌"]')).toHaveLength(12);
  });

  it('从持久化的调试模式启动，四家仍可看牌关牌且退出恢复普通暗牌', async () => {
    await act(async () => root.unmount());
    localStorage.setItem('baoshan_debug_mode', 'true');
    root = createRoot(host);
    await act(async () => root.render(React.createElement(App)));
    expect(button('查看北家手牌').textContent).toBe('看牌');
    await exitDebug();
    expect(peekCount()).toBe(0);
    expect(localStorage.getItem('baoshan_debug_mode')).toBe('false');
  });

  it('100 分搭档在成功扣底后强制明牌，不能被关牌开关隐藏且出牌后同步剩余手牌', async () => {
    await enterDebug();
    await click('叫 100 分');
    for (let i = 0; i < 3; i++) await click('不叫', '[aria-label="直接叫分档位"]');
    // 叫分和定主阶段尚未产生规则明牌。
    expect(hand(3).querySelectorAll('[aria-label="暗牌"]')).toHaveLength(12);
    expect(button('查看北家手牌').disabled).toBe(false);
    await click(/黑桃/);
    expect(hand(3).querySelectorAll('[aria-label="暗牌"]')).toHaveLength(12);
    await click('✨ 智能推荐扣底');
    expect(hand(3).querySelectorAll('[aria-label="暗牌"]')).toHaveLength(12);
    await click('确认扣底（4/4）');
    expect(hand(3).querySelectorAll('[aria-label="暗牌"]')).toHaveLength(0);
    expect(hand(3).querySelectorAll('button')).toHaveLength(12);
    const revealed = button('北家规则明牌');
    expect(revealed.textContent).toBe('明牌'); expect(revealed.disabled).toBe(true);
    await act(async () => revealed.click());
    expect(hand(3).querySelectorAll('[aria-label="暗牌"]')).toHaveLength(0);
    // 逐座手动出合法牌到北家，核对规则明牌持续同步，而非起手快照。
    // 测试显式断网，自动代走会受历史保存故障屏障阻止。
    await click('查看西家手牌');
    for (const seat of [1, 2, 3]) {
      const legal = hand(seat).querySelector<HTMLButtonElement>('button[aria-pressed="false"]');
      expect(legal).not.toBeNull();
      const label = legal!.getAttribute('aria-label')!;
      await act(async () => legal!.click());
      await click(label, `[data-seat-hand="${seat}"]`);
    }
    expect(hand(3).querySelectorAll('button')).toHaveLength(11);
    expect(hand(3).querySelectorAll('[aria-label="暗牌"]')).toHaveLength(0);
    expect(button('北家规则明牌').disabled).toBe(true);
    expect(button('查看东家手牌').disabled).toBe(false);
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
