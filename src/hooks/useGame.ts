/**
 * useGame：对局编排 hook。
 * 职责：持有 GameState、驱动非人类座位（通过可插拔的 PlayerAgent）、
 * 把人类操作转成引擎调用、提供出牌防误触、底牌揭晓、记账与规则弹窗等交互状态。
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Card, Suit, cardId, cardPoints, sortHand } from '../cards';
import {
  GameState, IllegalActionError, bid, bury, createGame, currentSeat,
  declareTrump, legalBids, legalMoves, nextHand, playCard,
} from '../engine';
import {
  PlayerAgent, applyAiAction, isAsyncPlayerAgent, smartBury,
  defaultEngineManager, DecisionEngineManager, EngineType,
} from '../ai';

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

  // 模态弹窗状态
  const [showRulesModal, setShowRulesModal] = useState(false);
  const [showLastTrickModal, setShowLastTrickModal] = useState(false);
  const [showHistoryModal, setShowHistoryModal] = useState(false);
  const [showPointsLedger, setShowPointsLedger] = useState(false);
  const [showEngineSettings, setShowEngineSettings] = useState(false);

  const toastTimer = useRef<number | null>(null);
  const agentsRef = useRef(agents);
  agentsRef.current = agents;
  const engineManagerRef = useRef(engineManager);
  engineManagerRef.current = engineManager;

  const setEngineType = useCallback((type: EngineType) => {
    engineManagerRef.current.setActiveType(type);
    setEngineTypeState(type);
  }, []);

  const flash = useCallback((text: string, bad = false) => {
    setToast({ text, bad });
    if (toastTimer.current) window.clearTimeout(toastTimer.current);
    toastTimer.current = window.setTimeout(() => setToast(null), 2600);
  }, []);

  const safeApply = useCallback((fn: () => GameState) => {
    try {
      setGame(fn());
      setSelected([]);
      setSelectedPlayCard(null);
    } catch (e) {
      if (e instanceof IllegalActionError) flash(e.message, true);
      else throw e;
    }
  }, [flash]);

  // AI 驱动：轮到非人类座位时由其 PlayerAgent 行动
  const currentDelay = SPEED_MAP[speed];
  useEffect(() => {
    if (game.phase === 'handEnd' || game.phase === 'matchEnd') return;
    const seat = currentSeat(game);
    if (seat < 0 || seat === HUMAN_SEAT) return;
    const defaultAgent = engineManagerRef.current.getAgent();
    const agent = agentsRef.current?.[seat] ?? defaultAgent;
    const controller = new AbortController();
    const started = performance.now();
    let timer: number | undefined;
    const run = async () => {
      const action = isAsyncPlayerAgent(agent)
        ? await agent.nextActionAsync(game, controller.signal) : agent.nextAction(game);
      if (!action || controller.signal.aborted) return;
      timer = window.setTimeout(() => {
        if (controller.signal.aborted) return;
        setGame((g) => {
          // 必须是发起搜索时的同一个状态；重开、换副、换速度均取消旧请求。
          if (g !== game) return g;
          try { return applyAiAction(g, action); } catch { return g; }
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
  }, [game, currentDelay, engineType, flash]);

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
        safeApply(() => playCard(game, HUMAN_SEAT, card));
        setSelectedPlayCard(null);
      } else {
        setSelectedPlayCard(card);
      }
    }
  }, [game, seat, humanLegal, selectedPlayCard, safeApply, flash]);

  const confirmPlayCard = useCallback(() => {
    if (selectedPlayCard && seat === HUMAN_SEAT && game.phase === 'playing') {
      safeApply(() => playCard(game, HUMAN_SEAT, selectedPlayCard));
      setSelectedPlayCard(null);
    }
  }, [selectedPlayCard, seat, game, safeApply]);

  const doBid = useCallback((amount: number | null) => {
    safeApply(() => bid(game, HUMAN_SEAT, amount));
  }, [game, safeApply]);

  const doTrump = useCallback((suit: Suit) => {
    safeApply(() => {
      const next = declareTrump(game, HUMAN_SEAT, suit);
      // 保留摸底来源，扣底后 game.kitty 会变成重新扣回的牌。
      setPickedKitty([...game.kitty]);
      if (game.kitty.length > 0) setKittyRevealed([...game.kitty]);
      return next;
    });
  }, [game, safeApply]);

  const doBury = useCallback(() => {
    safeApply(() => bury(game, HUMAN_SEAT, selected));
  }, [game, selected, safeApply]);

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

  const goNextHand = useCallback(() => {
    setSelected([]);
    setSelectedPlayCard(null);
    setKittyRevealed(null);
    setPickedKitty([]);
    safeApply(() => nextHand(game));
  }, [game, safeApply]);

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
    engineManager: engineManagerRef.current,
    dismissKittyRevealed: () => setKittyRevealed(null),
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
  };
}

export type GameController = ReturnType<typeof useGame>;
