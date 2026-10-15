// @vitest-environment happy-dom
/** 专家评审交互回归：通过真实对局编排验证模式交接和扣底反馈，外部网络显式隔离。 */
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { Storage } from 'happy-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useGame, type GameController } from '../src/hooks/useGame';
import { DecisionEngineManager } from '../src/ai/engines';
import { offlineProfiles } from '../src/ai/engines/profileClient';
import { bid, bury, createGame, currentSeat, declareTrump, legalMoves, type GameState } from '../src/engine';
import { cardId, cardPoints } from '../src/cards';
import type { PlayerAgent } from '../src/ai/types';
import { soundManager } from '../src/audio/soundManager';
import { exportSnapshot } from '../src/workbench/snapshot';

let host: HTMLDivElement;
let root: Root;
let controller: GameController;

beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  vi.stubGlobal('localStorage', new Storage());
  vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('专家交互测试显式离线'); }));
  Object.defineProperty(window, '__TAURI_INTERNALS__', { configurable: true, value: {} });
  vi.useFakeTimers(); soundManager.setMuted(true);
  host = document.createElement('div'); document.body.append(host); root = createRoot(host);
});
afterEach(async () => {
  await act(async () => root.unmount()); host.remove();
  Reflect.deleteProperty(window, '__TAURI_INTERNALS__');
  vi.useRealTimers(); vi.unstubAllGlobals();
});

function buryPosition(): GameState {
  let game = createGame(17);
  game = bid(game, currentSeat(game), 70);
  for (let i = 0; i < 3; i++) game = bid(game, currentSeat(game), null);
  return declareTrump(game, game.declarer!, 'S');
}
function playingPosition(): GameState {
  const game = buryPosition();
  return bury(game, game.declarer!, game.hands[game.declarer!].filter(card => cardPoints(card) === 0).slice(0, 4));
}
const legalAgent: PlayerAgent = {
  nextAction: game => game.phase === 'playing'
    ? { kind: 'play', seat: currentSeat(game), card: legalMoves(game, currentSeat(game)).at(-1)! }
    : null,
};
async function mount(game: GameState, agent: PlayerAgent = legalAgent) {
  const manager = new DecisionEngineManager({ useServerDecision: false });
  manager.setProfiles(offlineProfiles());
  function Harness() {
    controller = useGame({ engineManager: manager, agents: { 0: agent, 1: agent, 2: agent, 3: agent } });
    return controller.toast ? React.createElement('p', { role: controller.toast.bad ? 'alert' : 'status' }, controller.toast.text) : null;
  }
  await act(async () => root.render(React.createElement(Harness)));
  await act(async () => controller.loadSnapshot(exportSnapshot(game, { activeEngine: 'bridge' })));
}

describe('观战单步与人工选择交接', () => {
  // 删除模式交接的选择清理，会让暂停时已选牌的观战单步误入人工确认并停住。
  it.each([
    { selected: false, automatic: false },
    { selected: false, automatic: true },
    { selected: true, automatic: false },
    { selected: true, automatic: true },
  ])('选牌=$selected、自动=$automatic 时进入观战，单步由 AI 出牌并保持暂停', async ({ selected, automatic }) => {
    const game = playingPosition(); await mount(game);
    const actor = currentSeat(game);
    const picked = legalMoves(game, actor)[0];
    const expectedCard = legalMoves(game, actor).at(-1)!;
    expect(actor).toBe(1);
    expect(expectedCard).not.toEqual(picked);
    if (selected) {
      await act(async () => controller.onCardClick(picked));
      expect(controller.selectedPlayCard).toEqual(picked);
    }
    if (automatic) await act(async () => controller.setIsStepMode(false));
    const before = controller.sessionCursor.nodeId;
    await act(async () => controller.startSpectating());
    expect(controller.sessionMode).toBe('paused');
    await act(async () => { await controller.stepNext(); });
    expect(controller.game.trick).toEqual([{ seat: 1, card: expectedCard }]);
    expect(controller.sessionCursor.nodeId).not.toBe(before);
    expect(controller.sessionMode).toBe('paused');
    expect(controller.selectedPlayCard).toBeNull();
    await act(async () => vi.advanceTimersByTimeAsync(5000));
    expect(controller.game.trick).toHaveLength(1);
    await act(async () => controller.stopSpectating());
    expect(controller.selectedPlayCard).toBeNull();
    expect(controller.selected).toEqual([]);
    expect(controller.sessionMode).toBe('paused');
  });

  it('尚未推进就退出观战，也不会带回失效的人工选牌', async () => {
    const game = playingPosition(); await mount(game);
    await act(async () => controller.onCardClick(legalMoves(game, 1)[0]));
    const before = controller.sessionCursor.nodeId;
    await act(async () => controller.startSpectating());
    await act(async () => controller.stopSpectating());
    expect(controller.selectedPlayCard).toBeNull();
    expect(controller.sessionCursor.nodeId).toBe(before);
    expect(controller.game.trick).toEqual([]);
  });

  it('观战清理扣底选择，退出后不能提交旧扣底方案', async () => {
    await mount(buryPosition());
    await act(async () => controller.autoSelectBury());
    expect(controller.selected).toHaveLength(4);
    const before = controller.sessionCursor.nodeId;
    await act(async () => controller.startSpectating());
    expect(controller.selected).toEqual([]);
    await act(async () => controller.stopSpectating());
    await act(async () => controller.doBury());
    expect(controller.sessionCursor.nodeId).toBe(before);
    expect(controller.game.phase).toBe('bury');
  });

  it('观战单步不以旧人工选牌代替非法 AI 动作，也不能手动替 AI 提交', async () => {
    const game = playingPosition();
    const foreignCard = game.hands[0][0];
    await mount(game, { nextAction: () => ({ kind: 'play', seat: 1, card: foreignCard }) });
    await act(async () => controller.onCardClick(legalMoves(game, 1)[0]));
    await act(async () => controller.startSpectating());
    const before = controller.sessionCursor.nodeId;
    await act(async () => { await controller.stepNext(); });
    expect(controller.toast?.bad).toBe(true);
    expect(controller.sessionCursor.nodeId).toBe(before);
    await act(async () => { controller.onCardClick(legalMoves(game, 1)[0]); controller.confirmPlayCard(); });
    expect(controller.game.trick).toEqual([]);
    expect(controller.sessionMode).toBe('paused');
  });
});

describe('扣底满额后的可访问反馈', () => {
  // 删除容量反馈后，推荐满额再点第五张时仍无任何可访问状态解释。
  it('推荐选满后点第五张提示先取消，保留四张选择；取消后可以补选', async () => {
    await mount(buryPosition());
    await act(async () => controller.autoSelectBury());
    const recommended = [...controller.selected];
    expect(recommended).toHaveLength(4);
    const extra = controller.humanHand.find(card => cardPoints(card) === 0 && !recommended.some(value => cardId(value) === cardId(card)))!;
    await act(async () => controller.onCardClick(extra));
    expect(host.querySelector('[role="status"]')?.textContent).toMatch(/已选满.*4.*取消/);
    expect(controller.selected).toEqual(recommended);
    await act(async () => controller.onCardClick(recommended[0]));
    expect(controller.selected).toHaveLength(3);
    await act(async () => controller.onCardClick(extra));
    expect(controller.selected).toEqual([...recommended.slice(1), extra]);
    await act(async () => controller.doBury());
    expect(controller.game.phase).toBe('playing');
    expect(controller.game.kitty).toEqual([...recommended.slice(1), extra]);
    expect(controller.game.kitty.every(card => cardPoints(card) === 0)).toBe(true);
  });

  it('选满后点击分牌仍提示禁止扣底，不能用容量提示掩盖规则', async () => {
    await mount(buryPosition());
    await act(async () => controller.autoSelectBury());
    const selected = [...controller.selected];
    const point = controller.humanHand.find(card => cardPoints(card) > 0)!;
    await act(async () => controller.onCardClick(point));
    expect(host.querySelector('[role="alert"]')?.textContent).toContain('分牌');
    expect(controller.selected).toEqual(selected);
  });
});
