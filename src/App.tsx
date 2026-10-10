/**
 * 幺子分牌桌 UI。
 * 人坐在 1 号位（南），其余三家由 AI 扮演。
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Card as CardModel, SUIT_NAME, SUIT_SYMBOL, Suit, cardPoints, sortHand,
} from './cards';
import {
  GameState, IllegalActionError, SEAT_NAMES, SIDE_NAMES, bid, bury, createGame,
  currentSeat, declareTrump, legalBids, legalMoves, nextHand, playCard, sideOf,
} from './engine';
import { aiNextAction, applyAiAction } from './ai';
import CardView from './CardView';

const HUMAN_SEAT = 1; // 南
const AI_DELAY = 650; // ms

type Toast = { text: string; bad: boolean } | null;

export default function App() {
  const [game, setGame] = useState<GameState>(() => createGame(Date.now() % 100000));
  const [toast, setToast] = useState<Toast>(null);
  const [selected, setSelected] = useState<CardModel[]>([]); // 扣底多选
  const toastTimer = useRef<number | null>(null);

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

  // AI 驱动：轮到非人类座位时自动行动
  useEffect(() => {
    if (game.phase === 'handEnd' || game.phase === 'matchEnd') return;
    const seat = currentSeat(game);
    if (seat < 0 || seat === HUMAN_SEAT) return;
    const action = aiNextAction(game);
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
    }, AI_DELAY);
    return () => window.clearTimeout(t);
  }, [game]);

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

  const onCardClick = (card: CardModel) => {
    if (game.phase === 'bury') {
      setSelected((prev) => {
        const has = prev.some((c) => c.rank === card.rank && c.suit === card.suit);
        if (has) return prev.filter((c) => !(c.rank === card.rank && c.suit === card.suit));
        if (prev.length >= game.kitty.length) return prev;
        return [...prev, card];
      });
      return;
    }
    if (game.phase === 'playing' && humanTurn) {
      safeApply(() => playCard(game, HUMAN_SEAT, card));
    }
  };

  const doBid = (amount: number | null) => {
    safeApply(() => bid(game, HUMAN_SEAT, amount));
  };

  const doTrump = (suit: Suit) => {
    safeApply(() => declareTrump(game, HUMAN_SEAT, suit));
  };

  const doBury = () => {
    safeApply(() => bury(game, HUMAN_SEAT, selected));
  };

  const restart = (seed?: number) => {
    setSelected([]);
    setGame(createGame(seed ?? Date.now() % 100000));
  };

  const next = () => {
    setSelected([]);
    safeApply(() => nextHand(game));
  };

  // 桌面布局：0东(左) 1南(下) 2西(右) 3北(上)
  const seatPos = ['left', 'bottom', 'right', 'top'] as const;
  const trickSeats = [0, 1, 2, 3];
  const phaseLabel: Record<string, string> = {
    bidding: '叫分', trump: '定主', bury: '扣底', playing: '出牌',
    handEnd: '本副结束', matchEnd: '本场结束',
  };

  return (
    <div className="app">
      <header className="topbar">
        <h1>保山幺子分 <em>baoshan-yaozifen</em></h1>
        <div className="phase-tag">{phaseLabel[game.phase]}</div>
        <div className="scores">
          {[0, 1].map((s) => (
            <span key={s} className={s === sideOf(HUMAN_SEAT) ? 'me' : ''}>
              {SIDE_NAMES[s]} {game.scores[s]}
            </span>
          ))}
          <span className="target">先胜 {game.targetWins} 副</span>
        </div>
        <div className="meta">
          {game.trump && (
            <span className="trump-chip">主 {SUIT_SYMBOL[game.trump]}{SUIT_NAME[game.trump]}</span>
          )}
          {game.highestBidder !== null && (
            <span>庄 {SEAT_NAMES[game.declarer!]} · 叫 {game.highestBid}</span>
          )}
          <span>底牌 {game.kitty.length} 张</span>
          <span>第 {game.trickNumber}/12 墩</span>
          <span className="pts-live">
            吃分 庄 {game.declarerTrickPoints + game.buriedPoints} · 闲 {game.defenderTrickPoints}
          </span>
        </div>
      </header>

      <main className="table">
        {[0, 2, 3].map((s) => (
          <div key={s} className={`seat ${seatPos[s]} ${seat === s ? 'turn' : ''}`}>
            <div className="seat-name">
              {SEAT_NAMES[s]}
              {game.declarer === s && <b className="badge">庄</b>}
              {sideOf(s) === sideOf(HUMAN_SEAT) && <b className="badge partner">搭</b>}
            </div>
            <div className="seat-cards">
              {game.hands[s]?.map((_, i) => <CardView key={i} card={{ suit: 'S', rank: '2' }} faceDown />)}
            </div>
          </div>
        ))}

        <div className={`seat bottom ${seat === HUMAN_SEAT ? 'turn' : ''}`}>
          <div className="seat-name">
            南（你）
            {game.declarer === HUMAN_SEAT && <b className="badge">庄</b>}
          </div>
        </div>

        <div className="center">
          <div className="trick">
            {trickSeats.map((s) => {
              const played = game.trick.find((t) => t.seat === s);
              return (
                <div key={s} className={`trick-slot ${seatPos[s]}`}>
                  {played ? <CardView card={played.card} /> : <div className="slot-empty" />}
                </div>
              );
            })}
          </div>
          {game.kitty.length > 0 && game.phase !== 'bidding' && (
            <div className="kitty">
              底牌：{game.kitty.map((c, i) => <CardView key={i} card={c} faceDown />)}
            </div>
          )}
        </div>

        <div className="hand">
          {humanHand.map((c) => {
            const id = `${c.rank}${c.suit}`;
            const isLegal = game.phase === 'playing' && humanLegal.has(id);
            const isBuryPick = selected.some((x) => x.rank === c.rank && x.suit === c.suit);
            const buryable = game.phase === 'bury' && (cardPoints(c) === 0 || isBuryPick);
            return (
              <CardView
                key={id}
                card={c}
                playable={isLegal || (game.phase === 'bury' && buryable)}
                selected={isBuryPick}
                disabled={!isLegal && !(game.phase === 'bury' && buryable)}
                onClick={() => (isLegal || (game.phase === 'bury' && buryable)) && onCardClick(c)}
              />
            );
          })}
        </div>
      </main>

      <div className="controls">
        {game.phase === 'bidding' && (
          <div className="ctl-group">
            {humanTurn ? (
              <>
                <span className="ctl-label">轮到你叫分（当前最高 {game.highestBid}）：</span>
                <button onClick={() => doBid(null)}>不叫</button>
                {bidOptions.map((b) => (
                  <button key={b} onClick={() => doBid(b)}>{b}</button>
                ))}
              </>
            ) : (
              <span className="ctl-label">等待 {SEAT_NAMES[seat]} 叫分…</span>
            )}
          </div>
        )}

        {game.phase === 'trump' && (
          <div className="ctl-group">
            {humanTurn ? (
              <>
                <span className="ctl-label">你是庄家，请定主：</span>
                {(Object.keys(SUIT_SYMBOL) as Suit[]).map((s) => (
                  <button key={s} onClick={() => doTrump(s)}>
                    {SUIT_SYMBOL[s]} {SUIT_NAME[s]}
                  </button>
                ))}
              </>
            ) : (
              <span className="ctl-label">等待庄家定主…</span>
            )}
          </div>
        )}

        {game.phase === 'bury' && (
          <div className="ctl-group">
            {humanTurn ? (
              <>
                <span className="ctl-label">
                  你是庄家：点击手牌选 {game.kitty.length} 张非分牌扣回底牌（已选 {selected.length}）
                </span>
                <button disabled={selected.length !== game.kitty.length} onClick={doBury}>
                  确认扣底
                </button>
              </>
            ) : (
              <span className="ctl-label">等待庄家扣底…</span>
            )}
          </div>
        )}

        {game.phase === 'playing' && (
          <div className="ctl-group">
            <span className="ctl-label">
              {humanTurn
                ? game.trick.length === 0
                  ? '轮到你领出（任意出牌）'
                  : '轮到你跟牌（同门优先）'
                : `等待 ${SEAT_NAMES[seat]} 出牌…`}
            </span>
          </div>
        )}

        {(game.phase === 'handEnd' || game.phase === 'matchEnd') && (
          <div className="ctl-group result-panel">
            {game.result && (
              <>
                <b>
                  庄家 {SEAT_NAMES[game.result.declarer]}（叫 {game.result.bid} 分，主 {SUIT_SYMBOL[game.result.trump]}）
                  庄方吃 {game.result.declarerPoints} 分（含底牌 {game.result.buriedPoints}）
                  → {game.result.success ? '成局' : '不成'}
                </b>
                <span>{SIDE_NAMES[game.result.winnerSide]} 胜本副</span>
              </>
            )}
            {game.phase === 'matchEnd' ? (
              <button onClick={() => restart()}>再来一场</button>
            ) : (
              <button onClick={next}>下一副</button>
            )}
            <button className="ghost" onClick={() => restart()}>重新开局</button>
          </div>
        )}
      </div>

      {toast && <div className={`toast ${toast.bad ? 'bad' : ''}`}>{toast.text}</div>}

      <footer className="log">
        {game.history.slice(-6).map((line, i, arr) => (
          <div key={game.history.length - arr.length + i} className={i === arr.length - 1 ? 'last' : ''}>
            {line}
          </div>
        ))}
      </footer>
    </div>
  );
}
