// @vitest-environment happy-dom
/** 调试阅读位置回归：真实组件区分运行节奏切换和人工推进，避免暂停时打断日志阅读。 */
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import type { Window as HappyWindow } from 'happy-dom';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import DebugSidePanel from '../src/components/DebugSidePanel';
import { createGame } from '../src/engine';

type PanelProps = React.ComponentProps<typeof DebugSidePanel>;
let host: HTMLDivElement;
let root: Root;
let props: PanelProps;

beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  // 使用 DOM 环境的真实媒体查询，只有窗口尺寸来自测试环境适配。
  (window as unknown as HappyWindow).happyDOM.setWindowSize({ width: 844, height: 390 });
  host = document.createElement('div'); document.body.append(host); root = createRoot(host);
  props = {
    game: createGame(42), seat: 1, actorEngineLabel: '测试引擎',
    isStepMode: false, isThinking: false, pendingAiAction: null, aiHintAction: null,
    stepNext: async () => {}, triggerAiHint: async () => {}, manualPlaySeat: () => {},
    undo: () => false, canUndo: false, restart: () => {},
    onOpenEngineSettings: () => {}, onOpenDecisionLog: () => {},
  };
});
afterEach(async () => {
  await act(async () => root.unmount()); host.remove(); vi.unstubAllGlobals();
});
async function render(changes: Partial<PanelProps> = {}) {
  props = { ...props, ...changes };
  await act(async () => root.render(React.createElement(DebugSidePanel, props)));
  return host.querySelector<HTMLElement>('[aria-label="全功能上帝调试控制台"]')!;
}

// 只要把“暂停”当作新局面回顶，第一例就会丢失用户正在阅读的历史位置。
it('手机自动推演切为暂停时保留日志位置，再开始也不跳动', async () => {
  const panel = await render(); panel.scrollTop = 240;
  await render({ isStepMode: true });
  expect(panel.scrollTop).toBe(240);
  await render({ isStepMode: false });
  expect(panel.scrollTop).toBe(240);
});

it.each(['座位', '阶段', '展示'] as const)('手机人工推进改变%s时回到主操作', async change => {
  const panel = await render({ isStepMode: true }); panel.scrollTop = 240;
  await render(change === '座位' ? { seat: 2 }
    : change === '阶段' ? { game: { ...props.game, phase: 'trump' } }
    : { presentationTitle: '南家叫 70 分' });
  expect(panel.scrollTop).toBe(0);
});

it('自动推演更换座位和动作展示不打断阅读，随后仅暂停也保留位置', async () => {
  const panel = await render(); panel.scrollTop = 240;
  await render({ seat: 2, presentationTitle: '西家不叫' });
  expect(panel.scrollTop).toBe(240);
  await render({ presentationTitle: undefined });
  expect(panel.scrollTop).toBe(240);
  await render({ isStepMode: true });
  expect(panel.scrollTop).toBe(240);
});

it('手机人工模式同一动作的其他更新不重置阅读位置', async () => {
  const panel = await render({ isStepMode: true }); panel.scrollTop = 240;
  await render({ actorEngineLabel: '新的引擎名称', isThinking: true });
  expect(panel.scrollTop).toBe(240);
});

it('桌面人工推进保持独立诊断滚动位置', async () => {
  (window as unknown as HappyWindow).happyDOM.setWindowSize({ width: 1440, height: 900 });
  const panel = await render({ isStepMode: true }); panel.scrollTop = 240;
  await render({ seat: 2, presentationTitle: '西家不叫' });
  expect(panel.scrollTop).toBe(240);
});
