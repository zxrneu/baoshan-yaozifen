// @vitest-environment happy-dom
/** 单副练习闭环：使用真实编排与规则，独立历史写入内存 SQLite，原局留在原会话。 */
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { Storage } from 'happy-dom';
import type { GameController } from '../src/hooks/useGame';
import type { AiAction, AsyncPlayerAgent } from '../src/ai/types';
import { defaultEngineManager } from '../src/ai/engines';
import { smartAgent } from '../src/ai/smart';
import { historyClient } from '../src/history/client';
import { historyDetail } from '../server/history/http';
import { SqliteHistoryRepository } from '../server/history/sqliteRepository';
import { soundManager } from '../src/audio/soundManager';
import { saveSeatProfiles } from '../src/ai/engines/profileClient';
const controllers = vi.hoisted(() => ({ standard: undefined as GameController | undefined, practice: undefined as GameController | undefined, agent: undefined as AsyncPlayerAgent | undefined }));
vi.mock('../src/hooks/useGame', async importOriginal => {
  const actual = await importOriginal<typeof import('../src/hooks/useGame')>();
  return { ...actual, useGame: (options: Parameters<typeof actual.useGame>[0] = {}) => {
    const g = actual.useGame({ ...options, agents: { 0: smartAgent, 1: controllers.agent ?? smartAgent, 2: smartAgent, 3: smartAgent } });
    if (options.singleHand) controllers.practice = g; else controllers.standard = g;
    return g;
  } };
});
import App from '../src/App';
let root: Root; let host: HTMLDivElement; let repo: SqliteHistoryRepository;
beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true); vi.stubGlobal('localStorage', new Storage());
  localStorage.setItem('baoshan_debug_mode', 'true');
  vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('练习测试显式禁止网络'); }));
  defaultEngineManager.setUseServerDecision(false); soundManager.setMuted(true);
  repo = new SqliteHistoryRepository({ path: ':memory:' });
  vi.spyOn(historyClient, 'write').mockImplementation(async packet => { repo.writeHistory(packet); });
  vi.spyOn(historyClient, 'detail').mockImplementation(async handId => historyDetail(repo, handId));
  host = document.createElement('div'); document.body.append(host); root = createRoot(host);
  controllers.standard = undefined; controllers.practice = undefined;
  controllers.agent = undefined;
});
afterEach(async () => { await act(async () => root.unmount()); host.remove(); repo.close(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });
async function render() { await act(async () => root.render(React.createElement(App))); }
async function click(name: string) {
  const button = [...host.querySelectorAll<HTMLButtonElement>('button')].find(value => value.textContent?.trim() === name);
  expect(button, name).toBeDefined(); await act(async () => button!.click());
}
async function clearPresentations(get: () => GameController) {
  while (get().presentation) await act(async () => get().advancePresentation());
}

it('新手教学可中途退出，原标准对局的牌局、历史和配置保留并暂停', async () => {
  await render(); await clearPresentations(() => controllers.standard!);
  await act(async () => controllers.standard!.doBid(70));
  await clearPresentations(() => controllers.standard!);
  const original = controllers.standard!.game;
  const cursor = controllers.standard!.sessionCursor;
  const routes = defaultEngineManager.getSeatRoutes();
  const matches = repo.listMatches();
  const handId = repo.listHands(matches[0].matchId)[0].handId;
  const nodes = historyDetail(repo, handId).nodes;
  await click('新手教学');
  const tutorial = host.querySelector('[role="dialog"][aria-label="新手教学"]');
  expect(tutorial).not.toBeNull();
  expect(tutorial?.textContent).toContain('认分牌');
  await act(async () => window.dispatchEvent(new KeyboardEvent('keydown', { key: ' ', bubbles: true, cancelable: true })));
  await click('退出教学');
  expect(host.querySelector('[aria-label="新手教学"]')).toBeNull();
  expect(controllers.standard!.game).toEqual(original);
  expect(controllers.standard!.sessionCursor).toEqual(cursor);
  expect(controllers.standard!.sessionMode).toBe('paused');
  expect(defaultEngineManager.getSeatRoutes()).toEqual(routes);
  expect(repo.listMatches()).toEqual(matches);
  expect(historyDetail(repo, handId).nodes).toEqual(nodes);
});

it('练习中完成或跳过教学后仍回到同一副练习，退出练习再回原标准对局', async () => {
  await render(); const standard = controllers.standard!.game;
  await click('单副练习');
  const practice = controllers.practice!.game;
  const cursor = controllers.practice!.sessionCursor;
  const matches = repo.listMatches();
  await click('新手教学');
  // 暂停自动练习会取消旧请求、更新 epoch；历史身份和配置仍须保持。
  const pausedCursor = controllers.practice!.sessionCursor;
  expect(pausedCursor.sessionId).toBe(cursor.sessionId);
  expect(pausedCursor.nodeId).toBe(cursor.nodeId);
  expect(pausedCursor.configRevision).toBe(cursor.configRevision);
  await click('跳过本段'); await click('跳过本段'); await click('返回牌桌');
  expect(controllers.practice!.game).toEqual(practice);
  expect(controllers.practice!.sessionCursor).toEqual(pausedCursor);
  expect(controllers.practice!.sessionMode).toBe('paused');
  expect(repo.listMatches()).toEqual(matches);
  await click('退出练习');
  expect(controllers.standard!.game).toEqual(standard);
});

it('进入教学取消在途决策，返回后迟到的建议不能推进活动牌局', async () => {
  let release!: (action: AiAction) => void; let signal: AbortSignal | undefined;
  controllers.agent = { nextAction: () => null, nextActionAsync: (_state, abort) => { signal = abort; return new Promise(resolve => { release = resolve; }); } };
  await render(); await clearPresentations(() => controllers.standard!);
  const original = controllers.standard!.game; let task!: Promise<void>;
  await act(async () => { task = controllers.standard!.triggerAiHint(); await Promise.resolve(); });
  expect(controllers.standard!.isThinking).toBe(true);
  await click('新手教学'); expect(signal?.aborted).toBe(true);
  await click('退出教学');
  await act(async () => { release({ kind: 'bid', seat: 1, bid: 70 }); await task; });
  expect(controllers.standard!.game).toEqual(original);
  expect(controllers.standard!.pendingAiAction).toBeNull();
  expect(controllers.standard!.aiHintAction).toBeNull();
});

it('中途退出单副练习回到原标准对局，保留牌局、历史身份与四座配置', async () => {
  await render(); await clearPresentations(() => controllers.standard!);
  await act(async () => { controllers.standard!.doBid(70); });
  await clearPresentations(() => controllers.standard!);
  const original = controllers.standard!.game; const cursor = controllers.standard!.sessionCursor;
  const routes = defaultEngineManager.getSeatRoutes();
  saveSeatProfiles(defaultEngineManager);
  const savedRoutes = localStorage.getItem('baoshan_seat_profiles_v1');
  await click('单副练习');
  expect(controllers.practice!.game.targetWins).toBe(1);
  expect(controllers.practice!.game.scores).toEqual([0, 0]);
  expect(controllers.practice!.sessionCursor.sessionId).not.toBe(cursor.sessionId);
  expect(controllers.practice!.engineManager).not.toBe(defaultEngineManager);
  expect(controllers.practice!.engineManager.getSeatRoutes()).toEqual(routes);
  const seatButton = host.querySelector<HTMLButtonElement>('[aria-label="东家当前引擎"]')!;
  await act(async () => seatButton.click());
  const menu = host.querySelector<HTMLSelectElement>('[aria-label="东家配置"]')!;
  await act(async () => { menu.value = 'human'; menu.dispatchEvent(new Event('change', { bubbles: true })); });
  expect(controllers.practice!.engineManager.isHumanSeat(0)).toBe(true);
  expect(localStorage.getItem('baoshan_seat_profiles_v1')).toBe(savedRoutes);
  await click('退出练习');
  expect(controllers.standard!.game).toEqual(original);
  expect(controllers.standard!.sessionCursor.sessionId).toBe(cursor.sessionId);
  expect(controllers.standard!.sessionCursor.nodeId).toBe(cursor.nodeId);
  expect(defaultEngineManager.getSeatRoutes()).toEqual(routes);
  expect(controllers.standard!.sessionMode).toBe('paused');
  expect(repo.listMatches().find(match => match.targetWins === 5)?.status).toBe('in_progress');
});

it('单副练习完成即结束，可复盘真实出牌并返回原局，下一步不能开启第二副', async () => {
  await render(); const original = controllers.standard!.game;
  await click('单副练习');
  await act(async () => { controllers.practice!.startSpectating(); controllers.practice!.pause(); });
  for (let count = 0; count < 100 && controllers.practice!.game.phase !== 'matchEnd'; count++) {
    await clearPresentations(() => controllers.practice!);
    await act(async () => { await controllers.practice!.stepNext(); });
  }
  await clearPresentations(() => controllers.practice!);
  expect(controllers.practice!.game.phase).toBe('matchEnd');
  expect([...host.querySelectorAll('button')].some(value => value.textContent === '再看一场')).toBe(false);
  const ended = controllers.practice!.game;
  await act(async () => { await controllers.practice!.stepNext(); controllers.practice!.goNextHand(); controllers.practice!.stopSpectating(); });
  expect(controllers.practice!.game).toEqual(ended);
  const result = host.querySelector('[role="dialog"][aria-label="单副练习结算"]');
  expect(result).not.toBeNull(); expect(result?.textContent).toContain('本副练习结束');
  expect(result?.textContent).not.toContain('整场胜利'); expect(result?.textContent).not.toContain('下一副牌');
  const replay = [...result!.querySelectorAll<HTMLButtonElement>('button')].find(value => value.textContent === '复盘本副');
  expect(replay?.disabled).toBe(false); await act(async () => replay!.click());
  expect(host.querySelector('[aria-label="历史复盘"]')).not.toBeNull();
  const record = repo.listMatches().find(match => match.targetWins === 1)!;
  expect(record.status).toBe('completed'); expect(repo.listHands(record.matchId)).toHaveLength(1);
  await click('返回结算'); await click('返回标准对局');
  expect(controllers.standard!.game).toEqual(original);
});

it('练习的两队配置仅应用于当前练习，不替换原标准对局的持久偏好', async () => {
  await render(); saveSeatProfiles(defaultEngineManager);
  const saved = localStorage.getItem('baoshan_seat_profiles_v1');
  await click('单副练习'); await click('设置'); await click('应用两队配置');
  expect(localStorage.getItem('baoshan_seat_profiles_v1')).toBe(saved);
});

it('练习中切换调试视图不改变原标准对局的调试偏好', async () => {
  await render(); await click('单副练习');
  await act(async () => controllers.practice!.setIsDebugMode(true));
  await act(async () => controllers.practice!.setIsDebugMode(false));
  expect(localStorage.getItem('baoshan_debug_mode')).toBe('true');
  await click('退出练习'); expect(controllers.standard!.isDebugMode).toBe(true);
});

it('进入练习取消原局的在途决策，退出后迟到响应不能推进原局', async () => {
  let release!: (action: AiAction) => void; let signal: AbortSignal | undefined;
  controllers.agent = { nextAction: () => null, nextActionAsync: (_state, abort) => { signal = abort; return new Promise(resolve => { release = resolve; }); } };
  await render(); await clearPresentations(() => controllers.standard!);
  const original = controllers.standard!.game; let task!: Promise<void>;
  await act(async () => { task = controllers.standard!.triggerAiHint(); await Promise.resolve(); });
  expect(controllers.standard!.isThinking).toBe(true);
  await click('单副练习'); expect(signal?.aborted).toBe(true);
  await click('退出练习');
  await act(async () => { release({ kind: 'bid', seat: 1, bid: 70 }); await task; });
  expect(controllers.standard!.game).toEqual(original);
  expect(controllers.standard!.pendingAiAction).toBeNull();
  expect(controllers.standard!.aiHintAction).toBeNull();
});

it('退出练习后原牌桌的玩家偏好与实际音效和出牌确认一致', async () => {
  await render(); await click('单副练习');
  await act(async () => { controllers.practice!.toggleSoundMute(); controllers.practice!.setConfirmBeforePlay(false); });
  await click('退出练习');
  expect.soft(controllers.standard!.soundMuted).toBe(soundManager.isMuted());
  expect.soft(controllers.standard!.confirmPreference).toBe(false);
});
