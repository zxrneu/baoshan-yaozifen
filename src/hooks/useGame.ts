/**
 * useGame：对局编排 hook。
 * 职责：持有 GameState、驱动非人类座位（通过可插拔的 PlayerAgent）、
 * 把人类操作转成引擎调用、把 IllegalActionError 转成 toast。
 * UI 组件只消费这里返回的视图模型，不直接接触引擎内部。
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Card, Suit, sortHand } from '../cards';
import {
  GameState, IllegalActionError, bid, bury, createGame, currentSeat,
  declareTrump, legalBids, legalMoves, nextHand, playCard,
} from '../engine';
import { PlayerAgent, applyAiAction, heuristicAgent } from '../ai';

export const HUMAN_SEAT = 1; // 南
const AI_DELAY = 650; // ms

type Toast = { text: string; bad: boolean } | null;

export interface UseGameOptions {
  /** 座位 → 决策者；未配置的非人类座位使用默认启发式 AI */
  agents?: Partial<Record<number, PlayerAgent>>;
  aiDelayMs?: number;
}

export function useGame({ agents, aiDelayMs = AI_DELAY }: UseGameOptions = {}) {
  const [game, setGame] = useState<GameState>(() => createGame(Date.now() % 100000));
  const [toast, setToast] = useState<Toast>(null);
  const [selected, setSelected] = useState<Card[]>([]); // 扣底多选
  const toastTimer = useRef<number | null>(null);
  const agentsRef = useRef(agents);
  agentsRef.current = agents;

  const flash = useCallback((text: string, bad = false) => {
    setToast({ text, bad });
    if (toastTimer.current) window.clearTimeout(toastTimer.current);
    toastTimer.current = window.setTimeout(() => setToast(null), 2600);
  }, []);

  const safeApply = useCallback((fn: () => GameState) => {
    try {
      setGame(fn());
      setSelected([]);
    } catch (e) {
      if (e instanceof IllegalActionError) flash(e.message, true);
      else throw e;
    }
  }, [flash]);

  // AI 驱动：轮到非人类座位时由其 PlayerAgent 行动
  useEffect(() => {
    if (game.phase === 'handEnd' || game.phase === 'matchEnd') return;
    const seat = currentSeat(game);
    if (seat < 0 || seat === HUMAN_SEAT) return;
    const agent = agentsRef.current?.[seat] ?? heuristicAgent;
    const action = agent.nextAction(game);
    if (!action) return;
    const t = window.setTimeout(() => {
      setGame((g) => {
        // 防止过期定时器作用在已变化的状态上：仅当仍是同一回合才执行
        if (currentSeat(g) === seat && g.phase === game.phase) {
          try {
            return applyAiAction(g, action);
          } catch {
            return g;
          }
        }
        return g;
      });
    }, aiDelayMs);
    return () => window.clearTimeout(t);
  }, [game, aiDelayMs]);

  // ---- 派生视图 ----
  const seat = currentSeat(game);
  const humanTurn = seat === HUMAN_SEAT && game.phase !== 'handEnd' && game.phase !== 'matchEnd';
  const humanHand = useMemo(() => sortHand(game.hands[HUMAN_SEAT] ?? []), [game.hands]);
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
    if (game.phase === 'bury') {
      setSelected((prev) => {
        const has = prev.some((c) => c.rank === card.rank && c.suit === card.suit);
        if (has) return prev.filter((c) => !(c.rank === card.rank && c.suit === card.suit));
        if (prev.length >= game.kitty.length) return prev;
        return [...prev, card];
      });
      return;
    }
    if (game.phase === 'playing' && seat === HUMAN_SEAT) {
      safeApply(() => playCard(game, HUMAN_SEAT, card));
    }
  }, [game, seat, safeApply]);

  const doBid = useCallback((amount: number | null) => {
    safeApply(() => bid(game, HUMAN_SEAT, amount));
  }, [game, safeApply]);

  const doTrump = useCallback((suit: Suit) => {
    safeApply(() => declareTrump(game, HUMAN_SEAT, suit));
  }, [game, safeApply]);

  const doBury = useCallback(() => {
    safeApply(() => bury(game, HUMAN_SEAT, selected));
  }, [game, selected, safeApply]);

  const goNextHand = useCallback(() => {
    setSelected([]);
    safeApply(() => nextHand(game));
  }, [game, safeApply]);

  const restart = useCallback((seed?: number) => {
    setSelected([]);
    setGame(createGame(seed ?? Date.now() % 100000));
  }, []);

  return {
    game,
    seat,
    humanSeat: HUMAN_SEAT,
    humanTurn,
    humanHand,
    humanLegal,
    bidOptions,
    selected,
    toast,
    onCardClick,
    doBid,
    doTrump,
    doBury,
    goNextHand,
    restart,
  };
}

export type GameController = ReturnType<typeof useGame>;
