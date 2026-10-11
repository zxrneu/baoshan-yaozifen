/**
 * SquareTable：上帝/调试模式下的 1:1 正方形对称牌桌组件。
 * 上北下南，左西右东；四方明手一览无余，支持任意轮次座位的直观点击手动出牌与 AI 推荐高亮。
 */
import { useState, useMemo } from 'react';
import { Card as CardModel, SUIT_NAME, SUIT_SYMBOL, cardId, cardPoints, sortHand } from '../cards';
import { GameState, SEAT_NAMES, sideOf, legalMoves } from '../engine';
import CardView from '../CardView';
import ControlPanel from './ControlPanel';
import SeatActivity from './SeatActivity';
import TurnPointer from './TurnPointer';
import type { SeatDecisionNotice } from '../hooks/useGame';
import styles from './SquareTable.module.css';

interface Props {
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
  initialOrientation?: 'player' | 'viewer';
  onHumanCardClick: (card: CardModel) => void;
  onManualPlaySeat: (seat: number, card: CardModel) => void;
  confirmPlayCard: () => void;
  doBid: (b: number | null) => void;
  doTrump: (s: any) => void;
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
  initialOrientation = 'player',
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
  // 牌面朝向：'player' 朝向各自玩家（真实物理牌桌几何）；'viewer' 全部正向朝向我
  const [cardOrientation, setCardOrientation] = useState<'player' | 'viewer'>(() => {
    try {
      const saved = localStorage.getItem('yaozifen_card_orientation');
      if (saved === 'player' || saved === 'viewer') return saved;
    } catch {}
    return initialOrientation;
  });

  const toggleOrientation = () => {
    const next = cardOrientation === 'player' ? 'viewer' : 'player';
    setCardOrientation(next);
    try {
      localStorage.setItem('yaozifen_card_orientation', next);
    } catch {}
  };

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

  // 渲染某位玩家的手牌
  const renderHand = (seatNum: number, position: 'north' | 'south' | 'west' | 'east') => {
    const rawCards = game.hands[seatNum] ?? [];
    const sorted = sortHand(rawCards);
    const isCurrentTurn = seat === seatNum && game.phase === 'playing';

    // 1. 面向各自玩家模式 ('player')
    if (cardOrientation === 'player') {
      if (position === 'west') {
        // 西家：竖排单列，顺时针旋转90度朝向牌桌中央（朝东），各牌左上角标朝北暴露，层叠 zIndex: idx + 1
        return (
          <div className={styles.handColWest}>
            {sorted.map((card, idx) => {
              const id = cardId(card);
              const isLegal = isCurrentTurn && currentSeatLegals.has(id);
              const isSelected = selectedCard(seatNum, id);
              const isHinted = aiHintCard !== null && cardId(aiHintCard) === id;
              const isSuitBreak = idx > 0 && card.suit !== sorted[idx - 1].suit;

              const zIndex = isSelected ? 60 : isHinted ? 50 : idx + 1;

              return (
                <div
                  key={id}
                  className={`${styles.cardWrapperWest} ${isSuitBreak ? styles.suitBreakWest : ''} ${isSelected ? styles.selectedWrapperWest : ''}`}
                  style={{ zIndex }}
                >
                  <div className={`${styles.cardInnerWest} ${isHinted ? styles.aiHintCard : ''}`}>
                    <CardView
                      card={card}
                      playable={isLegal || buryPlayable(seatNum, card)}
                      selected={isSelected}
                      className={isSelected ? styles.cardSelectedGlow : ''}
                      isTrump={game.trump !== null && card.suit === game.trump}
                      onClick={() => handleCardClick(seatNum, card, isCurrentTurn)}
                    />
                  </div>
                </div>
              );
            })}
          </div>
        );
      }

      if (position === 'east') {
        // 东家：竖排单列，逆时针旋转90度朝向牌桌中央（朝西），各牌左上角标朝南暴露，层叠 zIndex: sorted.length - idx
        return (
          <div className={styles.handColEast}>
            {sorted.map((card, idx) => {
              const id = cardId(card);
              const isLegal = isCurrentTurn && currentSeatLegals.has(id);
              const isSelected = selectedCard(seatNum, id);
              const isHinted = aiHintCard !== null && cardId(aiHintCard) === id;
              const isSuitBreak = idx > 0 && card.suit !== sorted[idx - 1].suit;

              const zIndex = isSelected ? 60 : isHinted ? 50 : sorted.length - idx;

              return (
                <div
                  key={id}
                  className={`${styles.cardWrapperEast} ${isSuitBreak ? styles.suitBreakEast : ''} ${isSelected ? styles.selectedWrapperEast : ''}`}
                  style={{ zIndex }}
                >
                  <div className={`${styles.cardInnerEast} ${isHinted ? styles.aiHintCard : ''}`}>
                    <CardView
                      card={card}
                      playable={isLegal || buryPlayable(seatNum, card)}
                      selected={isSelected}
                      className={isSelected ? styles.cardSelectedGlow : ''}
                      isTrump={game.trump !== null && card.suit === game.trump}
                      onClick={() => handleCardClick(seatNum, card, isCurrentTurn)}
                    />
                  </div>
                </div>
              );
            })}
          </div>
        );
      }

      if (position === 'north') {
        // 北家：横排单行，旋转180度朝向牌桌中央（朝南），各牌左上角标在右下方，层叠 zIndex: sorted.length - idx
        return (
          <div className={`${styles.handRow} ${styles.handRowNorth}`}>
            {sorted.map((card, idx) => {
              const id = cardId(card);
              const isLegal = isCurrentTurn && currentSeatLegals.has(id);
              const isSelected = selectedCard(seatNum, id);
              const isHinted = aiHintCard !== null && cardId(aiHintCard) === id;
              const isSuitBreak = idx > 0 && card.suit !== sorted[idx - 1].suit;

              const zIndex = isSelected ? 60 : isHinted ? 50 : sorted.length - idx;

              return (
                <div
                  key={id}
                  className={`${styles.cardWrapperNorth} ${isSuitBreak ? styles.suitBreakNorth : ''} ${isSelected ? styles.selectedWrapperNorth : ''}`}
                  style={{ zIndex }}
                >
                  <div className={`${styles.cardInnerNorth} ${isHinted ? styles.aiHintCard : ''}`}>
                    <CardView
                      card={card}
                      playable={isLegal || buryPlayable(seatNum, card)}
                      selected={isSelected}
                      className={isSelected ? styles.cardSelectedGlow : ''}
                      isTrump={game.trump !== null && card.suit === game.trump}
                      onClick={() => handleCardClick(seatNum, card, isCurrentTurn)}
                    />
                  </div>
                </div>
              );
            })}
          </div>
        );
      }
    }

    // 2. 面向观察者视图 ('viewer') 或 南家手牌 (position === 'south')
    if (position === 'west' || position === 'east') {
      // 东西两侧观察者视图：分为两排横排正向展开
      const splitIdx = sorted.length > 5 ? Math.ceil(sorted.length / 2) : sorted.length;
      const rows = [
        sorted.slice(0, splitIdx),
        sorted.slice(splitIdx),
      ].filter((r) => r.length > 0);

      return (
        <div className={styles.sideHandContainer}>
          {rows.map((rowCards, rowIdx) => (
            <div key={rowIdx} className={styles.sideHandRow}>
              {rowCards.map((card, idx) => {
                const id = cardId(card);
                const isLegal = isCurrentTurn && currentSeatLegals.has(id);
                const isSelected = selectedCard(seatNum, id);
                const isHinted = aiHintCard !== null && cardId(aiHintCard) === id;
                const isSuitBreak = idx > 0 && card.suit !== rowCards[idx - 1].suit;

                const itemCls = [
                  styles.sideCardItem,
                  isSuitBreak ? styles.suitBreak : '',
                  isSelected ? styles.selectedCard : '',
                  isHinted ? styles.aiHintCard : '',
                ].filter(Boolean).join(' ');

                return (
                  <div
                    key={id}
                    className={itemCls}
                    style={{ zIndex: isSelected || isHinted ? 50 : idx + 1 }}
                  >
                    <CardView
                      card={card}
                      playable={isLegal || buryPlayable(seatNum, card)}
                      selected={isSelected}
                      isTrump={game.trump !== null && card.suit === game.trump}
                      onClick={() => handleCardClick(seatNum, card, isCurrentTurn)}
                    />
                  </div>
                );
              })}
            </div>
          ))}
        </div>
      );
    }

    // 南家（或北家在viewer模式下）：正向横排，向北展开
    return (
      <div className={`${styles.handRow} ${position === 'north' ? styles.handRowNorth : styles.handRowSouth}`}>
        {sorted.map((card, idx) => {
          const id = cardId(card);
          const isLegal = isCurrentTurn && currentSeatLegals.has(id);
          const isSelected = selectedCard(seatNum, id);
          const isHinted = aiHintCard !== null && cardId(aiHintCard) === id;
          const isSuitBreak = idx > 0 && card.suit !== sorted[idx - 1].suit;

          const itemCls = [
            styles.handCardItem,
            isSuitBreak ? styles.suitBreak : '',
            isSelected ? styles.selectedCard : '',
            isHinted ? styles.aiHintCard : '',
          ].filter(Boolean).join(' ');

          return (
            <div
              key={id}
              className={itemCls}
              style={{ zIndex: isSelected || isHinted ? 50 : idx + 1 }}
            >
              <CardView
                card={card}
                playable={isLegal || buryPlayable(seatNum, card)}
                selected={isSelected}
                isTrump={game.trump !== null && card.suit === game.trump}
                onClick={() => handleCardClick(seatNum, card, isCurrentTurn)}
              />
            </div>
          );
        })}
      </div>
    );
  };

  // 渲染座位标签头
  const renderSeatHeader = (s: number) => {
    const isTurn = seat === s && game.phase !== 'handEnd' && game.phase !== 'matchEnd';
    const isDeclarer = game.declarer === s;
    const isPartner =
      game.declarer !== null && game.declarer !== s && sideOf(s) === sideOf(game.declarer);

    const latestBid = game.bidding.filter((b) => b.seat === s).slice(-1)[0];
    const notice = decisionNotice?.action.seat === s ? decisionNotice : null;

    return (
      <div className={styles.seatHeaderAnchor}>
        <SeatActivity
          seat={s}
          isTurn={isTurn}
          isThinking={isTurn && isThinking}
          hasReadyDecision={isTurn && hasReadyDecision}
          showTurnIndicator={false}
          notice={notice}
          onDismiss={onDismissDecision}
        />
        <div className={`${styles.seatHeader} ${isTurn ? styles.seatTurn : ''}`}>
          <span className={styles.seatAvatar}>{SEAT_AVATARS[s]}</span>
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
      <div className={isWinner ? styles.winnerTrickCard : undefined}>
        <CardView card={found.card} />
        {isWinner && <div className={styles.winnerTag}>{SEAT_NAMES[s]}收·{game.lastPoints}分</div>}
      </div>
    );
  };

  return (
    <div className={styles.squareContainer}>
      <div className={styles.squareTable} aria-label="正方形上帝调试牌桌">
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
          {game.phase !== 'handEnd' && game.phase !== 'matchEnd' && (
            <TurnPointer seat={seat} isThinking={isThinking} hasReadyDecision={hasReadyDecision} />
          )}
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
            <span className={styles.hudDivider}>|</span>
            <button
              type="button"
              className={styles.orientationToggleBtn}
              onClick={toggleOrientation}
              title="切换牌面朝向：面向各自玩家 / 全部朝向我"
              aria-label="切换牌面朝向"
            >
              {cardOrientation === 'player' ? '🎴 朝向各玩家' : '👀 全部朝向我'}
            </button>
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
            <ControlPanel
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
              doBid={doBid}
              doTrump={doTrump}
              doBury={doBury}
              autoSelectBury={autoSelectBury}
              clearSelectedBury={clearSelectedBury}
              confirmPlayCard={confirmPlayCard}
              goNextHand={goNextHand}
              restart={game.phase === 'matchEnd' ? goNextHand : restart}
            />
        </div>

        {/* 东家 (Right) */}
        <div className={`${styles.seatEast} ${seat === 0 || decisionNotice?.action.seat === 0 ? styles.seatActive : ''}`}>
          {renderSeatHeader(0)}
          {renderHand(0, 'east')}
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
