/**
 * useGame：对局编排 hook。
 * 职责：持有 GameState、驱动非人类座位（通过可插拔的 PlayerAgent）、
 * 把人类操作转成引擎调用、提供出牌防误触、底牌揭晓、记账与规则弹窗等交互状态。
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Card, Suit, cardId, cardPoints, sortHand } from '../cards';
import {
  GameState, IllegalActionError, bid, bury, createGame, currentSeat,
  declareTrump, legalBids, legalMoves, nextHand, playCard, SEAT_NAMES,
} from '../engine';
import {
  PlayerAgent, applyAiAction, isAsyncPlayerAgent, smartBury,
  defaultEngineManager, DecisionEngineManager, EngineType, AiAction,
} from '../ai';
import { loadEngineSettings, DEFAULT_GOD_MODE } from '../ai/engines/engineSettings';
import { soundManager } from '../audio/soundManager';

export const HUMAN_SEAT = 1; // 南

export type GameSpeed = 'fast' | 'normal' | 'slow';
const SPEED_MAP: Record<GameSpeed, number> = {
  fast: 260,
  normal: 650,
  slow: 1200,
};

type Toast = { text: string; bad: boolean } | null;

export interface UseGameOptions {
  /** 座位 → 决策者；未配置的非人类座位使用统一配置引擎 */
  agents?: Partial<Record<number, PlayerAgent>>;
  defaultSpeed?: GameSpeed;
  engineManager?: DecisionEngineManager;
}

export function useGame({
  agents,
  defaultSpeed = 'normal',
  engineManager = defaultEngineManager,
}: UseGameOptions = {}) {
  const [game, setGame] = useState<GameState>(() => createGame(Date.now() % 100000));
  const [speed, setSpeed] = useState<GameSpeed>(defaultSpeed);
  const [engineType, setEngineTypeState] = useState<EngineType>(() => engineManager.getActiveType());
  const [toast, setToast] = useState<Toast>(null);
  const [selected, setSelected] = useState<Card[]>([]); // 扣底多选
  const [selectedPlayCard, setSelectedPlayCard] = useState<Card | null>(null); // 出牌防误触选中
  const [kittyRevealed, setKittyRevealed] = useState<Card[] | null>(null); // 庄家摸底揭晓展示
  const [pickedKitty, setPickedKitty] = useState<Card[]>([]); // 本副摸入的底牌，关闭揭晓后仍标识

  // 上帝调试模式与单步控制
  const [isDebugMode, setIsDebugModeState] = useState<boolean>(() => {
    try { return localStorage.getItem('baoshan_debug_mode') === 'true'; } catch { return false; }
  });
  const [isStepMode, setIsStepMode] = useState<boolean>(true);
  const [pendingAiAction, setPendingAiAction] = useState<AiAction | null>(null);
  const [aiHintAction, setAiHintAction] = useState<AiAction | null>(null);
  const [isThinking, setIsThinking] = useState<boolean>(false);
  const [soundMuted, setSoundMuted] = useState<boolean>(() => soundManager.isMuted());

  // 模态弹窗状态
  const [showRulesModal, setShowRulesModal] = useState(false);
  const [showLastTrickModal, setShowLastTrickModal] = useState(false);
  const [showHistoryModal, setShowHistoryModal] = useState(false);
  const [showPointsLedger, setShowPointsLedger] = useState(false);
  const [showEngineSettings, setShowEngineSettings] = useState(false);
  const [showDecisionLogModal, setShowDecisionLogModal] = useState(false);
  const [selectedDecisionId, setSelectedDecisionId] = useState<string | undefined>(undefined);

  // 开发调试透视看牌（God Mode / Peeking）
  const [godModeEnabled, setGodModeEnabledState] = useState<boolean>(() => {
    try {
      if (localStorage.getItem('baoshan_debug_mode') === 'true') return true;
    } catch {}
    return loadEngineSettings().godMode ?? DEFAULT_GOD_MODE;
  });
  const [devPeekSeats, setDevPeekSeats] = useState<Set<number>>(() => {
    try {
      if (localStorage.getItem('baoshan_debug_mode') === 'true') return new Set([0, 2, 3]);
    } catch {}
    return new Set();
  });

  const setGodModeEnabled = useCallback((enabled: boolean) => {
    console.info(
      `%c[GodMode] 上帝视角全局开关: ${enabled ? '🟢 开启' : '🔴 关闭'}`,
      'color: #9333ea; font-weight: bold;',
      { enabled, source: 'EngineSettingsModal', timestamp: new Date().toLocaleTimeString() },
    );
    setGodModeEnabledState(enabled);
    if (!enabled) {
      setDevPeekSeats(new Set());
    }
  }, []);

  const toggleDevPeek = useCallback((s: number) => {
    if (!godModeEnabled) {
      console.warn(`[GodMode] 无法透视：上帝模式未开启，请先在“AI引擎设置”中开启上帝模式`);
      return;
    }
    setDevPeekSeats((prev) => {
      const next = new Set(prev);
      const isNowPeeked = !next.has(s);
      if (isNowPeeked) next.add(s);
      else next.delete(s);
      console.info(
        `%c[GodMode] 玩家手牌透视切换: [${SEAT_NAMES[s]}家] ➔ ${isNowPeeked ? '👀 翻开明手' : '🙈 收起暗牌'}`,
        'color: #9333ea; font-weight: bold;',
        {
          seat: s,
          seatName: SEAT_NAMES[s],
          action: isNowPeeked ? 'peek' : 'unpeek',
          currentPeekedSeats: Array.from(next).map((idx) => SEAT_NAMES[idx]),
        },
      );
      return next;
    });
  }, [godModeEnabled]);

  const isAllPeeked = [0, 2, 3].every((s) => devPeekSeats.has(s));

  const toggleAllPeek = useCallback(() => {
    if (!godModeEnabled) {
      console.warn('[GodMode] 无法切换全明手：上帝模式未开启，请先在“AI引擎设置”中开启上帝模式');
      return;
    }
    setDevPeekSeats((prev) => {
      const allActive = [0, 2, 3].every((s) => prev.has(s));
      const next = allActive ? new Set<number>() : new Set<number>([0, 2, 3]);
      console.info(
        `%c[GodMode] 全明手一键切换: ${allActive ? '🙈 全体收起暗牌' : '👀 全部翻开明手'}`,
        'color: #9333ea; font-weight: bold;',
        {
          isAllPeeked: !allActive,
          peekedSeats: Array.from(next).map((idx) => SEAT_NAMES[idx]),
        },
      );
      return next;
    });
  }, [godModeEnabled]);

  // 初始化打印上帝模式状态
  useEffect(() => {
    console.info(
      `%c[GodMode] 牌桌初始化状态: ${godModeEnabled ? '🟢 上帝模式开启' : '🔒 上帝模式关闭 (默认)'}`,
      'color: #9333ea; font-weight: bold;',
      { godModeEnabled, envDefault: DEFAULT_GOD_MODE },
    );
  }, []);

  // 同步上帝模式状态感知至 EnginePlayerAgent
  useEffect(() => {
    const agent = engineManagerRef.current.getAgent();
    if (agent && typeof (agent as any).setGodModeStateProvider === 'function') {
      (agent as any).setGodModeStateProvider(() => ({
        enabled: godModeEnabled,
        peekedSeats: Array.from(devPeekSeats),
      }));
    }
  }, [godModeEnabled, devPeekSeats]);

  const toastTimer = useRef<number | null>(null);
  const agentsRef = useRef(agents);
  agentsRef.current = agents;
  const engineManagerRef = useRef(engineManager);
  engineManagerRef.current = engineManager;
  const godModeRef = useRef({ enabled: godModeEnabled, peekedSeats: devPeekSeats });
  godModeRef.current = { enabled: godModeEnabled, peekedSeats: devPeekSeats };

  const setIsDebugMode = useCallback((debug: boolean) => {
    setIsDebugModeState(debug);
    try {
      localStorage.setItem('baoshan_debug_mode', String(debug));
    } catch {}
    if (debug) {
      setGodModeEnabledState(true);
      setDevPeekSeats(new Set([0, 2, 3]));
      setIsStepMode(true);
    }
  }, []);

  const toggleSoundMute = useCallback(() => {
    const next = soundManager.toggleMute();
    setSoundMuted(next);
    return next;
  }, []);

  const setEngineType = useCallback((type: EngineType) => {
    engineManagerRef.current.setActiveType(type);
    setEngineTypeState(type);
  }, []);

  const flash = useCallback((text: string, bad = false) => {
    setToast({ text, bad });
    if (toastTimer.current) window.clearTimeout(toastTimer.current);
    toastTimer.current = window.setTimeout(() => setToast(null), 2600);
  }, []);

  const [historyStack, setHistoryStack] = useState<GameState[]>([]);

  const safeApply = useCallback((fn: () => GameState) => {
    try {
      const nextG = fn();
      if (nextG.phase === 'handEnd' || nextG.phase === 'matchEnd') {
        soundManager.victory();
      } else if (
        nextG.lastTrick.length === 4 &&
        nextG.lastPoints > 0 &&
        nextG.completedTricks.length > game.completedTricks.length
      ) {
        soundManager.trickWin();
      }
      setHistoryStack((prev) => [...prev.slice(-30), game]);
      setGame(nextG);
      setSelected([]);
      setSelectedPlayCard(null);
      setPendingAiAction(null);
      setAiHintAction(null);
    } catch (e) {
      if (e instanceof IllegalActionError) flash(e.message, true);
      else throw e;
    }
  }, [game, flash]);

  const undo = useCallback(() => {
    if (historyStack.length === 0) {
      flash('已无更多历史步骤可撤销', true);
      return false;
    }
    const prev = historyStack[historyStack.length - 1];
    setHistoryStack((s) => s.slice(0, -1));
    setGame(prev);
    setSelected([]);
    setSelectedPlayCard(null);
    setPendingAiAction(null);
    setAiHintAction(null);
    flash('已撤销上一步操作', false);
    return true;
  }, [historyStack, flash]);

  // AI 驱动：轮到非人类座位时由其 PlayerAgent 行动
  const currentDelay = SPEED_MAP[speed];
  useEffect(() => {
    if (game.phase === 'handEnd' || game.phase === 'matchEnd') return;
    const seat = currentSeat(game);
    if (seat < 0 || seat === HUMAN_SEAT) return;

    // 若开启了上帝调试模式且处于单步控制模式，先预推演动作与思考，等待用户点击 Next 或手动出牌
    if (isDebugMode && isStepMode) {
      const defaultAgent = engineManagerRef.current.getAgent();
      const agent = agentsRef.current?.[seat] ?? defaultAgent;
      const controller = new AbortController();
      setIsThinking(true);
      const precompute = async () => {
        try {
          const action = isAsyncPlayerAgent(agent)
            ? await agent.nextActionAsync(game, controller.signal)
            : agent.nextAction(game);
          if (!controller.signal.aborted && action) {
            setPendingAiAction(action);
          }
        } catch (err: unknown) {
          if (!controller.signal.aborted) {
            flash(err instanceof Error ? err.message : 'AI 决策失败', true);
          }
        } finally {
          if (!controller.signal.aborted) setIsThinking(false);
        }
      };
      void precompute();
      return () => {
        controller.abort();
      };
    }

    const defaultAgent = engineManagerRef.current.getAgent();
    const agent = agentsRef.current?.[seat] ?? defaultAgent;
    const controller = new AbortController();
    const started = performance.now();
    let timer: number | undefined;
    const run = async () => {
      console.info(
        `%c[AI Turn] 🎯 [${SEAT_NAMES[seat]}家] 开始行动 · 引擎: ${engineType}`,
        'color: #0d9488; font-weight: bold;',
        {
          seat,
          seatName: SEAT_NAMES[seat],
          phase: game.phase,
          trickNumber: game.trickNumber,
          cardsInHand: game.hands[seat]?.length,
          godMode: {
            enabled: godModeRef.current.enabled,
            peekedSeats: Array.from(godModeRef.current.peekedSeats).map((idx) => SEAT_NAMES[idx]),
          },
        },
      );
      const action = isAsyncPlayerAgent(agent)
        ? await agent.nextActionAsync(game, controller.signal) : agent.nextAction(game);
      if (!action || controller.signal.aborted) return;
      timer = window.setTimeout(() => {
        if (controller.signal.aborted) return;
        setGame((g) => {
          if (g !== game) return g;
          try {
            if (action.kind === 'play') {
              const isKill = g.trump && action.card.suit === g.trump && g.trick.length > 0 && g.trick[0].card.suit !== g.trump;
              if (isKill) soundManager.trumpKill();
              else soundManager.playCard();
            } else if (action.kind === 'bid') {
              soundManager.bidding();
            }
            const nextG = applyAiAction(g, action);
            if (nextG.phase === 'handEnd' || nextG.phase === 'matchEnd') {
              soundManager.victory();
            } else if (
              nextG.lastTrick.length === 4 &&
              nextG.lastPoints > 0 &&
              nextG.completedTricks.length > g.completedTricks.length
            ) {
              soundManager.trickWin();
            }
            return nextG;
          } catch {
            return g;
          }
        });
      }, Math.max(0, currentDelay - (performance.now() - started)));
    };
    void run().catch((error: unknown) => {
      if (!controller.signal.aborted) flash(error instanceof Error ? error.message : 'AI 决策失败', true);
    });
    return () => {
      controller.abort();
      if (timer !== undefined) window.clearTimeout(timer);
    };
  }, [game, currentDelay, engineType, flash, isDebugMode, isStepMode]);

  // ---- 派生视图 ----
  const seat = currentSeat(game);
  const humanTurn = seat === HUMAN_SEAT && game.phase !== 'handEnd' && game.phase !== 'matchEnd';
  const humanHand = useMemo(() => sortHand(game.hands[HUMAN_SEAT] ?? []), [game.hands]);
  const humanKittyIds = useMemo(() => {
    if (game.declarer !== HUMAN_SEAT) return new Set<string>();
    const pickedIds = new Set(pickedKitty.map(cardId));
    return new Set(humanHand.map(cardId).filter((id) => pickedIds.has(id)));
  }, [game.declarer, humanHand, pickedKitty]);
  const humanLegal = useMemo(
    () => new Set(legalMoves(game, HUMAN_SEAT).map((c) => `${c.rank}${c.suit}`)),
    [game],
  );
  const bidOptions = useMemo(
    () => (game.phase === 'bidding' ? legalBids(game) : []),
    [game],
  );

  // ---- 人类操作 ----
  const onCardClick = useCallback((card: Card) => {
    soundManager.selectCard();
    if (game.phase === 'bury' && game.declarer === HUMAN_SEAT) {
      if (cardPoints(card) > 0) {
        flash('⚠️ 分牌（A/10/5）不能扣底！', true);
        return;
      }
      setSelected((prev) => {
        const has = prev.some((c) => c.rank === card.rank && c.suit === card.suit);
        if (has) return prev.filter((c) => !(c.rank === card.rank && c.suit === card.suit));
        if (prev.length >= game.kitty.length) return prev;
        return [...prev, card];
      });
      return;
    }

    if (game.phase === 'playing' && seat === HUMAN_SEAT) {
      const isLegal = humanLegal.has(`${card.rank}${card.suit}`);
      if (!isLegal) {
        flash('⚠️ 请按规则出牌（同门必须跟同门）', true);
        return;
      }
      // 防误触机制：已选中该牌则二次点击直接打出，否则切换为选中
      if (selectedPlayCard && selectedPlayCard.rank === card.rank && selectedPlayCard.suit === card.suit) {
        const isKill = game.trump && card.suit === game.trump && game.trick.length > 0 && game.trick[0].card.suit !== game.trump;
        if (isKill) soundManager.trumpKill();
        else soundManager.playCard();
        safeApply(() => playCard(game, HUMAN_SEAT, card));
        setSelectedPlayCard(null);
      } else {
        setSelectedPlayCard(card);
      }
    }
  }, [game, seat, humanLegal, selectedPlayCard, safeApply, flash]);

  const confirmPlayCard = useCallback(() => {
    if (selectedPlayCard && seat === HUMAN_SEAT && game.phase === 'playing') {
      const isKill = game.trump && selectedPlayCard.suit === game.trump && game.trick.length > 0 && game.trick[0].card.suit !== game.trump;
      if (isKill) soundManager.trumpKill();
      else soundManager.playCard();
      safeApply(() => playCard(game, HUMAN_SEAT, selectedPlayCard));
      setSelectedPlayCard(null);
    }
  }, [selectedPlayCard, seat, game, safeApply]);

  const doBid = useCallback((amount: number | null) => {
    soundManager.bidding();
    safeApply(() => bid(game, HUMAN_SEAT, amount));
  }, [game, safeApply]);

  const doTrump = useCallback((suit: Suit) => {
    safeApply(() => {
      const next = declareTrump(game, HUMAN_SEAT, suit);
      setPickedKitty([...game.kitty]);
      if (game.kitty.length > 0) setKittyRevealed([...game.kitty]);
      return next;
    });
  }, [game, safeApply]);

  const doBury = useCallback(() => {
    safeApply(() => bury(game, HUMAN_SEAT, selected));
  }, [game, selected, safeApply]);

  const goNextHand = useCallback(() => {
    setSelected([]);
    setSelectedPlayCard(null);
    setKittyRevealed(null);
    setPickedKitty([]);
    safeApply(() => nextHand(game));
  }, [game, safeApply]);

  // 上帝模式下任意座位手动出牌
  const manualPlaySeatCard = useCallback((seatToPlay: number, card: Card) => {
    const current = currentSeat(game);
    if (seatToPlay !== current || game.phase !== 'playing') {
      flash(`当前不是 ${SEAT_NAMES[seatToPlay]} 的出牌轮次`, true);
      return;
    }
    const legals = legalMoves(game, seatToPlay);
    const isLegal = legals.some((c) => c.rank === card.rank && c.suit === card.suit);
    if (!isLegal) {
      flash('⚠️ 该手牌不符合跟牌规则（同门必须跟同门）', true);
      return;
    }
    setPendingAiAction(null);
    setAiHintAction(null);
    const isKill = game.trump && card.suit === game.trump && game.trick.length > 0 && game.trick[0].card.suit !== game.trump;
    if (isKill) soundManager.trumpKill();
    else soundManager.playCard();
    safeApply(() => playCard(game, seatToPlay, card));
  }, [game, flash, safeApply]);

  // 单步推进 Next
  const stepNext = useCallback(async () => {
    if (game.phase === 'handEnd' || game.phase === 'matchEnd') {
      goNextHand();
      return;
    }
    const current = currentSeat(game);
    if (current < 0) return;

    // 1. 如果有预计算好的 pendingAiAction，直接执行
    if (pendingAiAction && pendingAiAction.seat === current) {
      const action = pendingAiAction;
      setPendingAiAction(null);
      setAiHintAction(null);
      if (action.kind === 'play') {
        const isKill = game.trump && action.card.suit === game.trump && game.trick.length > 0 && game.trick[0].card.suit !== game.trump;
        if (isKill) soundManager.trumpKill();
        else soundManager.playCard();
      } else if (action.kind === 'bid') {
        soundManager.bidding();
      }
      safeApply(() => applyAiAction(game, action));
      return;
    }

    // 2. 如果轮到人类（南家）
    if (current === HUMAN_SEAT) {
      if (game.phase === 'playing') {
        if (selectedPlayCard) {
          confirmPlayCard();
          return;
        }
        if (aiHintAction && aiHintAction.kind === 'play') {
          const cardToPlay = aiHintAction.card;
          setAiHintAction(null);
          const isKill = game.trump && cardToPlay.suit === game.trump && game.trick.length > 0 && game.trick[0].card.suit !== game.trump;
          if (isKill) soundManager.trumpKill();
          else soundManager.playCard();
          safeApply(() => playCard(game, HUMAN_SEAT, cardToPlay));
          return;
        }
        const legals = legalMoves(game, HUMAN_SEAT);
        if (legals.length > 0) {
          soundManager.playCard();
          safeApply(() => playCard(game, HUMAN_SEAT, legals[0]));
        }
        return;
      }
      if (game.phase === 'bidding') {
        const bids = legalBids(game);
        doBid(bids[0] ?? null);
        return;
      }
      if (game.phase === 'trump') {
        const suits: Suit[] = ['S', 'H', 'C', 'D'];
        const maxSuit = suits.reduce((best, s) => {
          const count = humanHand.filter((c) => c.suit === s).length;
          return count > best.count ? { suit: s, count } : best;
        }, { suit: 'S' as Suit, count: -1 }).suit;
        doTrump(maxSuit);
        return;
      }
      if (game.phase === 'bury') {
        const rec = smartBury(game, HUMAN_SEAT);
        safeApply(() => bury(game, HUMAN_SEAT, rec));
        return;
      }
      return;
    }

    // 3. 非人类座位即时计算并执行
    const defaultAgent = engineManagerRef.current.getAgent();
    const agent = agentsRef.current?.[current] ?? defaultAgent;
    setIsThinking(true);
    try {
      const action = isAsyncPlayerAgent(agent)
        ? await agent.nextActionAsync(game)
        : agent.nextAction(game);
      if (action) {
        if (action.kind === 'play') {
          const isKill = game.trump && action.card.suit === game.trump && game.trick.length > 0 && game.trick[0].card.suit !== game.trump;
          if (isKill) soundManager.trumpKill();
          else soundManager.playCard();
        } else if (action.kind === 'bid') {
          soundManager.bidding();
        }
        safeApply(() => applyAiAction(game, action));
      }
    } finally {
      setIsThinking(false);
      setPendingAiAction(null);
      setAiHintAction(null);
    }
  }, [game, pendingAiAction, selectedPlayCard, aiHintAction, humanHand, confirmPlayCard, doBid, doTrump, goNextHand, safeApply]);

  // AI 出牌提示触发
  const triggerAiHint = useCallback(async () => {
    const current = currentSeat(game);
    if (current < 0 || game.phase === 'handEnd' || game.phase === 'matchEnd') return;
    const defaultAgent = engineManagerRef.current.getAgent();
    const agent = agentsRef.current?.[current] ?? defaultAgent;
    setIsThinking(true);
    try {
      const action = isAsyncPlayerAgent(agent)
        ? await agent.nextActionAsync(game)
        : agent.nextAction(game);
      if (action) {
        setAiHintAction(action);
        if (action.kind === 'play') {
          if (current === HUMAN_SEAT) {
            setSelectedPlayCard(action.card);
          }
          soundManager.selectCard();
        }
      }
    } finally {
      setIsThinking(false);
    }
  }, [game]);

  // 一键智能推荐扣底
  const autoSelectBury = useCallback(() => {
    if (game.phase === 'bury' && game.declarer === HUMAN_SEAT) {
      const recommended = smartBury(game, HUMAN_SEAT);
      setSelected(recommended);
      flash('已为你智能预选 4 张非分底牌', false);
    }
  }, [game, flash]);

  const clearSelectedBury = useCallback(() => {
    setSelected([]);
  }, []);

  const restart = useCallback((seed?: number) => {
    setSelected([]);
    setSelectedPlayCard(null);
    setKittyRevealed(null);
    setPickedKitty([]);
    setGame(createGame(seed ?? Date.now() % 100000));
  }, []);

  return {
    game,
    seat,
    humanSeat: HUMAN_SEAT,
    humanTurn,
    humanHand,
    humanKittyIds,
    humanLegal,
    bidOptions,
    selected,
    selectedPlayCard,
    kittyRevealed,
    speed,
    setSpeed,
    engineType,
    setEngineType,
    toast,
    // 弹窗状态
    showRulesModal,
    setShowRulesModal,
    showLastTrickModal,
    setShowLastTrickModal,
    showHistoryModal,
    setShowHistoryModal,
    showPointsLedger,
    setShowPointsLedger,
    showEngineSettings,
    setShowEngineSettings,
    showDecisionLogModal,
    setShowDecisionLogModal,
    selectedDecisionId,
    setSelectedDecisionId,
    // 开发调试透视看牌 (God Mode)
    godModeEnabled,
    setGodModeEnabled,
    devPeekSeats,
    isAllPeeked,
    toggleDevPeek,
    toggleAllPeek,
    isGodMode: isAllPeeked,
    toggleGodMode: toggleAllPeek,
    engineManager: engineManagerRef.current,
    dismissKittyRevealed: () => setKittyRevealed(null),
    // 上帝调试模式与单步控制
    isDebugMode,
    setIsDebugMode,
    isStepMode,
    setIsStepMode,
    pendingAiAction,
    aiHintAction,
    isThinking,
    soundMuted,
    toggleSoundMute,
    stepNext,
    triggerAiHint,
    manualPlaySeatCard,
    // 动作方法
    onCardClick,
    confirmPlayCard,
    doBid,
    doTrump,
    doBury,
    autoSelectBury,
    clearSelectedBury,
    goNextHand,
    restart,
    undo,
    canUndo: historyStack.length > 0,
  };
}

export type GameController = ReturnType<typeof useGame>;
