// @vitest-environment happy-dom
/** 底牌追溯交互回归（SRP）：核对摸入与扣回牌张，以及定主前和跨会话的显示边界。 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import DebugSidePanel from '../src/components/DebugSidePanel';
import { createGame, currentSeat } from '../src/engine';
import { cardLabel, cardPoints } from '../src/cards';
import { GameSession, type SessionCommand } from '../src/workbench/session';
import { decisionLogger } from '../src/ai/engines/decisionLogger';

let host: HTMLDivElement;
let root: Root;

beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  decisionLogger.clear();
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
});
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  decisionLogger.clear();
  vi.unstubAllGlobals();
});

async function render(session: GameSession) {
  const { game, cursor } = session.getSnapshot();
  await act(async () => root.render(React.createElement(DebugSidePanel, {
    game, sessionCursor: cursor, seat: currentSeat(game), engineType: 'bridge',
    setEngineType: () => {}, isStepMode: true, setIsStepMode: () => {},
    isThinking: false, pendingAiAction: null, aiHintAction: null,
    stepNext: async () => {}, triggerAiHint: async () => {}, manualPlaySeat: () => {},
    undo: () => false, canUndo: false, restart: () => {}, soundMuted: true,
    toggleSoundMute: () => {}, onOpenEngineSettings: () => {}, onOpenDecisionLog: () => {},
  })));
}
function commit(session: GameSession, command: SessionCommand) {
  expect(session.commit(command, session.getSnapshot().cursor, 'manual')).toBe(true);
}
function biddingSession(seed: number) {
  const session = new GameSession(createGame(seed));
  session.onCommit = event => decisionLogger.recordCommit(event);
  commit(session, { kind: 'bid', seat: currentSeat(session.getSnapshot().game), bid: 75 });
  for (let i = 0; i < 3; i++) commit(session, { kind: 'bid', seat: currentSeat(session.getSnapshot().game), bid: null });
  return session;
}
async function openHistory() {
  const tab = [...host.querySelectorAll('button')].find(button => button.textContent?.includes('历史追溯'));
  expect(tab).toBeDefined();
  await act(async () => tab!.click());
}
function timeline() {
  const element = host.querySelector('[aria-label="实际执行动作"]');
  expect(element).not.toBeNull();
  return element!;
}

describe('调试历史中的原始底牌', () => {
  it('定主后列出摸入底牌，扣底后仍保存原始四张并与埋牌区分', async () => {
    const session = biddingSession(12345);
    const original = [...session.getSnapshot().game.kitty];
    await render(session);
    await openHistory();
    expect(timeline().textContent).not.toContain('摸入底牌');
    const declarer = session.getSnapshot().game.declarer!;
    await act(async () => commit(session, { kind: 'trump', seat: declarer, trump: 'C' }));
    await render(session);
    expect(timeline().textContent).toContain(`摸入底牌：${original.map(cardLabel).join(' ')}`);

    const buried = session.getSnapshot().game.hands[declarer].filter(card => cardPoints(card) === 0).slice(0, 4);
    expect(buried).not.toEqual(original);
    await act(async () => commit(session, { kind: 'bury', seat: declarer, cards: buried }));
    await render(session);
    expect(timeline().textContent).toContain(`摸入底牌：${original.map(cardLabel).join(' ')}`);
    expect(timeline().textContent).toContain(`埋牌 ${buried.map(cardLabel).join(' ')}`);
  });

  it('切到另一个未定主会话后不显示旧会话摸入的底牌', async () => {
    const old = biddingSession(12345);
    commit(old, { kind: 'trump', seat: old.getSnapshot().game.declarer!, trump: 'C' });
    await render(old);
    await openHistory();
    expect(timeline().textContent).toContain('摸入底牌');
    const next = new GameSession(createGame(999));
    await render(next);
    expect(timeline().textContent).not.toContain('摸入底牌');
    expect(timeline().textContent).not.toContain('定主');
  });
});
