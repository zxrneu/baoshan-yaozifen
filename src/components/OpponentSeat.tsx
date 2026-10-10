/** 三家座位：独立网格位置、阶段角色与剩余牌数，牌背最多展示三张。 */
import { SEAT_NAMES } from '../engine';
import type { Card, Suit } from '../cards';
import CardView from '../CardView';
import RevealedHand from './RevealedHand';
import styles from './OpponentSeat.module.css';

interface Props {
  seat: number;
  cardCount: number;
  isTurn: boolean;
  isDeclarer: boolean;
  isPartner: boolean;
  hasDeclarer: boolean;
  isTeammate: boolean;
  isRevealed?: boolean;
  revealedCards?: readonly Card[];
  trump?: Suit | null;
  points?: number;
  biddingNote?: number | null; // 最近一次叫分情况
  isBiddingPhase?: boolean;
}

const SEAT_POS = ['left', 'bottom', 'right', 'top'] as const;

const SEAT_AVATARS: Record<number, { emoji: string; title: string }> = {
  0: { emoji: '🤠', title: '东家' },
  1: { emoji: '👑', title: '南家（你）' },
  2: { emoji: '🎩', title: '西家' },
  3: { emoji: '👲', title: '北家' },
};

export default function OpponentSeat({
  seat,
  cardCount,
  isTurn,
  isDeclarer,
  isPartner,
  hasDeclarer,
  isTeammate,
  isRevealed,
  revealedCards,
  trump,
  points,
  biddingNote,
  isBiddingPhase,
}: Props) {
  const avatar = SEAT_AVATARS[seat] ?? { emoji: '🧑', title: SEAT_NAMES[seat] };
  const isAlarm = cardCount > 0 && cardCount <= 3;
  const posClass = styles[SEAT_POS[seat]] ?? '';

  return (
    <div className={`${styles.seat} ${posClass} ${isTurn ? styles.turn : ''} ${isRevealed ? styles.withRevealedHand : ''}`}>
      {/* 叫分阶段的最近行动 */}
      {isBiddingPhase && isTurn && biddingNote === undefined && (
        <div className={`${styles.seatBubble} ${styles.thinking}`}>
          <span>🤔 思考中…</span>
          <span className={styles.bubbleArrow} />
        </div>
      )}
      {biddingNote !== undefined && (
        <div className={`${styles.seatBubble} ${biddingNote === null ? styles.pass : styles.bid}`}>
          <span>{biddingNote === null ? '不叫' : `叫 ${biddingNote} 分`}</span>
          <span className={styles.bubbleArrow} />
        </div>
      )}

      {/* 头像展示区 */}
      <div className={styles.seatAvatarWrap}>
        <div className={`${styles.avatarFrame} ${isTurn ? styles.glowing : ''}`}>
          <span className={styles.avatarIcon}>{avatar.emoji}</span>
        </div>

        <div className={styles.seatInfoBox}>
          <div className={styles.seatName}>
            <span>{SEAT_NAMES[seat]}</span>
            {isDeclarer && <span className={`${styles.badge} ${styles.declarer}`}>👑 庄</span>}
            {isPartner && <span className={`${styles.badge} ${styles.partner}`}>🤝 搭</span>}
            {hasDeclarer && !isDeclarer && !isPartner && <span className={`${styles.badge} ${styles.defender}`}>闲</span>}
            {!hasDeclarer && isTeammate && <span className={`${styles.badge} ${styles.partner}`}>同队</span>}
          </div>

          {/* 确定庄家后显示个人吃分 */}
          {hasDeclarer && <div className={styles.seatPointsChip} title={`${SEAT_NAMES[seat]}已收得分牌分`}>
            <span className={styles.ptsCoin}>🪙</span>
            <span className={styles.ptsVal}>{points ?? 0}分</span>
          </div>}

          {cardCount > 0 && (
            <div className={`${styles.seatCount} ${isAlarm ? styles.alarm : ''}`}>
              <span>🎴</span>
              <span>{cardCount}张</span>
              {isAlarm && <span className={styles.alertTag}>警报!</span>}
            </div>
          )}
        </div>
      </div>

      {isRevealed && revealedCards ? (
        <RevealedHand
          seat={seat}
          cards={revealedCards}
          trump={trump ?? null}
          isTeammate={isTeammate}
          className={styles.revealedCards}
          compactLabel
          orientation={SEAT_POS[seat] === 'left' ? 'left' : SEAT_POS[seat] === 'right' ? 'right' : 'top'}
        />
      ) : <div className={styles.seatCards} aria-label={`剩余 ${cardCount} 张手牌`}>
        {Array.from({ length: Math.min(cardCount, 3) }, (_, i) => (
          <CardView key={i} card={{ suit: 'S', rank: '2' }} size="mini" faceDown />
        ))}
      </div>}
    </div>
  );
}
