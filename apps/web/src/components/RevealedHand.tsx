/** 公共明牌复用玩家手牌的牌面和叠牌布局。 */
import type { CSSProperties } from 'react';
import { Card, cardId, cardPoints, sortHand, Suit } from '@yaozifen/game-core/cards';
import { SEAT_NAMES } from '@yaozifen/game-core';
import CardView from '../CardView';
import handStyles from './HumanHand.module.css';
import styles from './RevealedHand.module.css';

interface Props {
  seat: number;
  cards: readonly Card[];
  trump: Suit | null;
  isTeammate: boolean;
  className?: string;
  compactLabel?: boolean;
  orientation?: 'left' | 'right' | 'top';
}

export default function RevealedHand({ seat, cards, trump, isTeammate, className = '', compactLabel, orientation }: Props) {
  const sortedCards = sortHand(cards);
  const points = cards.reduce((sum, card) => sum + cardPoints(card), 0);

  return (
    <section className={`${styles.panel} ${className}`} aria-label={`${SEAT_NAMES[seat]}家明牌，所有人可见`}>
      <div className={styles.label}>
        {!compactLabel && <div className={styles.heading}>
          <strong>{SEAT_NAMES[seat]}家明牌</strong>
          <span className={`${styles.sideTag} ${isTeammate ? styles.teammate : styles.opponent}`}>
            {isTeammate ? '你的搭档' : '对手'}
          </span>
        </div>}
        <span className={styles.summary}>{compactLabel ? '明牌' : `剩余 ${cards.length} 张`} · 分牌 {points} 分</span>
      </div>
      {cards.length === 0 ? <p className={styles.empty}>手牌已出完</p> : (
        <div
          className={`${styles.fanFrame} ${orientation ? styles[orientation] : ''} ${cards.length === 1 ? styles.oneCard : ''}`}
          style={{
            '--full-fan-gaps': Math.max(0, cards.length - 1),
            '--compact-fan-gaps': Math.max(0, Math.min(6, cards.length) - 1),
            '--compact-fan-rows': Math.ceil(cards.length / 6),
          } as CSSProperties}
        >
          <div
            className={`${handStyles.hand} ${styles.cards} ${cards.length === 1 ? handStyles.singleCard : ''}`}
            style={{ '--hand-gaps': Math.max(1, cards.length - 1) } as CSSProperties}
            aria-label={`${SEAT_NAMES[seat]}家剩余 ${cards.length} 张明牌`}
          >
            {sortedCards.map((card, index) => (
              <div key={cardId(card)} className={handStyles.handCardWrapper} style={{ zIndex: index + 1 }}>
                <CardView card={card} isTrump={card.suit === trump} playable={false} />
              </div>
            ))}
          </div>
        </div>
      )}
    </section>
  );
}
