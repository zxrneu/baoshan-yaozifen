// @vitest-environment happy-dom
/** 专家评审回归：通过真实组件验证手牌可执行操作和诊断清空保护。 */
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { Storage } from 'happy-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import SquareTable from '@yaozifen/web/components/SquareTable';
import { CardInspectionContext } from '@yaozifen/web/components/cardInspection';
import EngineSettingsModal from '@yaozifen/web/components/EngineSettingsModal';
import DecisionLogModal from '@yaozifen/web/components/DecisionLogModal';
import { decisionLogger } from '@yaozifen/ai-core/engines/decisionLogger';
import { DecisionEngineManager } from '@yaozifen/ai-core/engines/engineManager';
import { createGame } from '@yaozifen/game-core';
import { type Card } from '@yaozifen/game-core/cards';

let host: HTMLDivElement;
let root: Root;
beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  vi.stubGlobal('localStorage', new Storage());
  vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('专家交互测试显式离线'); }));
  decisionLogger.clear();
  host = document.createElement('div'); document.body.append(host); root = createRoot(host);
});
afterEach(async () => {
  await act(async () => root.unmount()); host.remove(); decisionLogger.clear();
  vi.restoreAllMocks(); vi.unstubAllGlobals();
});
async function render(element: React.ReactNode) { await act(async () => root.render(element)); }
async function click(button: HTMLButtonElement) { await act(async () => button.click()); }

describe('Debug 明牌的键盘操作', () => {
  it('四家手牌滚动区都有可聚焦的座位与余牌说明', async () => {
    const game = createGame(42);
    await render(React.createElement(SquareTable, {
      game, humanSeat: 1, seat: 1, visibleHandSeats: new Set([0, 1, 2, 3]),
      selectedPlayCard: null, aiHintCard: null, selectedBuryCards: [], bidOptions: [],
      onHumanCardClick: () => {}, onManualPlaySeat: () => {}, confirmPlayCard: () => {},
      doBid: () => {}, doTrump: () => {}, doBury: () => {}, autoSelectBury: () => {},
      clearSelectedBury: () => {}, goNextHand: () => {}, restart: () => {},
    }));
    for (const [seat, label] of ['东', '南', '西', '北'].entries()) {
      const hand = host.querySelector<HTMLElement>(`[data-seat-hand="${seat}"]`)!;
      hand.focus(); expect(document.activeElement).toBe(hand);
      expect(hand.getAttribute('role')).toBe('group');
      expect(hand.getAttribute('aria-label')).toContain(`${label}家手牌，共12张`);
    }
  });
  it('非行动明牌提供真实查看动作，当前行动合法牌仍选择出牌', async () => {
    const game = createGame(42); game.phase = 'playing'; game.declarer = 1; game.leader = 1;
    let inspected: Card | undefined; let played: Card | undefined;
    await render(React.createElement(CardInspectionContext.Provider, {
      value: { inspectOnly: false, inspect: card => { inspected = card; } },
    }, React.createElement(SquareTable, {
      game, humanSeat: 1, seat: 1, visibleHandSeats: new Set([0, 1, 2, 3]),
      selectedPlayCard: null, aiHintCard: null, selectedBuryCards: [], bidOptions: [],
      onHumanCardClick: card => { played = card; }, onManualPlaySeat: () => {},
      confirmPlayCard: () => {}, doBid: () => {}, doTrump: () => {}, doBury: () => {},
      autoSelectBury: () => {}, clearSelectedBury: () => {}, goNextHand: () => {}, restart: () => {},
    })));
    const other = host.querySelector<HTMLButtonElement>('[data-seat-hand="0"] button')!;
    expect(other.tabIndex).toBe(0);
    await click(other);
    expect(inspected).toEqual(expect.objectContaining({ rank: expect.any(String), suit: expect.any(String) }));
    expect(played).toBeUndefined();
    inspected = undefined;
    await click(host.querySelector<HTMLButtonElement>('[data-seat-hand="1"] button')!);
    expect(played).toBeDefined(); expect(inspected).toBeUndefined();
  });
});

describe.each(['设置', '诊断大厅'] as const)('从%s清空诊断记录', entry => {
  async function open() {
    decisionLogger.record({ seat: 1, engineType: 'bridge', roundNumber: 1, trickNumber: 0,
      ownHand: [], currentRound: [], candidates: [], latencyMs: 1, phase: 'bidding',
      action: { kind: 'bid', seat: 1, bid: 70 } });
    const element = entry === '设置'
      ? React.createElement(EngineSettingsModal, { manager: new DecisionEngineManager({ useServerDecision: false }),
          activeType: 'bridge', onClose: () => {}, isDebugMode: true, onToggleDebugMode: () => {}, initialLayer: 'developer' })
      : React.createElement(DecisionLogModal, { onClose: () => {} });
    await render(element);
    return [...host.querySelectorAll('button')].find(button => button.textContent?.includes('清空'))!;
  }
  it('取消确认保留记录，并明确清空范围不含持久对局历史', async () => {
    let prompt = '';
    vi.spyOn(window, 'confirm').mockImplementation(message => { prompt = String(message); return false; });
    const button = await open(); const record = decisionLogger.getRecords()[0];
    await click(button);
    expect(decisionLogger.getRecords()).toEqual([record]);
    expect(prompt).toContain('诊断'); expect(prompt).toContain('对局历史');
    expect(host.textContent).toContain('诊断');
  });
  it('确认后清空诊断并播报结果', async () => {
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    await click(await open());
    expect(decisionLogger.getRecords()).toHaveLength(0);
    const notices = [...host.querySelectorAll('[role="status"]')].map(item => item.textContent).join(' ');
    expect(notices).toContain('已清空'); expect(notices).toContain('诊断'); expect(notices).toContain('对局历史');
  });
});
