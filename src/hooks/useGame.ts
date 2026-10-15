/** 对局编排遵循单一职责：管理会话与交互状态，调试视图不改写普通牌桌的透视权限。 */
import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { Card, Suit, cardId, cardPoints, sortHand } from '../cards';
import { createGame, currentSeat, legalBids, legalMoves } from '../engine';
import type { AiAction, PlayerAgent } from '../ai/types';
import { smartBury } from '../ai/smart';
import { defaultEngineManager, DecisionEngineManager } from '../ai/engines/engineManager';
import type { EngineType } from '../ai/engines/engineTypes';
import { requestProfiles, offlineProfiles, loadSeatProfiles } from '../ai/engines/profileClient';
import { derivedHistoryId } from '../history/ids';
import type { EngineProfile, SeatRoute } from '../ai/engines/profiles';
import { PROFILE_IMPLEMENTATION_VERSION } from '../ai/engines/profiles';
import { decisionLogger } from '../ai/engines/decisionLogger';
import { thinkingService, type ThinkingState } from '../ai/engines/thinkingService';
import { soundManager } from '../audio/soundManager';
import { announcementForAction, speechManager } from '../audio/speechManager';
import { GameSession, SessionCommand, type SessionMode } from '../workbench/session';
import { exportSnapshot, importSnapshot } from '../workbench/snapshot';
import { usePlayPreferences } from './usePlayPreferences';
import { resolvePlayClickIntent } from './playIntent';
import { HistoryRecorder, type SaveState } from '../history/autosave';
import { historyClient } from '../history/client';
import { captureConfiguration, captureEvaluation } from '../history/capture';
import { type HandDetail, readHandDetail, exportHand } from '../history/transport';
import { replayPath } from '../history/replay';
import { commitPresentation, dealPresentation, presentationDelay, visiblePresentation, type ObservedAction, type ActionPresentation } from './actionPresentation';

export const HUMAN_SEAT = 1;
export type GameSpeed = 'fast' | 'normal' | 'slow';
const SPEED_MAP: Record<GameSpeed, number> = { fast: 260, normal: 650, slow: 1200 };
type Toast = { text: string; bad: boolean } | null;
export interface SeatDecisionNotice {
  id: string;
  action: AiAction;
  conclusion?: string;
  committed: boolean;
}
export interface UseGameOptions {
  agents?: Partial<Record<number, PlayerAgent>>;
  defaultSpeed?: GameSpeed;
  engineManager?: DecisionEngineManager;
  singleHand?: boolean;
}
function savedDebug(): boolean {
  try { return localStorage.getItem('baoshan_debug_mode') === 'true'; } catch { return false; }
}
export function useGame({ agents, defaultSpeed = 'normal', engineManager = defaultEngineManager, singleHand = false }: UseGameOptions = {}) {
  const initialDebug = () => !singleHand && savedDebug();
  const [session] = useState(() => new GameSession(createGame(Date.now() % 100000, singleHand ? { targetWins: 1 } : {})));
  const recorderLease = useRef(0);
  const engineManagerRef = useRef(engineManager); engineManagerRef.current = engineManager;
  const recorderRef = useRef<HistoryRecorder | null>(null);
  const [saveState, setSaveState] = useState<SaveState>({ status: 'saving', pending: 1 });
  const debugRef = useRef(initialDebug());
  const state = useSyncExternalStore(session.subscribe, session.getSnapshot);
  const { game, cursor, isThinking, canUndo, canRedo } = state;
  const pendingAiAction = state.pending?.action ?? null;
  const aiHintAction = state.hint?.action ?? null;
  const [thinkingState, setThinkingState] = useState<ThinkingState>(() => thinkingService.getState());
  const [lastDecision, setLastDecision] = useState<SeatDecisionNotice | null>(null);
  const [dismissedDecisionId, setDismissedDecisionId] = useState<string | null>(null);
  const [isDebugMode, setIsDebugModeState] = useState(initialDebug);
  debugRef.current = isDebugMode;
  const [isSpectating, setIsSpectating] = useState(false);
  const spectatorRef = useRef(false);
  const isStepMode = state.mode !== 'auto';
  const [speed, setSpeed] = useState<GameSpeed>(defaultSpeed);
  const [profileRevision, setProfileRevision] = useState(0);
  const humanSeat = currentSeat(game) >= 0 && engineManager.isHumanSeat(currentSeat(game)) ? currentSeat(game) : [1,0,2,3].find(seat => engineManager.isHumanSeat(seat)) ?? 1;
  const [devPeekSeats, setDevPeekSeats] = useState<Set<number>>(() => new Set(initialDebug() ? [humanSeat] : []));
  const [engineType, setEngineTypeState] = useState<EngineType>(() => engineManager.getActiveType());
  const [toast, setToast] = useState<Toast>(null);
  const [selected, setSelected] = useState<Card[]>([]);
  const [selectedPlayCard, setSelectedPlayCard] = useState<Card | null>(null);
  const selection = useRef({ selected, selectedPlayCard, cursor });
  selection.current = { selected, selectedPlayCard, cursor };
  const changeRunMode = useCallback((mode: SessionMode) => {
    const choice = selection.current;
    const current = session.getSnapshot().cursor;
    const samePosition = choice.cursor.sessionId === current.sessionId && choice.cursor.nodeId === current.nodeId && choice.cursor.configRevision === current.configRevision;
    session.setMode(mode);
    // 运行节奏取消在途决策，但同一局面的人工选择仍有效；换局面或配置继续清除。
    if (samePosition) { setSelected(choice.selected); setSelectedPlayCard(choice.selectedPlayCard); }
  }, [session]);
  const { prefs: playPrefs, setConfirmBeforePlay } = usePlayPreferences();
  const [kittyRevealed, setKittyRevealed] = useState<Card[] | null>(null);
  const [observedActions, setObservedActions] = useState<ObservedAction[]>([]);
  const [presentationQueue, setPresentationQueue] = useState<ActionPresentation[]>(() => dealPresentation(game));
  const presentationRef = useRef(presentationQueue);
  const showPresentations = useCallback((steps: ActionPresentation[]) => {
    presentationRef.current = steps; setPresentationQueue(steps);
  }, []);
  const visibleAction = useCallback((action: ActionPresentation) => visiblePresentation(action, {
    humanSeat: isDebugMode ? -1 : humanSeat, debug: isSpectating,
    peekedSeats: isDebugMode ? devPeekSeats : new Set(),
  }), [isDebugMode, isSpectating, humanSeat, devPeekSeats]);
  const advancePresentation = useCallback(() => {
    const action = presentationRef.current[0];
    if (action) {
      const visible = visibleAction(action);
      setObservedActions(previous => [...previous, { kind: visible.kind, title: visible.title, detail: visible.detail }]);
    }
    showPresentations(presentationRef.current.slice(1));
  }, [showPresentations, visibleAction]);
  const presentation = useMemo(() => presentationQueue[0] ? visibleAction(presentationQueue[0]) : null, [presentationQueue, visibleAction]);
  const [pickedKitty, setPickedKitty] = useState<Card[]>([]);
  const [soundMuted, setSoundMuted] = useState(() => soundManager.isMuted());
  const [speechEnabled, setSpeechEnabled] = useState(() => speechManager.isEnabled());
  const [showRulesModal, setShowRulesModal] = useState(false);
  const [showLastTrickModal, setShowLastTrickModal] = useState(false);
  const [showHistoryModal, setShowHistoryModal] = useState(false);
  const [showPointsLedger, setShowPointsLedger] = useState(false);
  const [showEngineSettings, setShowEngineSettings] = useState(false);
  const [showDecisionLogModal, setShowDecisionLogModal] = useState(false);
  const [selectedDecisionId, setSelectedDecisionId] = useState<string | undefined>();
  const toastTimer = useRef<number | null>(null);
  const agentsRef = useRef(agents);
  agentsRef.current = agents;
  const flash = useCallback((text: string, bad = false) => {
    setToast({ text, bad });
    if (toastTimer.current) window.clearTimeout(toastTimer.current);
    toastTimer.current = window.setTimeout(() => setToast(null), 3000);
  }, []);
  session.onInvalidate = () => {
    decisionLogger.invalidate(session.getSnapshot().cursor.sessionId);
    thinkingService.clear();
    setLastDecision(null);
    setDismissedDecisionId(null);
    setSelected([]); setSelectedPlayCard(null);
  };
  session.onCommit = event => {
    decisionLogger.recordCommit(event);
    if (event.command.kind === 'nextHand') { setObservedActions([]); engineManager.beginHand(); }
    const action = event.command;
    showPresentations(commitPresentation(event, { humanSeat, debug: isDebugMode || isSpectating, peekedSeats: isDebugMode ? devPeekSeats : new Set() }));
    if (action.kind !== 'nextHand') {
      const record = event.requestId
        ? decisionLogger.getRecords().find(value => value.context?.requestId === event.requestId)
        : undefined;
      setLastDecision({ id: event.to.nodeId, action, conclusion: record?.conclusion, committed: true });
    }
    if (action.kind === 'trump') {
      setPickedKitty([...event.before.kitty]);
    }
  };
  useEffect(() => {
    if (('__TAURI_INTERNALS__' in window || '__TAURI__' in window) && !engineManager.isUseServerDecision()) {
      setSaveState({status:'unsupported',pending:0});
      return;
    }
    let journal: Storage | undefined;
    try { journal = localStorage; } catch {}
    const lease = ++recorderLease.current;
    const recorder = recorderRef.current ?? new HistoryRecorder(session, { write: packet => historyClient.write(packet),
      configuration: () => captureConfiguration(engineManagerRef.current, debugRef.current || spectatorRef.current), source: debugRef.current ? 'bench' : 'human', journal,
      ...(singleHand ? { journalKey: 'baoshan_practice_pending_v2' } : {}) });
    recorderRef.current = recorder;
    const update = () => setSaveState(recorder.getSnapshot());
    const unsubscribe = recorder.subscribe(update); update();
    const unsubscribeLog = decisionLogger.subscribe(() => {
      const snapshot = session.getSnapshot();
      for (const record of decisionLogger.getRecords()) {
        if (record.context?.sessionId !== snapshot.cursor.sessionId || record.context.nodeId !== snapshot.cursor.nodeId || record.status !== 'evaluated') continue;
        const configuration = captureConfiguration(engineManager, debugRef.current || spectatorRef.current);
        const evaluation = captureEvaluation(record, snapshot.game, record.actualProfile ? derivedHistoryId('profileVersion', record.actualProfile.version) : configuration.profiles.find(profile => profile.type === record.engineType)?.profileVersionId);
        if (evaluation) recorder.recordEvaluation(snapshot.cursor.nodeId, evaluation);
      }
    });
    return () => {
      unsubscribeLog(); unsubscribe();
      // StrictMode 在同一轮重挂 effect，保留同一个会话队列与持久身份。
      queueMicrotask(() => { if (recorderLease.current === lease) { recorder.dispose(); recorderRef.current = null; } });
    };
  }, [session, engineManager, singleHand]);
  useEffect(() => {
    let disposed = false;
    if (engineManager.getSeatRoutes() && (!engineManager.isUseServerDecision() || engineManager.getProfiles().some(profile => profile.parameters.execution === 'server'))) return;
    if (!engineManager.isUseServerDecision()) { engineManager.setProfiles(offlineProfiles()); loadSeatProfiles(engineManager); return; }
    void requestProfiles().then(profiles => { if (!disposed) { engineManager.setProfiles(profiles); loadSeatProfiles(engineManager); } }).catch(() => {});
    return () => { disposed = true; };
  }, [engineManager, profileRevision]);
  useEffect(() => engineManager.subscribe(() => {
    session.configurationChanged();
    recorderRef.current?.configurationChanged();
    setEngineTypeState(engineManager.getActiveType());
    setProfileRevision(value => value + 1);
  }), [engineManager, session]);
  useEffect(() => thinkingService.subscribe(setThinkingState), []);
  useEffect(() => {
    if (!lastDecision) return;
    const timer = window.setTimeout(() => setLastDecision(null), 4500);
    return () => window.clearTimeout(timer);
  }, [lastDecision]);
  useEffect(() => {
    engineManager.getAgent().setGodModeStateProvider(() => ({
      enabled: isDebugMode, peekedSeats: isDebugMode ? [...devPeekSeats] : [],
    }));
  }, [engineManager, isDebugMode, devPeekSeats]);
  useEffect(() => () => {
    session.cancelRequests();
    if (toastTimer.current) window.clearTimeout(toastTimer.current);
  }, [session]);
  const toggleDevPeek = useCallback((seat: number) => {
    if (!isDebugMode || ![0, 1, 2, 3].includes(seat)) return;
    setDevPeekSeats(previous => {
      const next = new Set(previous);
      if (next.has(seat)) next.delete(seat); else next.add(seat);
      return next;
    });
  }, [isDebugMode]);
  const setIsDebugMode = useCallback((debug: boolean) => {
    showPresentations([]); setObservedActions([]);
    session.setMode('paused');
    session.cancelRequests();
    debugRef.current = debug;
    setIsDebugModeState(debug);
    recorderRef.current?.configurationChanged();
    if (!singleHand) { try { localStorage.setItem('baoshan_debug_mode', String(debug)); } catch {} }
    // 看牌仅是临时展示状态；进入只展示人工座位，退出恢复普通规则可见范围。
    setDevPeekSeats(new Set(debug ? [humanSeat] : []));
  }, [session, showPresentations, humanSeat, singleHand]);
  const setIsStepMode = useCallback((step: boolean) => changeRunMode(step ? 'step' : 'auto'), [changeRunMode]);
  const setEngineType = useCallback((type: EngineType) => engineManager.setActiveType(type), [engineManager]);
  const toggleSoundMute = useCallback(() => {
    const muted = soundManager.toggleMute(); setSoundMuted(muted);
    if (!muted) { soundManager.unlock(); soundManager.selectCard(); }
    return muted;
  }, []);
  const toggleSpeech = useCallback(() => {
    const enabled = !speechManager.isEnabled();
    speechManager.setEnabled(enabled); setSpeechEnabled(enabled);
    if (enabled) { speechManager.unlock(); speechManager.announce('中文报牌已开启'); }
  }, []);
  /** 玩家偏好属于应用；切回保留的对局时同步显示与实际行为。 */
  const syncPlayerPreferences = useCallback((confirmBeforePlay: boolean) => {
    setSoundMuted(soundManager.isMuted());
    setSpeechEnabled(speechManager.isEnabled());
    setConfirmBeforePlay(confirmBeforePlay);
  }, [setConfirmBeforePlay]);
  const getAgent = useCallback((seat: number) => agentsRef.current?.[seat] ?? engineManager.getAgentForSeat(seat), [engineManager]);

  useEffect(() => {
    const unlock = () => { soundManager.unlock(); speechManager.unlock(); };
    document.addEventListener('pointerdown', unlock, true);
    document.addEventListener('keydown', unlock, true);
    return () => {
      document.removeEventListener('pointerdown', unlock, true);
      document.removeEventListener('keydown', unlock, true);
      speechManager.stop();
    };
  }, []);
  useEffect(() => {
    if (!presentation) return;
    if (['bid', 'trump', 'bury'].includes(presentation.kind)) soundManager.bidding();
    if (presentation.kind === 'play') {
      if (presentation.title.includes('主牌杀入')) soundManager.trumpKill(); else soundManager.playCard();
    }
    if (presentation.kind === 'score' && presentation.game.lastPoints > 0) soundManager.trickWin();
    if (presentation.kind === 'result') soundManager.victory();
    speechManager.announce(announcementForAction(presentation));
    return () => speechManager.stop();
  }, [presentation]);
  useEffect(() => {
    if (!presentation || state.mode !== 'auto') return;
    const timer = window.setTimeout(advancePresentation, presentationDelay(presentation, speed));
    return () => window.clearTimeout(timer);
  }, [presentation, state.mode, speed, advancePresentation]);

  // All async paths enter the same evaluator; commits check the cursor synchronously.
  useEffect(() => {
    const actor = currentSeat(game);
    if (presentationRef.current.length || saveState.status === 'error' || actor < 0 || state.mode === 'paused' || (!isDebugMode && !isSpectating && engineManager.isHumanSeat(actor))) return;
    if (state.mode === 'step' && !isSpectating && engineManager.isHumanSeat(actor)) return;
    let disposed = false;
    let timer: number | undefined;
    const started = performance.now();
    void session.evaluate(getAgent(actor), state.mode === 'auto' ? 'auto' : 'prefetch').then(result => {
      if (!result || disposed || state.mode !== 'auto') return;
      timer = window.setTimeout(() => {
        if (!disposed) session.commit(result.action, cursor, 'ai', result);
      }, Math.max(0, SPEED_MAP[speed] - (performance.now() - started)));
    }).catch(error => {
      if (!disposed) { session.setMode('paused'); flash(error instanceof Error ? error.message : 'AI 决策失败', true); }
    });
    return () => { disposed = true; if (timer !== undefined) window.clearTimeout(timer); };
  }, [game, cursor.sessionId, cursor.nodeId, cursor.epoch, cursor.configRevision, state.mode, isDebugMode, speed, session, getAgent, flash, saveState.status, profileRevision, engineManager, presentation, isSpectating]);

  const seat = currentSeat(game);
  const actorSeat = isSpectating ? -1 : isDebugMode ? seat : engineManager.isHumanSeat(seat) ? seat : -1;
  const humanTurn = seat >= 0 && engineManager.isHumanSeat(seat);
  const humanHand = useMemo(() => sortHand(game.hands[humanSeat] ?? []), [game.hands, humanSeat]);
  const humanKittyIds = useMemo(() => game.declarer === humanSeat ? new Set(pickedKitty.map(cardId)) : new Set<string>(), [game.declarer, pickedKitty, humanSeat]);
  const humanLegal = useMemo(() => new Set(legalMoves(game, humanSeat).map(cardId)), [game, humanSeat]);
  const bidOptions = useMemo(() => game.phase === 'bidding' ? legalBids(game) : [], [game]);
  /**
   * 实际生效的出牌确认策略，是**唯一**的策略来源：
   * 调试模式下恒为 true，保证关闭偏好后单击不会误推进单步。
   * UI（按钮/提示）与点击处理都必须读它，否则会出现「界面说点牌即出、实际要点两次」。
   */
  const effectiveConfirmBeforePlay = isDebugMode || playPrefs.confirmBeforePlay;
  const commit = useCallback((command: SessionCommand, source: 'human' | 'manual' | 'hint' = isDebugMode ? 'manual' : 'human') => {
    if (presentationRef.current.length) return false;
    try {
      const result = session.commit(command, cursor, source, source === 'hint' ? state.hint ?? undefined : undefined);
      // 人工动作沿用当前运行状态，暂停时不会隐式开启自动推进。
      return result;
    } catch (error) { flash(error instanceof Error ? error.message : '操作失败', true); return false; }
  }, [session, cursor, isDebugMode, state.hint, flash]);
  const confirmPlayCard = useCallback(() => {
    if (selectedPlayCard && game.phase === 'playing' && seat === actorSeat) {
      commit({ kind: 'play', seat, card: selectedPlayCard });
      setSelectedPlayCard(null);
    }
  }, [selectedPlayCard, game.phase, seat, actorSeat, commit]);
  const onCardClick = useCallback((card: Card) => {
    if (presentationRef.current.length) return;
    if (actorSeat < 0 || seat !== actorSeat || !game.hands[actorSeat].some(value => cardId(value) === cardId(card))) return;
    soundManager.selectCard();
    if (game.phase === 'bury') {
      if (cardPoints(card) > 0) { flash('分牌（A/10/5）不能扣底', true); return; }
      if (isDebugMode && state.mode === 'auto') session.setMode('paused');
      setSelected(previous => previous.some(value => cardId(value) === cardId(card))
        ? previous.filter(value => cardId(value) !== cardId(card)) : previous.length < game.kitty.length ? [...previous, card] : previous);
    } else if (game.phase === 'playing') {
      if (!legalMoves(game, actorSeat).some(value => cardId(value) === cardId(card))) { flash('同门必须跟同门', true); return; }
      const intent = resolvePlayClickIntent(card, selectedPlayCard, effectiveConfirmBeforePlay);
      if (intent === 'play') {
        commit({ kind: 'play', seat: actorSeat, card });
        setSelectedPlayCard(null);
      } else {
        if (isDebugMode && state.mode === 'auto') session.setMode('paused');
        setSelectedPlayCard(card);
      }
    }
  }, [game, actorSeat, seat, selectedPlayCard, effectiveConfirmBeforePlay, commit, isDebugMode, state.mode, session, flash]);
  const doBid = useCallback((amount: number | null) => commit({ kind: 'bid', seat: actorSeat, bid: amount }), [actorSeat, commit]);
  const doTrump = useCallback((trump: Suit) => commit({ kind: 'trump', seat: actorSeat, trump }), [actorSeat, commit]);
  const doBury = useCallback(() => commit({ kind: 'bury', seat: actorSeat, cards: selected }), [actorSeat, selected, commit]);
  const goNextHand = useCallback(() => {
    if (singleHand) return;
    if (presentationRef.current.length) return;
    setKittyRevealed(null); setPickedKitty([]);
    if (game.phase === 'matchEnd') { engineManager.beginHand(); session.replace(createGame(Date.now() % 100000, game.rules)); showPresentations(dealPresentation(session.getSnapshot().game)); }
    else commit({ kind: 'nextHand' });
  }, [game.phase, game.rules, commit, session, isDebugMode, engineManager, showPresentations, singleHand]);
  const manualPlaySeatCard = useCallback((actor: number, card: Card) => {
    if (!isDebugMode || actor !== seat) return;
    commit({ kind: 'play', seat: actor, card });
  }, [isDebugMode, seat, commit]);
  const stepNext = useCallback(async () => {
    if (presentationRef.current.length) { session.setMode('paused'); advancePresentation(); return; }
    if (saveState.status === 'error') { flash('请先重试保存，再继续自动行动', true); return; }
    // 手动提交先使用当前渲染游标，提交后暂停；提前暂停会增加 epoch，使合法提交被误拒绝。
    if (game.phase === 'handEnd' || game.phase === 'matchEnd') { goNextHand(); session.setMode('paused'); return; }
    if (selectedPlayCard) { confirmPlayCard(); session.setMode('paused'); return; }
    if (state.mode === 'auto') session.setMode('paused');
    // An explicit AI step is valid for all four seats, including South.
    try { await session.step(getAgent(seat)); } catch (error) { flash(error instanceof Error ? error.message : 'AI 决策失败', true); }
  }, [game.phase, selectedPlayCard, confirmPlayCard, goNextHand, session, getAgent, seat, flash, saveState.status, advancePresentation, state.mode]);
  const triggerAiHint = useCallback(async () => {
    if (presentationRef.current.length) return;
    if (state.mode === 'auto') session.setMode('paused');
    try { await session.evaluate(getAgent(seat), 'hint'); } catch (error) { flash(error instanceof Error ? error.message : 'AI 提示失败', true); }
  }, [session, getAgent, seat, state.mode, flash]);
  const applyHint = useCallback(() => {
    if (state.hint) commit(state.hint.action, 'hint');
  }, [state.hint, commit]);
  const autoSelectBury = useCallback(() => {
    if (presentationRef.current.length || game.phase !== 'bury' || game.declarer !== actorSeat) return;
    if (isDebugMode && state.mode === 'auto') session.setMode('paused');
    setSelected(smartBury(game, actorSeat));
  }, [game, actorSeat, isDebugMode, state.mode, session]);
  const clearSelectedBury = useCallback(() => setSelected([]), []);
  const restart = useCallback((seed?: number) => {
    showPresentations([]); setObservedActions([]);
    setKittyRevealed(null); setPickedKitty([]);
    engineManager.beginHand();
    session.replace(seed === undefined && isDebugMode ? session.getRestartState() : createGame(seed ?? Date.now() % 100000, game.rules));
    showPresentations(dealPresentation(session.getSnapshot().game));
  }, [session, isDebugMode, game.rules, engineManager, showPresentations]);
  const undo = useCallback(() => { showPresentations([]); setObservedActions([]); return session.undo(); }, [session, showPresentations]);
  const redo = useCallback(() => {
    showPresentations([]); setObservedActions([]);
    const before = session.getSnapshot();
    if (!session.redo()) return false;
    const after = session.getSnapshot();
    const command = session.getReplay().commands.at(-1);
    if (command) showPresentations(commitPresentation({ command, before: before.game, after: after.game, from: before.cursor, to: after.cursor, source: 'manual' }, { humanSeat, debug: isDebugMode || isSpectating, peekedSeats: isDebugMode ? devPeekSeats : new Set() }));
    return true;
  }, [session, showPresentations, humanSeat, isDebugMode, devPeekSeats, isSpectating]);
  const saveSnapshot = useCallback(() => exportSnapshot(game, { activeEngine: engineType }, session.getReplay()), [game, engineType, session]);
  const loadSnapshot = useCallback((json: string) => {
    const imported = importSnapshot(json); // Validate fully before changing anything.
    showPresentations([]); setObservedActions([]);
    engineManager.setActiveType(imported.config.activeEngine);
    if (imported.replay) session.restore(imported.replay.initialState, imported.replay.commands);
    else session.replace(imported.state);
    setKittyRevealed(null); setPickedKitty([]);
    flash('快照已恢复，当前暂停；可恢复历史或继续行动');
  }, [engineManager, session, flash, showPresentations]);
  const rewind = useCallback(() => { showPresentations([]); setObservedActions([]); session.rewind(); }, [session, showPresentations]);
  const startSpectating = useCallback(() => {
    if (isDebugMode) setIsDebugMode(false);
    spectatorRef.current = true; setIsSpectating(true);
    recorderRef.current?.configurationChanged(); session.setMode('paused');
  }, [session, isDebugMode, setIsDebugMode]);
  const stopSpectating = useCallback(() => {
    spectatorRef.current = false; session.setMode('paused'); setIsSpectating(false); showPresentations([]); setObservedActions([]);
    recorderRef.current?.configurationChanged();
  }, [session, showPresentations]);
  const pause = useCallback(() => { speechManager.stop(); changeRunMode('paused'); }, [changeRunMode]);
  const resumeHistory = useCallback(async (detail: HandDetail) => {
    // 即使调用方提供对象也再走完整导出校验，不能覆盖损坏/未知规则的活动局。
    const validated = readHandDetail(exportHand(detail));
    const recorder = recorderRef.current;
    if (!recorder || recorder.getSnapshot().status !== 'saved') throw new Error('请先完成当前对局保存，再恢复历史');
    const frozen = validated.profiles.filter(profile => profile.implementationVersion === PROFILE_IMPLEMENTATION_VERSION) as EngineProfile[];
    if (frozen.length) {
      const expected = session.getSnapshot().cursor;
      const serverProfiles = frozen.filter(profile => profile.parameters.execution === 'server');
      if (serverProfiles.length) await requestProfiles({ resolve: serverProfiles.map(profile => ({ profileId: profile.profileId, version: profile.version })) });
      if (!session.isCurrent(expected) || recorder.getSnapshot().status !== 'saved') throw new Error('当前对局已变化，请重新恢复历史');
      const actual = validated.branches.find(branch => branch.kind === 'actual')!;
      const routes: SeatRoute[] = [0,1,2,3].map(seat => {
        const assigned = validated.assignments.filter(value => value.branchId === actual.branchId && value.seat === seat).at(-1);
        if (assigned?.kind === 'human') return 'human';
        const profile = frozen.find(value => value.profileVersionId === assigned?.profileVersionId); if (!profile) throw new Error('历史四座配置缺失');
        return { profileId: profile.profileId, version: profile.version };
      });
      engineManager.restoreProfiles(frozen, routes);
    }
    showPresentations([]); setObservedActions([]);
    recorder.resume(validated);
    setKittyRevealed(null); setPickedKitty([]);
    flash('已恢复，当前暂停；可手动继续或开启自动行动');
  }, [flash, engineManager, session, showPresentations]);
  const readyDecision = state.hint ?? state.pending;
  const readCurrentHand = useCallback(async () => {
    const expected = session.getSnapshot().cursor;
    const reference = recorderRef.current?.currentHand();
    if (!reference) throw new Error('本副记录尚未保存，保存完成后再复盘');
    const detail = await historyClient.detail(reference.handId);
    if (!session.isCurrent(expected)) throw new Error('当前牌局已变化，请重新打开本副复盘');
    const frames = replayPath(detail, reference.branchId);
    if (frames.at(-1)?.node?.nodeId !== reference.nodeId || !frames.at(-1)?.state.result) throw new Error('本副结算记录尚未完整保存，请重试');
    return { detail, branchId: reference.branchId };
  }, [session]);
  const decisionNotice: SeatDecisionNotice | null = readyDecision && !isThinking
    ? {
      id: readyDecision.context.requestId,
      action: readyDecision.action,
      conclusion: thinkingState.seat === readyDecision.action.seat && thinkingState.phase === 'decided'
        ? thinkingState.conclusion : undefined,
      committed: false,
    }
    : lastDecision;
  return {
    saveState, readCurrentHand, retrySave: () => recorderRef.current?.retry(), exportPendingHistory: () => recorderRef.current?.exportPending() ?? '', resumeHistory,
    isSpectating, startSpectating, stopSpectating,
    presentation, advancePresentation, observedActions,
    game, seat, humanSeat, humanTurn, humanHand, humanKittyIds, humanLegal, bidOptions,
    selected, selectedPlayCard, kittyRevealed, pickedKitty, speed, setSpeed, engineType, setEngineType, toast,
    showRulesModal, setShowRulesModal, showLastTrickModal, setShowLastTrickModal, showHistoryModal, setShowHistoryModal,
    showPointsLedger, setShowPointsLedger, showEngineSettings, setShowEngineSettings,
    showDecisionLogModal, setShowDecisionLogModal, selectedDecisionId, setSelectedDecisionId,
    devPeekSeats, toggleDevPeek,
    engineManager,
    dismissKittyRevealed: () => setKittyRevealed(null),
    isDebugMode, setIsDebugMode, isStepMode, setIsStepMode, pendingAiAction, aiHintAction, isThinking,
    soundMuted, toggleSoundMute, speechEnabled, speechAvailable: speechManager.isAvailable(), toggleSpeech, syncPlayerPreferences, stepNext, triggerAiHint, applyHint, manualPlaySeatCard,
    onCardClick, confirmPlayCard, doBid, doTrump, doBury, autoSelectBury, clearSelectedBury, goNextHand,
    flash, confirmBeforePlay: effectiveConfirmBeforePlay, confirmPreference: playPrefs.confirmBeforePlay, setConfirmBeforePlay,
    restart, undo, canUndo, redo, canRedo, saveSnapshot, loadSnapshot, rewind, pause,
    sessionMode: state.mode, sessionCursor: cursor,
    decisionNotice: decisionNotice?.id === dismissedDecisionId ? null : decisionNotice,
    dismissDecisionNotice: () => setDismissedDecisionId(decisionNotice?.id ?? null),
  };
}
export type GameController = ReturnType<typeof useGame>;
