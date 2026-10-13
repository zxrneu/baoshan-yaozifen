/**
 * SquareTable：上帝/调试模式下的 1:1 正方形对称牌桌组件。
 * 上北下南，左西右东；遵循单一职责，统一各家桌沿身份信息与座位引擎入口。
 */
import { useMemo, type ReactNode, type CSSProperties } from 'react';
import { Card as CardModel, type Suit, SUIT_NAME, SUIT_SYMBOL, cardId, cardPoints, sortHand } from '../cards';
import { GameState, SEAT_NAMES, sideOf, legalMoves } from '../engine';
import CardView from '../CardView';
import ControlPanel from './ControlPanel';
import SeatActivity from './SeatActivity';
import { SEAT_DIRECTIONS, seatAngle } from './seatLayout';
import type { SeatDecisionNotice } from '../hooks/useGame';
import styles from './SquareTable.module.css';
import type { ActionPresentation } from '../hooks/actionPresentation';

interface Props {
  seatEngineLabels?: readonly string[];
  actionOverlay?: ReactNode;
  onInspectSeat?: (seat: number) => void;
  onChangeSeatEngine?: (seat: number) => void;
  interactive?: boolean;
  activePresentation?: ActionPresentation | null;
  pickedKitty?: readonly CardModel[];
  game: GameState;
  humanSeat: number;
  seat: number;
  isThinking?: boolean;
  hasReadyDecision?: boolean;
  decisionNotice?: SeatDecisionNotice | null;
  onDismissDecision?: () => void;
  selectedPlayCard: CardModel | null;
  aiHintCard: CardModel | null;
  selectedBuryCards: CardModel[];
  bidOptions: number[];
  /** 出牌二次确认偏好。调试模式内部恒为 true，保证单步节奏不会被单击误推进。 */
  confirmBeforePlay?: boolean;
  onHumanCardClick: (card: CardModel) => void;
  onManualPlaySeat: (seat: number, card: CardModel) => void;
  confirmPlayCard: () => void;
  doBid: (b: number | null) => void;
  doTrump: (s: Suit) => void;
  doBury: () => void;
  autoSelectBury: () => void;
  clearSelectedBury: () => void;
  goNextHand: () => void;
  restart: () => void;
}

const SEAT_AVATARS: Record<number, string> = {
  0: '🤠',
  1: '👑',
  2: '🎩',
  3: '👲',
};

export default function SquareTable({
  game,
  seatEngineLabels = [],
  actionOverlay,
  onInspectSeat,
  onChangeSeatEngine,
  interactive = true,
  activePresentation,
  pickedKitty = [],
  humanSeat,
  seat,
  isThinking = false,
  hasReadyDecision = false,
  decisionNotice = null,
  onDismissDecision,
  selectedPlayCard,
  aiHintCard,
  selectedBuryCards,
  bidOptions,
  confirmBeforePlay = true,
  onHumanCardClick,
  confirmPlayCard,
  doBid,
  doTrump,
  doBury,
  autoSelectBury,
  clearSelectedBury,
  goNextHand,
  restart,
}: Props) {
  const handleCardClick = (seatNum: number, card: CardModel, _isCurrentTurn: boolean) => {
    if (seatNum === seat && (game.phase === 'playing' || game.phase === 'bury')) onHumanCardClick(card);
  };
  const selectedCard = (seatNum: number, id: string) => seatNum === seat && (
    (game.phase === 'playing' && selectedPlayCard !== null && cardId(selectedPlayCard) === id) ||
    (game.phase === 'bury' && selectedBuryCards.some(card => cardId(card) === id))
  );
  const buryPlayable = (seatNum: number, card: CardModel) => game.phase === 'bury' && seatNum === seat && cardPoints(card) === 0;

  const currentSeatLegals = useMemo(() => {
    if (seat < 0 || game.phase !== 'playing') return new Set<string>();
    return new Set(legalMoves(game, seat).map(cardId));
  }, [game, seat]);

  // 吃分计算
  const seatPoints = (s: number) =>
    game.completedTricks.filter((t) => t.winner === s).reduce((sum, t) => sum + t.points, 0);

  // 身份与任务表情统一并入桌沿信息条，整体按座位朝向旋转。
  const renderIdentity = (seatNum: number) => {
    const isTurn = seat === seatNum && !['handEnd', 'matchEnd'].includes(game.phase);
    const status = isTurn ? isThinking ? '思考中' : hasReadyDecision ? '已决定' : '等待决定' : '等待轮次';
    const task = { bidding: '叫分', trump: '定主', bury: '扣底', playing: '出牌', handEnd: '结算', matchEnd: '结算' }[game.phase];
    const icon = isTurn ? isThinking ? '🤔' : hasReadyDecision ? '💡' : '⏳' : '💤';
    const notice = decisionNotice?.action.seat === seatNum ? decisionNotice : null;
    return <div className={styles.seatIdentity} data-seat-identity={seatNum} data-direction={SEAT_DIRECTIONS[seatNum]}>
      <div className={styles.handIdentity}>
        <button type="button" className={`${styles.handAvatar} ${isTurn ? styles.handAvatarTurn : ''}`}
          aria-label={`查看${SEAT_NAMES[seatNum]}家决策原因`} onClick={() => onInspectSeat?.(seatNum)} disabled={!onInspectSeat}>
          <span aria-hidden="true">{SEAT_AVATARS[seatNum]}</span>
          <span className={styles.taskEmoji} aria-hidden="true">{icon}</span>
        </button>
        {isTurn && <span className={styles.handTask} role="status" aria-label={`${SEAT_NAMES[seatNum]}家 · ${task} · ${status}`}>{task} · {status}</span>}
        <SeatActivity seat={seatNum} isTurn={isTurn} isThinking={isTurn && isThinking}
          hasReadyDecision={isTurn && hasReadyDecision} showTurnIndicator={false} notice={notice} onDismiss={onDismissDecision} inline />
      </div>
    </div>;
  };

  const renderHand = (seatNum: number, position: 'north' | 'south' | 'west' | 'east') => {
    const sorted = sortHand(game.hands[seatNum] ?? []);
    const isCurrentTurn = seat === seatNum && game.phase === 'playing';
    const vertical = position === 'east' || position === 'west';
    const handClass = vertical ? position === 'east' ? styles.handColEast : styles.handColWest
      : `${styles.handRow} ${position === 'north' ? styles.handRowNorth : styles.handRowSouth}`;
    return <div className={handClass} data-seat-hand={seatNum}>
      {sorted.map((card, idx) => {
        const id = cardId(card);
        const isLegal = isCurrentTurn && currentSeatLegals.has(id);
        const isSelected = selectedCard(seatNum, id);
        const isHinted = aiHintCard !== null && cardId(aiHintCard) === id;
        const isSuitBreak = idx > 0 && card.suit !== sorted[idx - 1].suit;
        const wrapper = position === 'west' ? styles.cardWrapperWest : position === 'east' ? styles.cardWrapperEast
          : position === 'north' ? styles.cardWrapperNorth : styles.handCardItem;
        const suitBreak = position === 'west' ? styles.suitBreakWest : position === 'east' ? styles.suitBreakEast
          : position === 'north' ? styles.suitBreakNorth : styles.suitBreak;
        const selected = position === 'west' ? styles.selectedWrapperWest : position === 'east' ? styles.selectedWrapperEast
          : position === 'north' ? styles.selectedWrapperNorth : styles.selectedCard;
        const inner = position === 'west' ? styles.cardInnerWest : position === 'east' ? styles.cardInnerEast
          : position === 'north' ? styles.cardInnerNorth : styles.cardInnerSouth;
        return <div key={id} className={`${wrapper} ${isSuitBreak ? suitBreak : ''} ${isSelected ? selected : ''}`}
            style={{ zIndex: isSelected ? 60 : isHinted ? 50 : position === 'north' || position === 'east' ? sorted.length - idx : idx + 1 }}>
            <div className={`${inner} ${isHinted ? styles.aiHintCard : ''}`}>
              <CardView card={card} playable={isLegal || buryPlayable(seatNum, card)} selected={isSelected}
                className={isSelected ? styles.cardSelectedGlow : ''} isTrump={game.trump !== null && card.suit === game.trump}
                isKitty={game.phase === 'bury' && seatNum === game.declarer && pickedKitty.some(value => cardId(value) === id)}
                onClick={() => handleCardClick(seatNum, card, isCurrentTurn)} />
            </div>
          </div>;
      })}
    </div>;
  };

  // 渲染座位标签头
  const renderSeatHeader = (s: number) => {
    const isTurn = seat === s && game.phase !== 'handEnd' && game.phase !== 'matchEnd';
    const isDeclarer = game.declarer === s;
    const isPartner =
      game.declarer !== null && game.declarer !== s && sideOf(s) === sideOf(game.declarer);

    const latestBid = game.bidding.filter((b) => b.seat === s).slice(-1)[0];

    return (
      <div className={styles.seatHeaderDock}>
      <div className={styles.seatHeaderAnchor} data-seat-header={s} style={{ transform: `rotate(${seatAngle(s)}deg)` }}>
        {seatEngineLabels[s] && <button type="button" className={styles.seatEngine} aria-label={`${SEAT_NAMES[s]}家当前引擎`} aria-haspopup="dialog" title="点击更换本家引擎" disabled={!onChangeSeatEngine} onClick={() => onChangeSeatEngine?.(s)}>{seatEngineLabels[s]}</button>}
        <div className={`${styles.seatHeader} ${isTurn ? styles.seatTurn : ''}`}>
          {renderIdentity(s)}
          <span className={styles.seatName}>{SEAT_NAMES[s]}{s === humanSeat ? '（你）' : ''}</span>
          {isDeclarer && <span className={`${styles.roleBadge} ${styles.declarerBadge}`}>庄</span>}
          {isPartner && <span className={styles.roleBadge}>搭</span>}
          {game.phase === 'bidding' && latestBid !== undefined ? (
            <span
              className={styles.roleBadge}
              style={{
                background: latestBid.bid ? '#b45309' : 'rgba(100, 116, 139, 0.6)',
                color: latestBid.bid ? '#fef08a' : '#cbd5e1',
                fontWeight: 700,
              }}
            >
              {latestBid.bid ? `叫 ${latestBid.bid}` : '不叫'}
            </span>
          ) : (
            <span className={styles.pointsBadge} title={`${SEAT_NAMES[s]}已收得分牌分`}>
              <strong className={styles.pointsValue}>{seatPoints(s)}</strong>
              <span className={styles.pointsUnit}>分</span>
            </span>
          )}
          <span className={styles.roleBadge}>{game.hands[s]?.length ?? 0}张</span>
        </div>
      </div>
      </div>
    );
  };

  // 出牌中央槽位
  const showingLast = game.trick.length === 0 && game.lastTrick.length > 0 && game.phase === 'playing';
  const trickList = showingLast ? game.lastTrick : game.trick;

  const cardAtSeat = (s: number) => {
    const found = trickList.find((t) => t.seat === s);
    if (!found) return <div className={styles.slotEmpty} />;
    const isWinner = showingLast && game.lastWinner === s;

    return (
      <div key={cardId(found.card)} className={isWinner ? styles.winnerTrickCard : undefined} data-flying={activePresentation?.kind === 'play' && activePresentation.seat === s || undefined} style={{'--fly-x': `${s === 0 ? 100 : s === 2 ? -100 : 0}px`, '--fly-y': `${s === 1 ? 100 : s === 3 ? -100 : 0}px`} as CSSProperties}>
        <div style={{transform: `rotate(${seatAngle(s)}deg)`}}><CardView card={found.card} isTrump={found.card.suit === game.trump} /></div>
        {isWinner && <div className={styles.winnerTag}>{SEAT_NAMES[s]}收·{game.lastPoints}分</div>}
      </div>
    );
  };

  return (
    <div className={styles.squareContainer}>
      <div className={styles.squareTable} aria-label="正方形上帝调试牌桌" aria-busy={Boolean(actionOverlay)} data-view={interactive ? 'manual' : 'spectator'} data-effect={activePresentation?.kind} style={{'--collect-x': `${activePresentation?.seat === 0 ? 130 : activePresentation?.seat === 2 ? -130 : 0}px`, '--collect-y': `${activePresentation?.seat === 1 ? 130 : activePresentation?.seat === 3 ? -130 : 0}px`} as CSSProperties}>
        {actionOverlay}
        <div className={styles.tableBrand} aria-hidden="true">
          保山幺子分 · 调试视口
        </div>

        {/* 北家 (Top) */}
        <div className={`${styles.seatNorth} ${seat === 3 || decisionNotice?.action.seat === 3 ? styles.seatActive : ''}`}>
          {renderSeatHeader(3)}
          {renderHand(3, 'north')}
        </div>

        {/* 西家 (Left) */}
        <div className={`${styles.seatWest} ${seat === 2 || decisionNotice?.action.seat === 2 ? styles.seatActive : ''}`}>
          {renderSeatHeader(2)}
          {renderHand(2, 'west')}
        </div>

        {/* 中央出牌区 */}
        <div className={styles.centerArea}>
          <div className={styles.centerHud}>
            <span className={styles.trumpTag}>
              {game.trump ? `主牌 ${SUIT_SYMBOL[game.trump]} ${SUIT_NAME[game.trump]}` : '尚未定主'}
            </span>
            <span className={styles.hudDivider}>|</span>
            <span>
              {game.declarer !== null
                ? `庄 ${SEAT_NAMES[game.declarer]} · 叫 ${game.highestBid} 分`
                : `起叫 70 分`}
            </span>
            {game.phase === 'playing' && (
              <>
                <span className={styles.hudDivider}>|</span>
                <span>第 {game.trickNumber}/12 轮</span>
              </>
            )}
          </div>

          {/* 出牌十字插槽（仅在出牌与结算阶段展示） */}
          {(game.phase === 'playing' || game.phase === 'handEnd' || game.phase === 'matchEnd') && (
            <div className={styles.trickSquare}>
              <div className={`${styles.trickSlot} ${styles.slotNorth}`}>{cardAtSeat(3)}</div>
              <div className={`${styles.trickSlot} ${styles.slotSouth}`}>{cardAtSeat(1)}</div>
              <div className={`${styles.trickSlot} ${styles.slotWest}`}>{cardAtSeat(2)}</div>
              <div className={`${styles.trickSlot} ${styles.slotEast}`}>{cardAtSeat(0)}</div>
            </div>
          )}

          {/* 底牌展示 */}
          {game.kitty.length > 0 && game.phase === 'playing' && (
            <div className={styles.kittyRow}>
              <span>底牌:</span>
              {game.kitty.map((c, i) => (
                <CardView key={i} card={c} size="mini" faceDown />
              ))}
            </div>
          )}

          {/* 当前操作指示或中央简易控制 */}
            {interactive && <div className={styles.actorControlDock}><div className={styles.actorControls} aria-label="当前玩家操作" data-direction={SEAT_DIRECTIONS[seat]} style={{transform: `rotate(${seatAngle(seat)}deg)`}} inert={Boolean(actionOverlay)}><ControlPanel
              seat={seat}
              humanSeat={seat}
              takeover
              phase={game.phase}
              highestBid={game.highestBid}
              bidOptions={bidOptions}
              kittySize={game.kitty.length}
              selected={selectedBuryCards}
              humanHand={game.hands[seat] ?? []}
              selectedPlayCard={selectedPlayCard}
              trick={game.trick}
              result={game.result}
              confirmBeforePlay={confirmBeforePlay}
              doBid={doBid}
              doTrump={doTrump}
              doBury={doBury}
              autoSelectBury={autoSelectBury}
              clearSelectedBury={clearSelectedBury}
              confirmPlayCard={confirmPlayCard}
              goNextHand={goNextHand}
              restart={game.phase === 'matchEnd' ? goNextHand : restart}
            /></div></div>}
        </div>

        {/* 东家 (Right) */}
        <div className={`${styles.seatEast} ${seat === 0 || decisionNotice?.action.seat === 0 ? styles.seatActive : ''}`}>
          {renderHand(0, 'east')}
          {renderSeatHeader(0)}
        </div>

        {/* 南家 (Bottom) */}
        <div className={`${styles.seatSouth} ${seat === 1 || decisionNotice?.action.seat === 1 ? styles.seatActive : ''}`}>
          {renderHand(1, 'south')}
          {renderSeatHeader(1)}
        </div>
      </div>
    </div>
  );
}
