// @vitest-environment happy-dom
/** 页面交互回归：复用真实编排，仅注入阶段和操作回调，以验证入口与快捷键边界。 */
import React from 'react';
import { actAndLoad as act } from './helpers/lazyViews';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Storage } from 'happy-dom';
import type { useGame } from '../src/hooks/useGame';
import { createGame } from '../src/engine';
import { defaultEngineManager, decisionLogger } from '../src/ai/engines';
import { soundManager } from '../src/audio/soundManager';
import { commitPresentation } from '../src/hooks/actionPresentation';
import { declareTrump } from '../src/engine';
import { DecisionEngineManager } from '../src/ai/engines';
import { loadSeatProfiles } from '../src/ai/engines/profileClient';
import { makeProfile, parseProfilesFile } from '../src/ai/engines/profiles';
const overrides = vi.hoisted(() => ({ value: {} as Partial<ReturnType<typeof useGame>> }));
vi.mock('../src/hooks/useGame', async importOriginal => {
  const actual = await importOriginal<typeof import('../src/hooks/useGame')>();
  return { ...actual, useGame: () => ({ ...actual.useGame(), ...overrides.value }) };
});
import App from '../src/App';
let host: HTMLDivElement; let root: Root;
beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true); vi.stubGlobal('localStorage', new Storage());
  vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('页面回归显式离线'); }));
  defaultEngineManager.setUseServerDecision(false); defaultEngineManager.setActiveType('bridge'); soundManager.setMuted(true);
  decisionLogger.clear();
  overrides.value = { saveState: { status: 'unsupported', pending: 0 }, presentation: null };
  host = document.createElement('div'); document.body.append(host); root = createRoot(host);
});
afterEach(async () => { await act(async () => root.unmount()); host.remove(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });
async function render() { await act(async () => root.render(React.createElement(App))); }
function button(text: string) { return [...host.querySelectorAll('button')].find(button => button.textContent?.trim() === text); }
describe('牌桌操作与快捷键边界', () => {
  it.each(['bidding', 'trump', 'bury', 'playing'] as const)('普通对局 %s 操作只在右侧提供，保留阶段动作', async phase => {
    const game = createGame(42); game.phase=phase; game.declarer=1; game.trump='S';
    const doBid=vi.fn(); const doTrump=vi.fn(); const doBury=vi.fn(); const confirmPlayCard=vi.fn();
    Object.assign(overrides.value, {game, seat:1, humanSeat:1, humanTurn:true, isDebugMode:false, isSpectating:false,
      selected:game.hands[1].filter(card => !['A','10','5'].includes(card.rank)).slice(0,4),
      selectedPlayCard:game.hands[1][0], bidOptions:[70], doBid, doTrump, doBury, confirmPlayCard});
    await render();
    const side=host.querySelector('[aria-label="对局工具栏"]')!;
    const controls=side.querySelector('[aria-label="对局操作"]');
    expect(controls).not.toBeNull();
    expect(host.querySelector('main [aria-label="对局操作"]')).toBeNull();
    const buttons=[...controls!.querySelectorAll('button')];
    const action=buttons.find(button => phase==='bidding' ? button.getAttribute('aria-label')==='叫 70 分'
      : phase==='trump' ? button.textContent?.includes('黑桃')
      : phase==='bury' ? button.textContent?.includes('确认扣底') : button.textContent?.startsWith('出牌 '))!;
    await act(async () => action.click());
    if (phase==='bidding') expect(doBid).toHaveBeenCalledWith(70);
    else if (phase==='trump') expect(doTrump).toHaveBeenCalledWith('S');
    else if (phase==='bury') expect(doBury).toHaveBeenCalledOnce();
    else expect(confirmPlayCard).toHaveBeenCalledOnce();
  });
  it.each(['普通', 'Debug', '观战'] as const)('%s 的动作说明与继续按钮位于右侧，正向阅读且不覆盖牌桌', async mode => {
    const game=createGame(42);
    Object.assign(overrides.value, {game, isDebugMode:mode==='Debug', isSpectating:mode==='观战',
      presentation:{kind:'bid',seat:0,title:'东家叫 70 分',detail:'下一家待叫分',cards:[],hiddenCount:0,game,duration:1200,index:1,total:1}});
    await render();
    const action=host.querySelector('[aria-label="动作展示"]');
    expect(action?.closest('aside')).not.toBeNull();
    expect(action?.querySelector<HTMLElement>('[data-action-facing]')?.style.transform).toBe('rotate(0deg)');
    expect(action?.querySelector('[aria-label="继续展示下一步"]')).not.toBeNull();
  });
  it.each(['普通', 'Debug', '观战'] as const)('%s 的开始／暂停按钮统一位于顶栏，按当前运行状态切换', async mode => {
    const start = vi.fn(); const pause = vi.fn();
    overrides.value = {...overrides.value, isDebugMode:mode === 'Debug', isSpectating:mode === '观战', sessionMode:'paused', setIsStepMode:start, pause};
    await render();
    const controls = host.querySelector('[aria-label="对局运行控制"]')!;
    const run = controls?.querySelector<HTMLButtonElement>('button');
    expect(run?.textContent).toBe('开始');
    await act(async () => run!.click()); expect(start).toHaveBeenCalledWith(false);
    overrides.value.sessionMode = 'auto'; await render();
    const stop = host.querySelector<HTMLButtonElement>('[aria-label="对局运行控制"] button')!;
    expect(stop.textContent).toBe('暂停');
    await act(async () => stop.click()); expect(pause).toHaveBeenCalledOnce();
    expect([...host.querySelectorAll('button')].filter(value => value.textContent?.trim() === '暂停')).toHaveLength(1);
  });
  it('观战动画期间战况和行动者与当前展示步骤同步，不提前显示后续计分', async () => {
    const before = createGame(42); before.phase = 'playing'; before.declarer = 1; before.highestBid = 70; before.trump = 'S';
    const after = {...before, declarerTrickPoints:10, defenderTrickPoints:5};
    Object.assign(overrides.value, {game:after, isSpectating:true, presentation:{kind:'collect',seat:3,title:'北家收墩',detail:'收牌后再计分',cards:[],hiddenCount:0,game:before,duration:1200,index:1,total:2}});
    await render();
    const panel = host.querySelector('[aria-label="观战节奏控制"]')!;
    expect(panel.querySelector('[aria-label="当前行动"]')?.textContent).toContain('北家');
    expect([...panel.querySelectorAll('[role="progressbar"]')].map(value => value.getAttribute('aria-valuenow'))).toEqual(['0','0']);
  });
  it.each(['普通', 'Debug'] as const)('%s 自动展示中手动下一步会先暂停，鼠标和空格行为一致', async mode => {
    const pause = vi.fn(); const advance = vi.fn(); const game = createGame(42);
    Object.assign(overrides.value, {game,isDebugMode:mode === 'Debug',isSpectating:false,sessionMode:'auto',pause,advancePresentation:advance,presentation:{kind:'bid',seat:1,title:'南家叫 70 分',detail:'下一家待叫分',cards:[],hiddenCount:0,game,duration:1200,index:1,total:1}});
    await render();
    await act(async () => host.querySelector<HTMLButtonElement>('[aria-label="继续展示下一步"]')!.click());
    expect(pause).toHaveBeenCalledOnce(); expect(advance).toHaveBeenCalledOnce();
    await act(async () => window.dispatchEvent(new KeyboardEvent('keydown',{key:' ',bubbles:true,cancelable:true})));
    expect(pause).toHaveBeenCalledTimes(2); expect(advance).toHaveBeenCalledTimes(2);
  });
  it('Debug 人工接管操作位于右侧，避免扣底确认按钮与四家手牌重叠', async () => {
    overrides.value = { ...overrides.value, isDebugMode: true, isStepMode: true, seat: 1 };
    await render();
    const panel = host.querySelector('[aria-label="全功能上帝调试控制台"]')!;
    expect(panel.querySelector('[aria-label="当前玩家操作"]')).not.toBeNull();
    expect(host.querySelector('[aria-label="正方形上帝调试牌桌"] [aria-label="当前玩家操作"]')).toBeNull();
  });
  it.each(['普通对局', '观战'] as const)('%s 的行动状态、战况和公开记录直接集中在右侧', async mode => {
    const game = createGame(42);
    game.history.push('公开记录：南家等待叫分');
    overrides.value = { ...overrides.value, game, isSpectating: mode === '观战', isDebugMode: false };
    await render();
    const side = host.querySelector(mode === '观战' ? '[aria-label="观战节奏控制"]' : '[aria-label="对局工具栏"]')!;
    expect(side.querySelector('[aria-label="本副战况"]')).not.toBeNull();
    expect(side.querySelector('[aria-label="当前行动"]')).not.toBeNull();
    expect(side.querySelector('[aria-label="对局记录"]')?.textContent).toContain('公开记录：南家等待叫分');
    expect(side.querySelector('details')).toBeNull();
    expect(host.querySelector('main[aria-label="对局牌桌"] [aria-label="当前行动"]')).toBeNull();
  });
  it('普通对局的行动提示不重复主牌和起叫分，战况只有一个展示来源', async () => {
    overrides.value = {...overrides.value, game:createGame(42), isDebugMode:false, isSpectating:false};
    await render();
    const side = host.querySelector('[aria-label="对局工具栏"]')!;
    expect(side.querySelectorAll('[role="img"][aria-label="等待定主"]')).toHaveLength(1);
    expect(side.querySelector('[aria-label="当前行动"]')?.textContent).not.toContain('起叫');
  });
  it('Debug 常驻操作只保留一个下一步入口，不重复选择引擎或切换单步模式', async () => {
    const step = vi.fn(async () => {});
    overrides.value = { ...overrides.value, isDebugMode: true, isStepMode: true, sessionMode: 'paused', stepNext: step };
    await render();
    const panel = host.querySelector('[aria-label="全功能上帝调试控制台"]')!;
    expect(panel.querySelector('select')).toBeNull();
    const next = [...panel.querySelectorAll('button')].filter(value => value.textContent?.trim() === '下一步 (Space)');
    expect(next).toHaveLength(1);
    await act(async () => next[0].click());
    expect(step).toHaveBeenCalledOnce();
    expect(panel.textContent).not.toMatch(/AI 代走一步|四座 AI 连打|⏯️ 单步推演|独立弹窗大厅|全量弹窗/);
    expect([...panel.querySelectorAll('button')].filter(value => value.textContent?.includes('决策日志'))).toHaveLength(1);
    expect(panel.querySelectorAll('button[title="静音"]')).toHaveLength(0);
  });

  it('Debug 下一步的引擎提示随行动座位切换，不能显示全局默认引擎', async () => {
    const manager = new DecisionEngineManager({ useServerDecision: false });
    const definitions = parseProfilesFile({ schemaVersion: 1, profiles: [
      { id: 'bridge', name: '桥牌甲', type: 'bridge', options: { mode: 'fast' } },
      { id: 'algorithm', name: '算法乙', type: 'algorithm', options: {} },
    ] }).profiles;
    manager.setProfiles(definitions.map(definition => makeProfile(definition, definition.options, undefined, 'local')));
    manager.assignTeams('algorithm', 'bridge');
    const routes = manager.getSeatRoutes();
    overrides.value = { ...overrides.value, isDebugMode: true, engineManager: manager, seat: 1, engineType: 'bridge' };
    await render();
    expect(host.querySelector('[aria-label="本步引擎"]')?.textContent).toContain('南家 · 推演算法（Worker）');
    overrides.value = { ...overrides.value, seat: 2 };
    await render();
    expect(host.querySelector('[aria-label="本步引擎"]')?.textContent).toContain('西家 · 桥牌 Bridge（DDS）');
    expect(manager.getSeatRoutes()).toEqual(routes);
  });

  it('Debug 思考区标注已执行决策的实际引擎，不把下一位引擎当成上一步结果', async () => {
    const cursor = { sessionId: '引擎显示', nodeId: '2', epoch: 1, configRevision: 0 };
    overrides.value = { ...overrides.value, isDebugMode: true, seat: 2, engineType: 'bridge', sessionCursor: cursor };
    decisionLogger.record({ seat: 1, engineType: 'algorithm', roundNumber: 1, trickNumber: 0,
      ownHand: [], currentRound: [], candidates: [], latencyMs: 12, thinking: '上一步算法思考',
      status: 'applied', appliedNodeId: '2', context: { ...cursor, nodeId: '1', requestId: '前一步', purpose: 'step' } });
    await render();
    const diagnostics = host.querySelector('[aria-label="思维推演"]')!;
    expect(diagnostics.querySelector('[aria-label="评估引擎"]')?.textContent).toContain('推演算法（Worker）');
    expect(diagnostics.textContent).toContain('上一步算法思考');
  });

  it('结算一键打开本副真实动作复盘，关闭后回到同一结算', async () => {
    const { replayFixture } = await import('./fixtures/replay');
    const { repo, detail, states } = await replayFixture();
    const game = states.find(state => state.result)!;
    const actual = detail.branches.find(branch => branch.kind === 'actual')!;
    const readCurrentHand = vi.fn(async () => ({ detail, branchId: actual.branchId }));
    Object.assign(overrides.value, { game, saveState: { status: 'saved', pending: 0 }, readCurrentHand });
    await render();
    const result = host.querySelector('[role="dialog"][aria-label="本副结算"]')!;
    const replay = [...result.querySelectorAll('button')].find(value => value.textContent === '复盘本副');
    expect(replay).toBeDefined();
    await act(async () => replay!.click());
    expect(host.querySelector('[aria-label="历史复盘"]')).not.toBeNull();
    expect(host.querySelectorAll('[aria-label="复盘时间线"] option')).toHaveLength(detail.nodes.length + 1);
    expect(host.querySelector<HTMLSelectElement>('[aria-label="复盘路径"]')?.value).toBe(actual.branchId);
    await act(async () => button('返回结算')!.click());
    expect(host.querySelector('[role="dialog"][aria-label="本副结算"]')).not.toBeNull();
    expect(overrides.value.game).toBe(game);
    repo.close();
  });

  it.each(['saving', 'error', 'unsupported'] as const)('结算保存状态为 %s 时禁用复盘并给出原因', async status => {
    const { after: game } = (await import('./fixtures/history')).historyEndingAction();
    Object.assign(overrides.value, { game, saveState: { status, pending: status === 'unsupported' ? 0 : 1 } });
    await render();
    const result = host.querySelector('[role="dialog"][aria-label="本副结算"]')!;
    const replay = [...result.querySelectorAll('button')].find(value => value.textContent === '复盘本副');
    expect(replay).toBeDefined(); expect(replay!.disabled).toBe(true);
    expect(result.querySelector('[role="status"]')?.textContent).toContain(status === 'saving' ? '保存中' : status === 'error' ? '保存失败' : '不支持');
  });

  it('本副复盘加载失败可重试，关闭后迟到记录不会重开复盘', async () => {
    const { replayFixture } = await import('./fixtures/replay');
    const { repo, detail, states } = await replayFixture();
    const game = states.find(state => state.result)!;
    const branchId = detail.branches.find(branch => branch.kind === 'actual')!.branchId;
    let release!: (value: { detail: typeof detail; branchId: string }) => void;
    const readCurrentHand = vi.fn().mockRejectedValueOnce(new Error('显式加载失败')).mockImplementationOnce(() => new Promise(resolve => { release = resolve; })).mockResolvedValue({ detail, branchId });
    Object.assign(overrides.value, { game, saveState: { status: 'saved', pending: 0 }, readCurrentHand });
    await render();
    const resultReplay = () => [...host.querySelectorAll('[aria-label="本副结算"] button')].find(value => value.textContent === '复盘本副') as HTMLButtonElement;
    await act(async () => resultReplay().click());
    expect(host.querySelector('[aria-label="本副复盘"] [role="alert"]')?.textContent).toContain('显式加载失败');
    await act(async () => button('重试加载')!.click());
    await act(async () => button('返回结算')!.click());
    await act(async () => release({ detail, branchId }));
    expect(host.querySelector('[aria-label="本副复盘"]')).toBeNull();
    await act(async () => resultReplay().click());
    expect(host.querySelector('[aria-label="历史复盘"]')).not.toBeNull();
    repo.close();
  });

  it('普通牌桌常驻独立音效与中文报牌开关，切换不触发出牌', async () => {
    const sound = vi.fn(); const speech = vi.fn(); const play = vi.fn();
    overrides.value = { ...overrides.value, soundMuted: false, toggleSoundMute: sound, speechEnabled: true, speechAvailable: true, toggleSpeech: speech, confirmPlayCard: play };
    await render();
    const effects = host.querySelector<HTMLButtonElement>('[aria-label="操作音效"]');
    const voice = host.querySelector<HTMLButtonElement>('[aria-label="中文报牌"]');
    expect(effects?.getAttribute('aria-pressed')).toBe('true');
    expect(voice?.getAttribute('aria-pressed')).toBe('true');
    await act(async () => effects!.click()); await act(async () => voice!.click());
    expect(sound).toHaveBeenCalledOnce(); expect(speech).toHaveBeenCalledOnce(); expect(play).not.toHaveBeenCalled();
  });
  it('战况常驻显示双方锁定线与未打出分，使用闲家 105 减叫分且不展示暗牌', async () => {
    const game = createGame(42); game.phase = 'playing'; game.declarer = 0; game.highestBid = 85; game.trump = 'H';
    game.declarerTrickPoints = 55; game.defenderTrickPoints = 10;
    overrides.value = { ...overrides.value, game, seat: 1, humanSeat: 1, humanTurn: true };
    await render();
    const summary = host.querySelector('[aria-label="本副战况"]');
    expect(summary).not.toBeNull();
    expect(summary?.textContent).toContain('东西 · 庄家');
    expect(summary?.textContent).toContain('南北 · 闲家（你）');
    expect(summary?.querySelector('[aria-label="庄家锁定进度"]')?.getAttribute('aria-valuemax')).toBe('85');
    expect(summary?.querySelector('[aria-label="闲家锁定进度"]')?.getAttribute('aria-valuemax')).toBe('20');
    expect(summary?.textContent).toContain('未打出 35 分');
    expect(summary?.querySelector('.card')).toBeNull();
  });
  it('叫分时战况显示当前叫分，尚未确定庄家时不编造双方目标', async () => {
    const game = createGame(43); game.highestBid = 75; game.highestBidder = 2;
    overrides.value = { ...overrides.value, game };
    await render(); const summary = host.querySelector('[aria-label="本副战况"]');
    expect(summary?.textContent).toContain('西家 · 75 分');
    expect(summary?.querySelector('[role="progressbar"]')).toBeNull();
  });
  it('Debug 提供显式出入入口与界面看牌状态，所有诊断信息无需切换页签即可读取', async () => {
    const toggle = vi.fn(); overrides.value = { ...overrides.value, isDebugMode: false, setIsDebugMode: toggle };
    await render(); const entry = button('进入 Debug'); expect(entry).toBeDefined();
    await act(async () => entry!.click()); expect(toggle).toHaveBeenCalledWith(true);
    overrides.value = { ...overrides.value, isDebugMode: true, devPeekSeats: new Set([0, 1]) };
    await render(); expect(button('退出 Debug')).toBeDefined();
    expect(host.querySelector('[aria-label="Debug 信息边界"]')?.textContent).toContain('东家、南家');
    expect(host.querySelector('[aria-label="Debug 信息边界"]')?.textContent).toContain('合法可见信息');
    expect(host.querySelectorAll('[role="tab"]')).toHaveLength(0);
    for (const name of ['思维推演', '候选比选', '历史追溯', '沙盒工具']) {
      expect(host.querySelector(`section[aria-label="${name}"]`)).not.toBeNull();
    }
    expect(host.textContent).not.toContain('绝门记牌');
    await act(async () => button('退出 Debug')!.click()); expect(toggle).toHaveBeenLastCalledWith(false);
  });
  it('Debug 未评估时不编造胜率或降级状态，实际零胜率可准确读出', async () => {
    const game = createGame(44); game.phase = 'playing'; game.declarer = 0; game.trump = 'S'; game.highestBid = 85; game.leader = 1;
    const cursor = {sessionId:'候选显示',nodeId:'1',epoch:0,configRevision:0};
    overrides.value = { ...overrides.value, game, seat:1, isDebugMode:true, sessionCursor:cursor };
    await render(); const panel = host.querySelector('[aria-label="全功能上帝调试控制台"]')!;
    expect(panel.textContent).toContain('尚未评估'); expect(panel.textContent).not.toContain('正常无降级');
    const content = () => panel.querySelector('[aria-label="候选比选"]')!;
    expect(content().textContent).toContain('未评估'); expect(content().querySelector('[role="progressbar"]')).toBeNull();
    await act(async () => decisionLogger.record({seat:1,engineType:'bridge',roundNumber:1,trickNumber:1,ownHand:game.hands[1],currentRound:[],candidates:game.hands[1],chosenCard:game.hands[1][0],latencyMs:1,status:'evaluated',context:{...cursor,requestId:'胜率为零',purpose:'hint'},candidateEvaluations:[{card:game.hands[1][0],winRate:0,expectedPoints:0}]}));
    const progress = content().querySelector('[role="progressbar"]');
    expect(progress?.getAttribute('aria-valuenow')).toBe('0'); expect(progress?.getAttribute('aria-valuemax')).toBe('100');
    expect(content().textContent).toContain('0%');
  });
  it('牌桌标注各座位实际引擎，目录刷新不冒充冻结版本，观战人工座位标注代走引擎', async () => {
    const manager = new DecisionEngineManager();
    const definitions = parseProfilesFile({ schemaVersion: 1, profiles: [
      { id: 'bridge', name: '桥牌甲', type: 'bridge', options: {} },
      { id: 'algorithm', name: '算法乙', type: 'algorithm', options: {} },
      { id: 'llm', name: '模型丙', type: 'llm', options: {} },
      { id: 'one', name: '模型丁', type: 'laya', options: {} },
    ] }).profiles;
    const profiles = definitions.map(definition => makeProfile(definition, definition.options));
    manager.setProfiles(profiles); manager.assignSeat(0, 'one'); manager.assignSeat(2, 'algorithm'); manager.assignSeat(3, 'llm');
    overrides.value = { ...overrides.value, isDebugMode: true, engineManager: manager };
    await render();
    const label = (seat: number) => host.querySelector(`[aria-label="${['东','南','西','北'][seat]}家当前引擎"]`)?.textContent;
    expect([0,1,2,3].map(label)).toEqual(['System One（Laya）', '桥牌 Bridge（DDS）', '推演算法（Worker）', '大模型 LLM']);
    const changed = makeProfile({ ...definitions[2], type: 'algorithm' }, profiles[1].parameters.options);
    manager.setProfiles([profiles[0], profiles[1], changed, profiles[3]]); await render();
    expect(label(0)).toBe('System One（Laya）');
    expect(label(3)).toBe('大模型 LLM');
    manager.assignSeat(3, 'llm'); await render(); expect(label(3)).toBe('推演算法（Worker）');
    overrides.value = { ...overrides.value, isDebugMode: false, isSpectating: true };
    await render(); expect(label(1)).toBe('桥牌 Bridge（DDS）');
  });

  it.each(['debug', 'spectator', 'normal'] as const)('%s 牌桌点击引擎切换单座配置并保存，取消时保持其他座位', async mode => {
    const manager = new DecisionEngineManager();
    const profiles = parseProfilesFile({ schemaVersion: 1, profiles: [
      { id: 'a', name: '快算甲', type: 'bridge', options: {} },
      { id: 'b', name: '快算乙', type: 'algorithm', options: {} },
    ] }).profiles.map(definition => makeProfile(definition, definition.options));
    manager.setProfiles(profiles);
    const original = manager.getSeatRoutes()!; const pause = vi.fn(); const step = vi.fn();
    Object.assign(overrides.value, { engineManager: manager, isDebugMode: mode === 'debug', isSpectating: mode === 'spectator', pause, stepNext: step });
    await render();
    const open = () => host.querySelector<HTMLButtonElement>('[aria-label="东家当前引擎"]')!;
    expect(open()).not.toBeNull(); await act(async () => open().click()); expect(pause).toHaveBeenCalledOnce();
    const menu = host.querySelector<HTMLSelectElement>('[aria-label="东家配置"]'); expect(menu).not.toBeNull();
    expect([...menu!.options].map(option => option.textContent)).toEqual(['Human（人工）', '快算甲 · 桥牌 Bridge（DDS）', '快算乙 · 推演算法（Worker）']);
    await act(async () => window.dispatchEvent(new KeyboardEvent('keydown', { key: ' ', bubbles: true })));
    expect(step).not.toHaveBeenCalled();
    await act(async () => { menu!.value = 'b'; menu!.dispatchEvent(new Event('change', { bubbles: true })); });
    expect(manager.getSeatRoutes()).toEqual([{ profileId: 'b', version: manager.getProfiles()[1].version }, ...original.slice(1)]);
    expect(host.querySelector('[aria-label="东家引擎"]')).toBeNull(); expect(open().textContent).toBe('推演算法（Worker）');
    const restored = new DecisionEngineManager(); restored.setProfiles(profiles); loadSeatProfiles(restored);
    expect(restored.getSeatRoutes()).toEqual(manager.getSeatRoutes());
    await act(async () => open().click());
    await act(async () => button('返回牌桌')!.click()); expect(manager.getSeatRoutes()).toEqual(restored.getSeatRoutes());
    await act(async () => open().click());
    const human = host.querySelector<HTMLSelectElement>('[aria-label="东家配置"]')!;
    await act(async () => { human.value = 'human'; human.dispatchEvent(new Event('change', { bubbles: true })); });
    expect(manager.isHumanSeat(0)).toBe(true); expect(manager.getSeatRoutes()?.slice(1)).toEqual(original.slice(1));
  });

  it('观看入口展示四座 AI，观战时始终提供开始暂停、下一步和退出入口', async () => {
    const start=vi.fn(); Object.assign(overrides.value,{startSpectating:start}); await render();
    expect(button('AI 接管本局（公开手牌）')).toBeDefined(); await act(async()=>button('AI 接管本局（公开手牌）')!.click()); expect(start).toHaveBeenCalledOnce();
    Object.assign(overrides.value,{isSpectating:true,isDebugMode:false,sessionMode:'auto'}); await render();
    expect(host.querySelector('[aria-label="观战节奏控制"]')).not.toBeNull();
    expect(host.querySelector('[aria-label="正方形上帝调试牌桌"]')?.getAttribute('data-view')).toBe('spectator');
    expect(button('暂停')).toBeDefined(); expect(button('下一步')).toBeDefined(); expect(button('退出观战')).toBeDefined();
    overrides.value.sessionMode='paused'; await render(); expect(button('开始')).toBeDefined();
  });
  it('观战工具行明确显示音效开关状态，速度和退出分别调用原操作', async () => {
    const toggle = vi.fn(); const exit = vi.fn(); const speed = vi.fn();
    Object.assign(overrides.value, { isSpectating: true, isDebugMode: false, soundMuted: false, toggleSoundMute: toggle, stopSpectating: exit, setSpeed: speed });
    await render();
    const sound = () => host.querySelector<HTMLButtonElement>('[aria-label="观战音效"]')!;
    expect(sound()).not.toBeNull();
    expect(sound().getAttribute('aria-pressed')).toBe('true');
    expect(sound().textContent).toContain('开');
    await act(async () => sound().click()); expect(toggle).toHaveBeenCalledOnce();
    overrides.value.soundMuted = true; await render();
    expect(sound().getAttribute('aria-pressed')).toBe('false');
    expect(sound().textContent).toContain('关');
    const select = host.querySelector<HTMLSelectElement>('[aria-label="观战节奏控制"] select')!;
    await act(async () => { select.value = 'fast'; select.dispatchEvent(new Event('change', { bubbles: true })); });
    expect(speed).toHaveBeenCalledWith('fast');
    await act(async () => button('退出观战')!.click()); expect(exit).toHaveBeenCalledOnce();
  });
  it('观战点击头像暂停并展示该家真实决策理由，点击牌放大且不会出牌', async () => {
    const pause=vi.fn(()=>decisionLogger.invalidate('观战')); const play=vi.fn(); const cursor={sessionId:'观战',nodeId:'1',epoch:1,configRevision:0};
    const game=createGame(5); game.phase='playing'; game.declarer=0; game.trump='S';
    decisionLogger.record({seat:0,engineType:'bridge',roundNumber:1,trickNumber:1,ownHand:[],currentRound:[],candidates:[],chosenCard:game.hands[0][0],latencyMs:1,conclusion:'保留主牌，先领出长门。',status:'evaluated',context:{...cursor,requestId:'理由',purpose:'prefetch'}});
    Object.assign(overrides.value,{game,isSpectating:true,isDebugMode:false,sessionCursor:cursor,pause,onCardClick:play});
    await render(); const avatar=host.querySelector<HTMLButtonElement>('[aria-label="查看东家决策原因"]'); expect(avatar).not.toBeNull();
    await act(async()=>avatar!.click()); expect(pause).toHaveBeenCalled();
    expect(host.querySelector('[aria-label="东家决策原因"]')?.textContent).toContain('保留主牌，先领出长门。');
    await act(async()=>button('返回牌桌')!.click());
    const card=host.querySelector<HTMLButtonElement>('[aria-label="正方形上帝调试牌桌"] button[aria-label*="♠"]'); expect(card).not.toBeNull();
    await act(async()=>card!.click()); expect(host.querySelector('[aria-label="查看牌张"]')).not.toBeNull(); expect(play).not.toHaveBeenCalled();
  });
  it('调试起底展示具体四张牌、步骤进度和入手前牌数，空格只推进展示', async () => {
    const before=createGame(8); before.phase='trump'; before.declarer=0; before.highestBid=100;
    const game=declareTrump(before,0,'S'); const cursor={sessionId:'测试',nodeId:'1',epoch:0,configRevision:0};
    const steps=commitPresentation({before,after:game,command:{kind:'trump',seat:0,trump:'S'},source:'manual',from:cursor,to:cursor},{humanSeat:1,debug:true,peekedSeats:new Set()});
    const advance=vi.fn(); const step=vi.fn(async()=>{});
    overrides.value={...overrides.value,game,isDebugMode:true,presentation:steps[1],advancePresentation:advance,stepNext:step};
    await render();
    const display=host.querySelector('[aria-label="动作展示"]'); expect(display).not.toBeNull();
    expect(display?.getAttribute('data-position')).toBe('right');
    expect(display?.textContent).toContain('东家翻开 4 张底牌'); expect(display?.textContent).toContain('2 / 3');
    expect(display?.querySelectorAll('[data-action-card]')).toHaveLength(4);
    expect(host.querySelector('[aria-label="正方形上帝调试牌桌"]')?.textContent).not.toContain('16张');
    await act(async()=>window.dispatchEvent(new KeyboardEvent('keydown',{key:' ',bubbles:true,cancelable:true})));
    expect(advance).toHaveBeenCalledOnce(); expect(step).not.toHaveBeenCalled();
  });
  it.each([0, 1, 2, 3])('座位 %i 的叫分提示在调试与观战右栏正向显示，保留推进操作', async seat => {
    const game = createGame(8);
    const advance = vi.fn(); const step = vi.fn(async () => {});
    const names = ['东', '南', '西', '北'];
    for (const isSpectating of [false, true]) {
      Object.assign(overrides.value, {
        game, seat, isSpectating, isDebugMode: !isSpectating, sessionMode: 'paused',
        presentation: { kind: 'bid', seat, title: `${names[seat]}家不叫`, detail: '本次叫分已确认。', cards: [], hiddenCount: 0, game, duration: 1200, index: 1, total: 1 },
        advancePresentation: advance, stepNext: step,
      });
      await render();
      const display = host.querySelector('[aria-label="动作展示"]')!;
      expect(display.closest('aside')?.getAttribute('aria-label')).toBe(isSpectating ? '观战节奏控制' : '全功能上帝调试控制台');
      expect(display.querySelector<HTMLElement>('[data-action-facing]')?.style.transform).toBe('rotate(0deg)');
      expect(display.textContent).toContain(`${names[seat]}家不叫`);
      expect(display.textContent).toContain('本次叫分已确认。');
      expect(host.querySelector('[aria-label="当前玩家操作"]')).toBeNull();
      for (const hand of host.querySelectorAll('[data-seat-hand]')) expect(hand.contains(display)).toBe(false);
      await act(async () => display.querySelector<HTMLButtonElement>('[aria-label="继续展示下一步"]')!.click());
    }
    expect(advance).toHaveBeenCalledOnce(); expect(step).toHaveBeenCalledOnce();
  });
  it('收墩展示完成前，最终结算弹窗不遮住第四张出牌', async () => {
    const game=createGame(13); game.phase='handEnd'; game.declarer=0;
    game.result={declarer:0,bid:70,trump:'S',declarerPoints:70,defenderPoints:30,buriedPoints:0,success:true,winnerSide:0};
    const displayGame={...game,phase:'playing' as const,result:null};
    overrides.value={...overrides.value,game,presentation:{kind:'play',title:'北家出牌',detail:'第 4/4 张牌',cards:[game.hands[3][0]],hiddenCount:0,seat:3,game:displayGame,duration:2200,index:1,total:4}};
    await render(); expect(host.querySelector('[aria-label="动作展示"]')).not.toBeNull();
    expect(host.querySelector('[aria-label="本副结算"]')).toBeNull();
  });
  it('动作在右栏展示时不重复静态战况与底牌，牌桌仍完整保留当前墩四张牌', async () => {
    const game = createGame(13); game.phase = 'playing'; game.declarer = 0; game.trump = 'S';
    game.trick = [0, 1, 2, 3].map(seat => ({ seat, card: game.hands[seat][0] }));
    Object.assign(overrides.value, { game, isSpectating: true, isDebugMode: false,
      presentation: { kind: 'play', title: '北家出牌', detail: '第 4/4 张牌', cards: [game.hands[3][0]], hiddenCount: 0, seat: 3, game, duration: 2200, index: 1, total: 4 } });
    await render();
    const square = host.querySelector('[aria-label="正方形上帝调试牌桌"]')!;
    expect(square.querySelector('[aria-label="主牌：黑桃"]')).toBeNull();
    expect(square.textContent).not.toContain('底牌:');
    expect(square.querySelector('[aria-label="当前墩牌张"]')?.querySelectorAll('button')).toHaveLength(4);
    expect(square.querySelector('[aria-label="动作展示"]')).toBeNull();
    expect(host.querySelector('[aria-label="观战节奏控制"] [aria-label="动作展示"]')).not.toBeNull();
  });
  it('牌桌和弹窗位于同一横屏区域，方向提示不重建对局', async () => {
    await render(); const surface=host.querySelector('[aria-label="横屏游戏区域"]'); expect(surface).not.toBeNull();
    expect(surface?.contains(host.querySelector('main'))).toBe(true);
    await act(async()=>{ [...host.querySelectorAll('button')].find(button=>button.textContent==='规则')!.click(); });
    expect(surface?.contains(host.querySelector('[aria-label="游戏规则"]'))).toBe(true);
  });
  it.each([[0, 'right'], [1, 'top'], [2, 'left']] as const)('一百分明牌随观察座位 %s 旋转到 %s，保留实际公开座位信息', async (humanSeat, position) => {
    const game=createGame(14); game.phase='playing'; game.declarer=1; game.highestBid=100; game.trump='S';
    overrides.value={...overrides.value,game,humanSeat}; await render();
    const table=host.querySelector('main');
    expect(table?.getAttribute('data-revealed-seat')).toBe('3');
    expect(table?.getAttribute('data-revealed-position')).toBe(position);
  });
  it('普通牌桌暂停时给出继续入口，不必进入开发者设置', async () => {
    const resume=vi.fn(); overrides.value={...overrides.value,sessionMode:'paused',humanTurn:false,setIsStepMode:resume};
    await render(); const action=button('开始'); expect(action).toBeDefined();
    await act(async()=>action!.click()); expect(resume).toHaveBeenCalledWith(false);
  });
  it('保存失败暂停时继续入口禁用，必须先恢复保存', async () => {
    overrides.value={...overrides.value,sessionMode:'paused',saveState:{status:'error',pending:1,error:'保存失败'}};
    await render(); expect(button('开始')?.disabled).toBe(true);
  });
  it('在常驻对局记录中按空格不会触发调试代走', async () => {
    const step=vi.fn(async()=>{}); overrides.value={...overrides.value,isDebugMode:true,stepNext:step};
    await render(); const log=host.querySelector<HTMLElement>('[aria-label="对局记录"]')!; log.focus();
    await act(async()=>{ log.dispatchEvent(new KeyboardEvent('keydown',{key:' ',bubbles:true,cancelable:true})); });
    expect(step).not.toHaveBeenCalled();
  });
  it('结算可关闭回看，仍保留下一副入口且不会自动推进', async () => {
    const next=vi.fn(); const game=createGame(13); game.phase='handEnd';
    game.result={declarer:0,bid:70,trump:'S',declarerPoints:70,defenderPoints:30,buriedPoints:0,success:true,winnerSide:0};
    overrides.value={...overrides.value,game,isDebugMode:false,goNextHand:next}; await render();
    const review=button('回看牌桌'); expect(review).toBeDefined(); await act(async()=>review!.click());
    expect(host.querySelector('[aria-label="本副结算"]')).toBeNull(); expect(button('下一副')).toBeDefined(); expect(next).not.toHaveBeenCalled();
  });
});
