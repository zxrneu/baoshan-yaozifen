// @vitest-environment happy-dom
/** 动作展示回归：验证真实编排的逐步可见行为和推进屏障，外部请求显式失败。 */
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { Storage } from 'happy-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useGame, type GameController } from '../src/hooks/useGame';
import { defaultEngineManager } from '../src/ai/engines';
import { soundManager } from '../src/audio/soundManager';
import type { Card } from '../src/cards';
import { type GameState, createGame, bid, declareTrump, bury, playCard, legalMoves, legalBids, currentSeat } from '../src/engine';
import { commitPresentation } from '../src/hooks/actionPresentation';
import { EnginePlayerAgent } from '../src/ai/engines/engineAdapter';
import type { DecisionEngine } from '../src/ai/engines/engineTypes';
import type { SessionCommand } from '../src/workbench/session';
import { cardPoints } from '../src/cards';
import type { PlayerAgent, AsyncPlayerAgent, AiAction } from '../src/ai/types';
import { exportSnapshot } from '../src/workbench/snapshot';

let controller: GameController; let host: HTMLDivElement; let root: Root;
const agent = { nextAction: (game: GameState) => game.phase === 'bidding' ? { kind: 'bid' as const, seat: currentSeat(game), bid: legalBids(game)[0] ?? null } : null };
let testAgent: PlayerAgent | AsyncPlayerAgent = agent;
function Harness() { controller = useGame({ agents: { 0: testAgent, 1: testAgent, 2: testAgent, 3: testAgent } }); return null; }
function shown(): { kind: string; cards: Card[]; hiddenCount: number; game: GameState } | null {
  return Reflect.get(controller, 'presentation') ?? null;
}
async function advance() { await act(async () => { Reflect.get(controller, 'advancePresentation')(); }); }
async function finishEffects() { while (shown()) await advance(); }
beforeEach(async () => {
  testAgent = agent;
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true); vi.stubGlobal('localStorage', new Storage());
  localStorage.setItem('baoshan_debug_mode', 'true');
  vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('动作展示测试显式离线'); }));
  defaultEngineManager.setUseServerDecision(false); soundManager.setMuted(true);
  Object.defineProperty(window, '__TAURI_INTERNALS__', { configurable: true, value: {} });
  host = document.createElement('div'); document.body.append(host); root = createRoot(host);
  await act(async () => root.render(React.createElement(Harness)));
});
afterEach(async () => { await act(async () => root.unmount()); host.remove(); Reflect.deleteProperty(window, '__TAURI_INTERNALS__'); vi.useRealTimers(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

function project(before: GameState, after: GameState, command: SessionCommand, debug = true, humanSeat = 1) {
  const cursor = { sessionId: '测试', nodeId: '节点', epoch: 0, configRevision: 0 };
  return commitPresentation({ before, after, command, source: 'manual', from: cursor, to: cursor }, { debug, humanSeat, peekedSeats: new Set() });
}
function playingGame() {
  let game = createGame(17); game = bid(game, currentSeat(game), 100);
  for (let i = 0; i < 3; i++) game = bid(game, currentSeat(game), null);
  game = declareTrump(game, game.declarer!, 'S');
  return bury(game, game.declarer!, game.hands[game.declarer!].filter(card => cardPoints(card) === 0).slice(0, 4));
}

describe('动作必须逐步被观察', () => {
  it('观战结算后的下一步只展示新副发牌，保持暂停而不恢复自动连打', async () => {
    let game=playingGame();
    while(game.phase==='playing') game=playCard(game,currentSeat(game),legalMoves(game,currentSeat(game))[0]);
    await act(async()=>controller.loadSnapshot(exportSnapshot(game,{activeEngine:'bridge'})));
    await act(async()=>controller.startSpectating());
    await act(async()=>{ await controller.stepNext(); });
    expect(controller.game.phase).toBe('bidding'); expect(shown()?.kind).toBe('deal');
    expect(controller.sessionMode).toBe('paused');
  });
  it('思考中随时暂停，忽略迟到的 AI 结果；再继续才能执行新决策', async () => {
    let resolveAction: ((action: AiAction) => void) | undefined;
    let aborted = false;
    testAgent={nextAction:()=>null,nextActionAsync:(_game,signal)=>new Promise<AiAction>(resolve=>{
      resolveAction=resolve; signal?.addEventListener('abort',()=>{aborted=true;});
    })};
    await act(async()=>root.render(React.createElement(Harness)));
    await act(async()=>controller.startSpectating());
    expect(controller.isThinking).toBe(true);
    const node=controller.sessionCursor.nodeId; const seat=currentSeat(controller.game);
    await act(async()=>controller.pause()); expect(aborted).toBe(true);
    await act(async()=>resolveAction?.({kind:'bid',seat,bid:70}));
    expect(controller.sessionMode).toBe('paused'); expect(controller.sessionCursor.nodeId).toBe(node);
    expect(shown()).toBeNull();
    testAgent=agent; await act(async()=>root.render(React.createElement(Harness)));
    await act(async()=>{ await controller.stepNext(); });
    expect(shown()?.kind).toBe('bid'); expect(controller.sessionMode).toBe('paused');
  });
  it('出牌先展示第四张，再收墩、计分；结束时最后展示结算', () => {
    let game = playingGame();
    while (game.phase === 'playing') {
      const before = game; const seat = currentSeat(game); const card = legalMoves(game, seat)[0];
      game = playCard(game, seat, card);
      const steps = project(before, game, { kind: 'play', seat, card });
      expect(steps[0]?.kind).toBe('play'); expect(steps[0]?.cards).toEqual([card]);
      if (before.trick.length === 3) {
        expect(steps.slice(0, 3).map(step => step.kind)).toEqual(['play', 'collect', 'score']);
        expect(steps[0].game.trick).toHaveLength(4);
        expect(steps[0].game.defenderTrickPoints).toBe(before.defenderTrickPoints);
        expect(steps[1].game.declarerTrickPoints).toBe(before.declarerTrickPoints);
        expect(steps[2].game.defenderTrickPoints).toBe(game.defenderTrickPoints);
      }
      if (game.result) {
        expect(steps.at(-1)?.kind).toBe('result');
        expect(steps.slice(0, -1).every(step => step.game.result === null)).toBe(true);
      }
    }
  });
  it('普通观战翻底和扣底只展示数量，不在牌面或说明泄露暗牌；庄家可看原底牌', () => {
    const afterBury = playingGame(); const seat = afterBury.declarer!;
    let before = createGame(17); before = bid(before, currentSeat(before), 100);
    for (let i = 0; i < 3; i++) before = bid(before, currentSeat(before), null);
    const after = declareTrump(before, seat, 'S');
    const viewer = (seat + 1) % 4;
    const steps = project(before, after, { kind: 'trump', seat, trump: 'S' }, false, viewer);
    expect(steps.slice(1).map(step => step.cards)).toEqual([[], []]);
    expect(steps.slice(1).map(step => step.hiddenCount)).toEqual([4, 4]);
    expect(steps[1].detail).toBe('牌面仅庄家可见');
    expect(project(before, after, { kind: 'trump', seat, trump: 'S' }, false, seat)[1].cards).toEqual(before.kitty);
    const hiddenBury = project(after, afterBury, { kind: 'bury', seat, cards: afterBury.kitty }, false, viewer)[0];
    expect(hiddenBury.cards).toEqual([]); expect(hiddenBury.hiddenCount).toBe(4);
  });
  it('看牌开关不改变 AI 阶段观察、合法动作或牌局游标，四家全看仍隔离暗牌', async () => {
    const chooseAction = vi.fn<NonNullable<DecisionEngine['chooseAction']>>(async observation => ({
      action: { kind: 'bid', seat: observation.seat, bid: null }, engineType: 'bridge', latencyMs: 0,
    }));
    const engineAgent = new EnginePlayerAgent({ engine: { type: 'bridge', chooseAction, chooseCard: vi.fn() } });
    testAgent = engineAgent;
    await act(async () => root.render(React.createElement(Harness)));
    await finishEffects();
    const game = controller.game; const cursor = controller.sessionCursor;
    await act(async () => controller.triggerAiHint());
    const firstObservation = chooseAction.mock.calls[0][0];
    await act(async () => { for (const seat of [0, 2, 3]) controller.toggleDevPeek(seat); });
    expect(controller.devPeekSeats.size).toBe(4);
    await act(async () => controller.triggerAiHint());
    // 只切换展示不使缓存决策失效；再直接评估同一牌局核对实际引擎输入。
    expect(chooseAction).toHaveBeenCalledOnce();
    await act(async () => { await engineAgent.nextActionAsync(controller.game); });
    expect(chooseAction).toHaveBeenCalledTimes(2);
    expect(chooseAction.mock.calls[1][0]).toEqual(firstObservation);
    expect(firstObservation).not.toHaveProperty('hands');
    expect(firstObservation).not.toHaveProperty('kitty');
    expect(firstObservation).not.toHaveProperty('seed');
    expect(controller.aiHintAction).toEqual({ kind: 'bid', seat: currentSeat(game), bid: null });
    expect(controller.game).toBe(game); expect(controller.sessionCursor).toEqual(cursor);
  });

  it('调试关闭庄家手牌后，翻底和扣底展示即时改为牌背，重新看牌可恢复当前步骤', async () => {
    await finishEffects();
    await act(async () => controller.doBid(85)); await finishEffects();
    for (let i = 0; i < 3; i++) { await act(async () => controller.doBid(null)); await finishEffects(); }
    const before = controller.game; const declarer = before.declarer!;
    const cursor = controller.sessionCursor;
    await act(async () => controller.toggleDevPeek(declarer));
    expect(controller.sessionCursor).toEqual(cursor);
    expect(controller.game).toBe(before);
    await act(async () => controller.doTrump('S')); await advance();
    expect(shown()?.kind).toBe('kittyReveal');
    expect(shown()?.cards).toEqual([]); expect(shown()?.hiddenCount).toBe(4);
    await act(async () => controller.toggleDevPeek(declarer));
    expect(shown()?.cards).toEqual(before.kitty);
    await act(async () => controller.toggleDevPeek(declarer));
    expect(shown()?.cards).toEqual([]);
    await advance(); expect(shown()?.kind).toBe('kittyPickup');
    expect(shown()?.cards).toEqual([]); expect(shown()?.hiddenCount).toBe(4);
    await finishEffects();
    await act(async () => { controller.autoSelectBury(); });
    await act(async () => controller.doBury());
    expect(shown()?.kind).toBe('bury');
    expect(shown()?.cards).toEqual([]); expect(shown()?.hiddenCount).toBe(4);
  });

  it('自动连打等待展示完成，暂停保留当前步骤，恢复不会跳过', async () => {
    vi.useFakeTimers();
    expect(shown()?.kind).toBe('deal');
    const node = controller.sessionCursor.nodeId;
    await act(async () => { controller.setIsStepMode(false); });
    await act(async () => { await vi.advanceTimersByTimeAsync(2199); });
    expect(controller.sessionCursor.nodeId).toBe(node);
    await act(async () => { controller.pause(); });
    await act(async () => { await vi.advanceTimersByTimeAsync(10000); });
    expect(shown()?.kind).toBe('deal');
    await act(async () => { controller.setIsStepMode(false); });
    await act(async () => { await vi.advanceTimersByTimeAsync(2200); });
    expect(shown()).toBeNull();
    await act(async () => { await vi.advanceTimersByTimeAsync(700); });
    expect(shown()?.kind).toBe('bid');
  });
  it('撤销清理旧动作，重开重新展示发牌，恢复快照不会继续旧起底效果', async () => {
    await finishEffects(); await act(async () => { controller.doBid(100); });
    expect(shown()?.kind).toBe('bid');
    await act(async () => { controller.undo(); }); expect(shown()).toBeNull();
    await act(async () => { controller.restart(9); }); expect(shown()?.kind).toBe('deal');
    const snapshot = controller.saveSnapshot();
    await act(async () => { controller.loadSnapshot(snapshot); }); expect(shown()).toBeNull();
  });
  it('观战南家也由 AI 行动，下一步会暂停自动播放并保留动作逐项记录', async () => {
    await act(async () => { controller.startSpectating(); controller.pause(); });
    expect(controller.isSpectating).toBe(true); expect(controller.isDebugMode).toBe(false);
    const node=controller.sessionCursor.nodeId;
    await act(async () => { await controller.stepNext(); });
    expect(controller.sessionCursor.nodeId).not.toBe(node); expect(shown()?.kind).toBe('bid');
    expect(controller.sessionMode).toBe('paused');
    await advance();
    expect(Reflect.get(controller,'observedActions')?.at(-1)?.title).toContain('南家叫');
    await act(async () => { controller.stopSpectating(); });
    expect(controller.isSpectating).toBe(false); expect(controller.sessionMode).toBe('paused');
  });
  it('调试定主后先展示定主、四张原底牌，再展示入手；未看完不得扣底或代走', async () => {
    await finishEffects();
    await act(async () => { controller.doBid(100); }); await finishEffects();
    for (let i = 0; i < 3; i++) { await act(async () => { controller.doBid(null); }); await finishEffects(); }
    const before = controller.game; const declarer = before.declarer!;
    await act(async () => { controller.doTrump('S'); });
    expect(shown()?.kind).toBe('trump');
    expect(shown()?.game.hands[declarer]).toHaveLength(12);
    const node = controller.sessionCursor.nodeId;
    await act(async () => { controller.autoSelectBury(); controller.doBury(); });
    expect(controller.sessionCursor.nodeId).toBe(node);
    await act(async () => { await controller.stepNext(); });
    expect(shown()?.kind).toBe('kittyReveal');
    expect(shown()?.cards).toEqual(before.kitty);
    expect(shown()?.game.hands[declarer]).toHaveLength(12);
    expect(controller.sessionCursor.nodeId).toBe(node);
    await advance();
    expect(shown()?.kind).toBe('kittyPickup');
    expect(shown()?.cards).toEqual(before.kitty);
    expect(shown()?.game.hands[declarer]).toHaveLength(16);
    await advance(); expect(shown()).toBeNull();
    await act(async () => { controller.autoSelectBury(); });
    const buried = [...controller.selected];
    await act(async () => { controller.doBury(); });
    expect(shown()?.kind).toBe('bury'); expect(shown()?.cards).toEqual(buried);
    expect(shown()?.game.phase).toBe('bury');
    await advance(); expect(shown()?.kind).toBe('partnerReveal');
    expect(shown()?.cards).toEqual(controller.game.hands[(declarer + 2) % 4]);
  });
});
