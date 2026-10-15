/**
 * T1.1 出牌交互统一（点牌即出）回归测试。
 * 覆盖三层：纯意图解析、偏好持久化与降级、组件渲染出的交互入口。
 */
import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { makeCard, sortHand } from '../src/cards';
import { resolvePlayClickIntent } from '../src/hooks/playIntent';
import {
  DEFAULT_PLAY_PREFERENCES, PLAY_PREF_STORAGE_KEY, readPlayPreferences, writePlayPreferences,
} from '../src/hooks/usePlayPreferences';
import ControlPanel from '../src/components/ControlPanel';
import HumanHand from '../src/components/HumanHand';
import GameTools from '../src/components/GameTools';

const CARD_A = makeCard('S', 'A');
const CARD_K = makeCard('S', 'K');
const CARD_Q = makeCard('H', 'Q');

describe('点牌即出 · 意图解析', () => {
  it('二次确认开启：未选→选中，点同牌→出牌，点异牌→换选', () => {
    expect(resolvePlayClickIntent(CARD_K, null, true)).toBe('select');
    expect(resolvePlayClickIntent(CARD_K, CARD_K, true)).toBe('play');
    expect(resolvePlayClickIntent(CARD_A, CARD_K, true)).toBe('select');
  });

  it('二次确认关闭：任何一次点击都直接出牌，不存在「只选不出」的中间态', () => {
    expect(resolvePlayClickIntent(CARD_K, null, false)).toBe('play');
    expect(resolvePlayClickIntent(CARD_K, CARD_A, false)).toBe('play');
    expect(resolvePlayClickIntent(CARD_K, CARD_K, false)).toBe('play');
  });

  it('只有一套交互模型：快捷模式永不返回 select/deselect', () => {
    const outcomes = [null, CARD_K, CARD_A].map((selected) => resolvePlayClickIntent(CARD_K, selected, false));
    expect(outcomes).toEqual(['play', 'play', 'play']);
    expect(outcomes).not.toContain('select');
    expect(outcomes).not.toContain('deselect');
  });

  it('按 cardId 判同牌，花色不同即视为换选', () => {
    // 同点数不同花色是两张不同的牌，必须触发换选而不是出牌。
    expect(resolvePlayClickIntent(makeCard('S', 'K'), makeCard('H', 'K'), true)).toBe('select');
  });
});

describe('点牌即出 · 偏好持久化与降级', () => {
  // 模块通过 window.localStorage 取存储，node 环境没有 window，故显式安装/卸载。
  const originalWindow = Object.getOwnPropertyDescriptor(globalThis, 'window');

  const installStorage = (value: unknown) => {
    Object.defineProperty(globalThis, 'window', {
      configurable: true,
      writable: true,
      value: { localStorage: value },
    });
  };

  beforeEach(() => installStorage(fakeStorage()));

  afterEach(() => {
    if (originalWindow) Object.defineProperty(globalThis, 'window', originalWindow);
    else Reflect.deleteProperty(globalThis, 'window');
  });

  it('默认开启二次确认：空存储 / 非法值 / 写入 true 后重读', () => {
    expect(readPlayPreferences()).toEqual(DEFAULT_PLAY_PREFERENCES);
    expect(DEFAULT_PLAY_PREFERENCES.confirmBeforePlay).toBe(true);

    window.localStorage.setItem(PLAY_PREF_STORAGE_KEY, '不是布尔值');
    expect(readPlayPreferences()).toEqual({ confirmBeforePlay: true });

    writePlayPreferences({ confirmBeforePlay: true });
    expect(readPlayPreferences()).toEqual({ confirmBeforePlay: true });
  });

  it('老手关闭后能持久化，并被重新读出', () => {
    writePlayPreferences({ confirmBeforePlay: false });
    expect(window.localStorage.getItem(PLAY_PREF_STORAGE_KEY)).toBe('false');
    expect(readPlayPreferences()).toEqual({ confirmBeforePlay: false });
  });

  it('存储读/写抛错时降级为默认值且不抛异常（显式构造失败）', () => {
    installStorage({
      getItem: () => { throw new Error('storage 不可用'); },
      setItem: () => { throw new Error('storage 已满'); },
    });

    expect(() => readPlayPreferences()).not.toThrow();
    expect(readPlayPreferences()).toEqual({ confirmBeforePlay: true });
    expect(() => writePlayPreferences({ confirmBeforePlay: false })).not.toThrow();
  });

  it('访问 localStorage 本身抛错（隐私模式）时同样降级', () => {
    Object.defineProperty(globalThis, 'window', {
      configurable: true,
      get() { throw new Error('拒绝访问'); },
    });
    expect(() => readPlayPreferences()).not.toThrow();
    expect(readPlayPreferences()).toEqual({ confirmBeforePlay: true });
    expect(() => writePlayPreferences({ confirmBeforePlay: false })).not.toThrow();
  });

  it('无 window（非浏览器运行）时同样回退默认值', () => {
    Reflect.deleteProperty(globalThis, 'window');
    expect(readPlayPreferences()).toEqual({ confirmBeforePlay: true });
    expect(() => writePlayPreferences({ confirmBeforePlay: false })).not.toThrow();
  });
});

describe('点牌即出 · 组件交互入口', () => {
  const basePanel = {
    seat: 1,
    humanSeat: 1,
    phase: 'playing' as const,
    highestBid: 80,
    bidOptions: [] as number[],
    kittySize: 4,
    selected: [],
    humanHand: [CARD_A, CARD_K],
    selectedPlayCard: null,
    trick: [],
    result: null,
    doBid: () => {},
    doTrump: () => {},
    doBury: () => {},
    autoSelectBury: () => {},
    clearSelectedBury: () => {},
    confirmPlayCard: () => {},
    goNextHand: () => {},
    restart: () => {},
  };

  it('二次确认开启：未选牌时主确认按钮禁用，仍提示可再点同牌出牌', () => {
    const html = renderToStaticMarkup(
      React.createElement(ControlPanel, { ...basePanel, confirmBeforePlay: true }),
    );
    expect(html).toContain('选择一张牌</button>');
    expect(html).toContain('primary-btn');
    expect(html).toContain('disabled=""');
    expect(html).toContain('再点一次出牌');
  });

  it('二次确认关闭：不再渲染出牌按钮，改为「点牌即出」提示条', () => {
    const html = renderToStaticMarkup(
      React.createElement(ControlPanel, { ...basePanel, confirmBeforePlay: false }),
    );
    expect(html).not.toContain('<button');
    expect(html).toContain('点牌即出');
  });

  it('非本人回合不暴露任何出牌入口', () => {
    const html = renderToStaticMarkup(
      React.createElement(ControlPanel, { ...basePanel, seat: 0, confirmBeforePlay: true }),
    );
    expect(html).toContain('等待');
    expect(html).not.toContain('<button');
  });

  const baseHand = {
    phase: 'playing' as const,
    humanTurn: true,
    legalIds: new Set(['KS', 'AS']),
    selected: [],
    trump: null,
    kittyIds: new Set<string>(),
    ledSuit: null,
    onCardClick: () => {},
  };

  it('手牌：只有合法牌可点击，非法牌保持禁用', () => {
    const html = renderToStaticMarkup(
      React.createElement(HumanHand, {
        ...baseHand,
        cards: sortHand([CARD_A, CARD_K, CARD_Q]),
        legalIds: new Set(['KS']),
        // 本轮首家出黑桃：黑桃必须跟，红桃 Q 缺门不可乱出。
        ledSuit: 'S',
        selectedPlayCard: null,
        confirmBeforePlay: true,
      }),
    );
    // aria-pressed 仅在「本轮可点击」的牌上出现，故合法牌恰好一张（KS）。
    const pressed = html.match(/aria-pressed="[^"]*"/g) ?? [];
    expect(pressed).toHaveLength(1);
    // 非法牌带 aria-disabled，且提示须跟主门花色。
    expect(html.match(/aria-disabled="true"/g) ?? []).toHaveLength(2);
    expect(html).toContain('须跟');
  });

  it('手牌：选中态给出「再点同一张牌出牌」提示，关闭确认后不再提示该动作', () => {
    const withConfirm = renderToStaticMarkup(
      React.createElement(HumanHand, {
        ...baseHand, cards: [CARD_K], selectedPlayCard: CARD_K, confirmBeforePlay: true,
      }),
    );
    expect(withConfirm).toContain('再点同一张牌出牌');

    const instant = renderToStaticMarkup(
      React.createElement(HumanHand, {
        ...baseHand, cards: [CARD_K], selectedPlayCard: CARD_K, confirmBeforePlay: false,
      }),
    );
    expect(instant).not.toContain('再点同一张牌出牌');
    expect(instant).toContain('已选');
  });
});

describe('点牌即出 · 验收缺陷回归', () => {
  // 触屏热区回归迁移到 browser/expert-touch-hit.test.ts：实际采样和触摸点击，
  // 验证完整 44px 牌位及邻牌隔离，避免要求会侵入邻牌的 ::before 实现。

  it('横屏提示：同时出现「须跟」与「已选」时不得各自绝对定位到同一位置', () => {
    const css = stripCssComments(readFileSync(
      fileURLToPath(new URL('../src/components/HumanHand.module.css', import.meta.url)),
      'utf8',
    ));
    // 使用旋转后的视口高度；物理竖屏也必须应用同一套矮屏样式。
    const landscapeStart = css.indexOf('@container game-viewport (max-height: 540px)');
    expect(landscapeStart).toBeGreaterThanOrEqual(0);
    const landscape = css.slice(landscapeStart);
    // 两条提示仍在常规文档流中纵排，不得被方向适配改回绝对定位。
    expect(landscape).toContain('.tipStack');
    expect(css).toMatch(/\.tipStack\s*\{[^}]*flex-direction:\s*column/);
    // 旧的写法是 .ruleTip, .killTip, .playPickTip 一并绝对定位到 top: 0。
    const selectorsPinnedTogether = /\.ruleTip,\s*\.killTip,\s*\.playPickTip/;
    expect(landscape).not.toMatch(selectorsPinnedTogether);
  });

  it('横屏提示：两条提示确实同时渲染进同一个容器（而非互斥）', () => {
    const html = renderToStaticMarkup(
      React.createElement(HumanHand, {
        cards: sortHand([CARD_A, CARD_K, CARD_Q]),
        phase: 'playing',
        humanTurn: true,
        legalIds: new Set(['KS']),
        selected: [],
        selectedPlayCard: CARD_K,
        trump: null,
        kittyIds: new Set<string>(),
        ledSuit: 'S',
        confirmBeforePlay: true,
        onCardClick: () => {},
      }),
    );
    // 须跟提示与选中提示同时存在，正是横屏会重叠的那种组合。
    expect(html).toContain('须跟');
    expect(html).toContain('再点同一张牌出牌');
  });

  // 实际遮挡与换行回归在 tests/fixtures/play-layout.html 中验证浏览器矩形，
  // 不再用固定 72px 的 CSS 字符串断言代替布局检查。

  it('调试模式提示与行为一致：强制确认时如实标注「调试强制」', () => {
    const forced = renderToStaticMarkup(
      React.createElement(GameTools, {
        phase: 'playing',
        completedTricks: 1,
        speed: 'normal',
        confirmBeforePlay: false,
        isConfirmForced: true,
        onToggleConfirmBeforePlay: () => {},
        onSpeedChange: () => {},
        onOpenHistory: () => {},
        onOpenLedger: () => {},
        onOpenLastTrick: () => {},
        onOpenRules: () => {},
        onOpenSettings: () => {},
      }),
    );
    expect(forced).toContain('调试强制');
    expect(forced).toContain('调试模式强制开启');
  });

  it('非调试模式：设置关闭时不标注强制，语义与行为一致', () => {
    const plain = renderToStaticMarkup(
      React.createElement(GameTools, {
        phase: 'playing',
        completedTricks: 1,
        speed: 'normal',
        confirmBeforePlay: false,
        isConfirmForced: false,
        onToggleConfirmBeforePlay: () => {},
        onSpeedChange: () => {},
        onOpenHistory: () => {},
        onOpenLedger: () => {},
        onOpenLastTrick: () => {},
        onOpenRules: () => {},
        onOpenSettings: () => {},
      }),
    );
    expect(plain).not.toContain('调试强制');
    expect(plain).not.toContain('调试模式强制开启');
  });
});

/** 去掉 CSS 注释，避免注释里的字面量（如「pointer-events: none」的说明）造成误判。 */
function stripCssComments(css: string): string {
  return css.replace(/\/\*[\s\S]*?\*\//g, '');
}

function fakeStorage(): Storage {
  const map = new Map<string, string>();
  return {
    get length() { return map.size; },
    clear: () => map.clear(),
    getItem: (key: string) => map.get(key) ?? null,
    key: (index: number) => [...map.keys()][index] ?? null,
    removeItem: (key: string) => { map.delete(key); },
    setItem: (key: string, value: string) => { map.set(key, value); },
  };
}
