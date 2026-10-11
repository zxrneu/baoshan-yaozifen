import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { Card, Suit, cardId, cardPoints, sortHand } from '../cards';
import { createGame, currentSeat, legalBids, legalMoves } from '../engine';
import { AiAction, PlayerAgent, smartBury, defaultEngineManager, DecisionEngineManager, EngineType } from '../ai';
import { loadEngineSettings, DEFAULT_GOD_MODE } from '../ai/engines/engineSettings';
import { decisionLogger, thinkingService, ThinkingState } from '../ai/engines';
import { soundManager } from '../audio/soundManager';
import { GameSession, SessionCommand } from '../workbench/session';
import { exportSnapshot, importSnapshot } from '../workbench/snapshot';

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
}
function savedDebug(): boolean {
  try { return localStorage.getItem('baoshan_debug_mode') === 'true'; } catch { return false; }
}
export function useGame({ agents, defaultSpeed = 'normal', engineManager = defaultEngineManager }: UseGameOptions = {}) {
  const [session] = useState(() => {
    const value = new GameSession(createGame(Date.now() % 100000));
    if (!savedDebug()) value.setMode('auto');
    return value;
  });
  const state = useSyncExternalStore(session.subscribe, session.getSnapshot);
  const { game, cursor, isThinking, canUndo, canRedo } = state;
  const pendingAiAction = state.pending?.action ?? null;
  const aiHintAction = state.hint?.action ?? null;
  const [thinkingState, setThinkingState] = useState<ThinkingState>(() => thinkingService.getState());
  const [lastDecision, setLastDecision] = useState<SeatDecisionNotice | null>(null);
  const [dismissedDecisionId, setDismissedDecisionId] = useState<string | null>(null);
  const [isDebugMode, setIsDebugModeState] = useState(savedDebug);
  const isStepMode = state.mode !== 'auto';
  const [speed, setSpeed] = useState<GameSpeed>(defaultSpeed);
  const [engineType, setEngineTypeState] = useState<EngineType>(() => engineManager.getActiveType());
  const [toast, setToast] = useState<Toast>(null);
  const [selected, setSelected] = useState<Card[]>([]);
  const [selectedPlayCard, setSelectedPlayCard] = useState<Card | null>(null);
  const [kittyRevealed, setKittyRevealed] = useState<Card[] | null>(null);
  const [pickedKitty, setPickedKitty] = useState<Card[]>([]);
  const [soundMuted, setSoundMuted] = useState(() => soundManager.isMuted());
  const [showRulesModal, setShowRulesModal] = useState(false);
  const [showLastTrickModal, setShowLastTrickModal] = useState(false);
  const [showHistoryModal, setShowHistoryModal] = useState(false);
  const [showPointsLedger, setShowPointsLedger] = useState(false);
  const [showEngineSettings, setShowEngineSettings] = useState(false);
  const [showDecisionLogModal, setShowDecisionLogModal] = useState(false);
  const [selectedDecisionId, setSelectedDecisionId] = useState<string | undefined>();
  const [godModeEnabled, setGodModeEnabledState] = useState(() => savedDebug() || (loadEngineSettings().godMode ?? DEFAULT_GOD_MODE));
  const [devPeekSeats, setDevPeekSeats] = useState<Set<number>>(() => savedDebug() ? new Set([0, 2, 3]) : new Set());
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
    const action = event.command;
    if (action.kind !== 'nextHand') {
      const record = event.requestId
        ? decisionLogger.getRecords().find(value => value.context?.requestId === event.requestId)
        : undefined;
      setLastDecision({ id: event.to.nodeId, action, conclusion: record?.conclusion, committed: true });
    }
    if (action.kind === 'bid') soundManager.bidding();
    if (action.kind === 'play') {
      const kill = event.before.trump === action.card.suit && event.before.trick.length > 0 && event.before.trick[0].card.suit !== event.before.trump;
      if (kill) soundManager.trumpKill(); else soundManager.playCard();
    }
    if (action.kind === 'trump' && action.seat === HUMAN_SEAT) {
      setPickedKitty([...event.before.kitty]);
      if (!isDebugMode) setKittyRevealed([...event.before.kitty]);
    }
    if (event.after.phase === 'handEnd' || event.after.phase === 'matchEnd') soundManager.victory();
    else if (event.after.completedTricks.length > event.before.completedTricks.length && event.after.lastPoints > 0) soundManager.trickWin();
  };
  useEffect(() => engineManager.subscribe(() => {
    session.configurationChanged();
    setEngineTypeState(engineManager.getActiveType());
  }), [engineManager, session]);
  useEffect(() => thinkingService.subscribe(setThinkingState), []);
  useEffect(() => {
    if (!lastDecision) return;
    const timer = window.setTimeout(() => setLastDecision(null), 4500);
    return () => window.clearTimeout(timer);
  }, [lastDecision]);
  useEffect(() => {
    engineManager.getAgent().setGodModeStateProvider(() => ({
      enabled: isDebugMode || godModeEnabled, peekedSeats: isDebugMode ? [0, 2, 3] : [...devPeekSeats],
    }));
  }, [engineManager, isDebugMode, godModeEnabled, devPeekSeats]);
  useEffect(() => () => {
    session.cancelRequests();
    if (toastTimer.current) window.clearTimeout(toastTimer.current);
  }, [session]);
  const setGodModeEnabled = useCallback((enabled: boolean) => {
    setGodModeEnabledState(enabled);
    if (!enabled) setDevPeekSeats(new Set());
  }, []);
  const toggleDevPeek = useCallback((seat: number) => {
    if (!godModeEnabled) return;
    setDevPeekSeats(previous => {
      const next = new Set(previous);
      if (next.has(seat)) next.delete(seat); else next.add(seat);
      return next;
    });
  }, [godModeEnabled]);
  const isAllPeeked = [0, 2, 3].every(seat => devPeekSeats.has(seat));
  const toggleAllPeek = useCallback(() => {
    if (!godModeEnabled) return;
    setDevPeekSeats(previous => [0, 2, 3].every(seat => previous.has(seat)) ? new Set() : new Set([0, 2, 3]));
  }, [godModeEnabled]);
  const setIsDebugMode = useCallback((debug: boolean) => {
    session.setMode(debug ? 'paused' : 'auto');
    session.cancelRequests();
    setIsDebugModeState(debug);
    try { localStorage.setItem('baoshan_debug_mode', String(debug)); } catch {}
    if (debug) { setGodModeEnabledState(true); setDevPeekSeats(new Set([0, 2, 3])); }
  }, [session]);
  const setIsStepMode = useCallback((step: boolean) => session.setMode(step ? 'step' : 'auto'), [session]);
  const setEngineType = useCallback((type: EngineType) => engineManager.setActiveType(type), [engineManager]);
  const toggleSoundMute = useCallback(() => {
    const muted = soundManager.toggleMute(); setSoundMuted(muted); return muted;
  }, []);
  const getAgent = useCallback((seat: number) => agentsRef.current?.[seat] ?? engineManager.getAgent(), [engineManager]);

  // All async paths enter the same evaluator; commits check the cursor synchronously.
  useEffect(() => {
    const actor = currentSeat(game);
    if (actor < 0 || state.mode === 'paused' || (!isDebugMode && actor === HUMAN_SEAT)) return;
    if (state.mode === 'step' && actor === HUMAN_SEAT) return;
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
  }, [game, cursor.sessionId, cursor.nodeId, cursor.epoch, cursor.configRevision, state.mode, isDebugMode, speed, session, getAgent, flash]);

  const seat = currentSeat(game);
  const actorSeat = isDebugMode ? seat : HUMAN_SEAT;
  const humanTurn = seat === HUMAN_SEAT;
  const humanHand = useMemo(() => sortHand(game.hands[HUMAN_SEAT] ?? []), [game.hands]);
  const humanKittyIds = useMemo(() => game.declarer === HUMAN_SEAT ? new Set(pickedKitty.map(cardId)) : new Set<string>(), [game.declarer, pickedKitty]);
  const humanLegal = useMemo(() => new Set(legalMoves(game, HUMAN_SEAT).map(cardId)), [game]);
  const bidOptions = useMemo(() => game.phase === 'bidding' ? legalBids(game) : [], [game]);
  const commit = useCallback((command: SessionCommand, source: 'human' | 'manual' | 'hint' = isDebugMode ? 'manual' : 'human') => {
    try {
      const result = session.commit(command, cursor, source, source === 'hint' ? state.hint ?? undefined : undefined);
      // Normal play continues for the computer seats after a human command.
      if (result && !isDebugMode) session.setMode('auto');
      return result;
    } catch (error) { flash(error instanceof Error ? error.message : '操作失败', true); return false; }
  }, [session, cursor, isDebugMode, state.hint, flash]);
  const confirmPlayCard = useCallback(() => {
    if (selectedPlayCard && game.phase === 'playing' && seat === actorSeat) commit({ kind: 'play', seat, card: selectedPlayCard });
  }, [selectedPlayCard, game.phase, seat, actorSeat, commit]);
  const onCardClick = useCallback((card: Card) => {
    if (actorSeat < 0 || seat !== actorSeat || !game.hands[actorSeat].some(value => cardId(value) === cardId(card))) return;
    soundManager.selectCard();
    if (game.phase === 'bury') {
      if (cardPoints(card) > 0) { flash('分牌（A/10/5）不能扣底', true); return; }
      if (isDebugMode && state.mode === 'auto') session.setMode('paused');
      setSelected(previous => previous.some(value => cardId(value) === cardId(card))
        ? previous.filter(value => cardId(value) !== cardId(card)) : previous.length < game.kitty.length ? [...previous, card] : previous);
    } else if (game.phase === 'playing') {
      if (!legalMoves(game, actorSeat).some(value => cardId(value) === cardId(card))) { flash('同门必须跟同门', true); return; }
      if (selectedPlayCard && cardId(selectedPlayCard) === cardId(card)) commit({ kind: 'play', seat: actorSeat, card });
      else {
        if (isDebugMode && state.mode === 'auto') session.setMode('paused');
        setSelectedPlayCard(card);
      }
    }
  }, [game, actorSeat, seat, selectedPlayCard, commit, isDebugMode, state.mode, session, flash]);
  const doBid = useCallback((amount: number | null) => commit({ kind: 'bid', seat: actorSeat, bid: amount }), [actorSeat, commit]);
  const doTrump = useCallback((trump: Suit) => commit({ kind: 'trump', seat: actorSeat, trump }), [actorSeat, commit]);
  const doBury = useCallback(() => commit({ kind: 'bury', seat: actorSeat, cards: selected }), [actorSeat, selected, commit]);
  const goNextHand = useCallback(() => {
    setKittyRevealed(null); setPickedKitty([]);
    if (game.phase === 'matchEnd') session.replace(createGame(Date.now() % 100000, game.rules));
    else commit({ kind: 'nextHand' });
    if (!isDebugMode) session.setMode('auto');
  }, [game.phase, game.rules, commit, session, isDebugMode]);
  const manualPlaySeatCard = useCallback((actor: number, card: Card) => {
    if (!isDebugMode || actor !== seat) return;
    commit({ kind: 'play', seat: actor, card });
  }, [isDebugMode, seat, commit]);
  const stepNext = useCallback(async () => {
    if (game.phase === 'handEnd' || game.phase === 'matchEnd') { goNextHand(); return; }
    if (selectedPlayCard) { confirmPlayCard(); return; }
    // An explicit AI step is valid for all four seats, including South.
    try { await session.step(getAgent(seat)); } catch (error) { flash(error instanceof Error ? error.message : 'AI 决策失败', true); }
  }, [game.phase, selectedPlayCard, confirmPlayCard, goNextHand, session, getAgent, seat, flash]);
  const triggerAiHint = useCallback(async () => {
    if (state.mode === 'auto') session.setMode('paused');
    try { await session.evaluate(getAgent(seat), 'hint'); } catch (error) { flash(error instanceof Error ? error.message : 'AI 提示失败', true); }
  }, [session, getAgent, seat, state.mode, flash]);
  const applyHint = useCallback(() => {
    if (state.hint) commit(state.hint.action, 'hint');
  }, [state.hint, commit]);
  const autoSelectBury = useCallback(() => {
    if (game.phase !== 'bury' || game.declarer !== actorSeat) return;
    if (isDebugMode && state.mode === 'auto') session.setMode('paused');
    setSelected(smartBury(game, actorSeat));
  }, [game, actorSeat, isDebugMode, state.mode, session]);
  const clearSelectedBury = useCallback(() => setSelected([]), []);
  const restart = useCallback((seed?: number) => {
    setKittyRevealed(null); setPickedKitty([]);
    session.replace(seed === undefined && isDebugMode ? session.getRestartState() : createGame(seed ?? Date.now() % 100000, game.rules));
    if (!isDebugMode) session.setMode('auto');
  }, [session, isDebugMode, game.rules]);
  const undo = useCallback(() => session.undo(), [session]);
  const redo = useCallback(() => session.redo(), [session]);
  const saveSnapshot = useCallback(() => exportSnapshot(game, { activeEngine: engineType }, session.getReplay()), [game, engineType, session]);
  const loadSnapshot = useCallback((json: string) => {
    const imported = importSnapshot(json); // Validate fully before changing anything.
    engineManager.setActiveType(imported.config.activeEngine);
    if (imported.replay) session.restore(imported.replay.initialState, imported.replay.commands);
    else session.replace(imported.state);
    setKittyRevealed(null); setPickedKitty([]);
    flash('快照已恢复，当前暂停；可恢复历史或继续行动');
  }, [engineManager, session, flash]);
  const rewind = useCallback(() => session.rewind(), [session]);
  const pause = useCallback(() => session.setMode('paused'), [session]);
  const readyDecision = state.hint ?? state.pending;
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
    game, seat, humanSeat: HUMAN_SEAT, humanTurn, humanHand, humanKittyIds, humanLegal, bidOptions,
    selected, selectedPlayCard, kittyRevealed, speed, setSpeed, engineType, setEngineType, toast,
    showRulesModal, setShowRulesModal, showLastTrickModal, setShowLastTrickModal, showHistoryModal, setShowHistoryModal,
    showPointsLedger, setShowPointsLedger, showEngineSettings, setShowEngineSettings,
    showDecisionLogModal, setShowDecisionLogModal, selectedDecisionId, setSelectedDecisionId,
    godModeEnabled, setGodModeEnabled, devPeekSeats, isAllPeeked, toggleDevPeek, toggleAllPeek,
    isGodMode: isAllPeeked, toggleGodMode: toggleAllPeek, engineManager,
    dismissKittyRevealed: () => setKittyRevealed(null),
    isDebugMode, setIsDebugMode, isStepMode, setIsStepMode, pendingAiAction, aiHintAction, isThinking,
    soundMuted, toggleSoundMute, stepNext, triggerAiHint, applyHint, manualPlaySeatCard,
    onCardClick, confirmPlayCard, doBid, doTrump, doBury, autoSelectBury, clearSelectedBury, goNextHand,
    restart, undo, canUndo, redo, canRedo, saveSnapshot, loadSnapshot, rewind, pause,
    sessionMode: state.mode, sessionCursor: cursor,
    decisionNotice: decisionNotice?.id === dismissedDecisionId ? null : decisionNotice,
    dismissDecisionNotice: () => setDismissedDecisionId(decisionNotice?.id ?? null),
  };
}
export type GameController = ReturnType<typeof useGame>;
