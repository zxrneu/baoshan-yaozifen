/** 公共明牌按花色分组，突出点数、主牌与缺门，便于对照自己的手牌。 */
import { Card, cardId, cardPoints, sortHand, Suit, SUIT_NAME, SUIT_SYMBOL } from '../cards';
import { SEAT_NAMES } from '../engine';
import styles from './RevealedHand.module.css';

interface Props {
  seat: number;
  cards: readonly Card[];
  trump: Suit | null;
  isTeammate: boolean;
  className?: string;
}

const SUIT_ORDER: readonly Suit[] = ['S', 'H', 'C', 'D'];

export default function RevealedHand({ seat, cards, trump, isTeammate, className = '' }: Props) {
  const sortedCards = sortHand(cards);
  const points = cards.reduce((sum, card) => sum + cardPoints(card), 0);

  return (
    <section className={`${styles.panel} ${className}`} aria-label={`${SEAT_NAMES[seat]}家明牌，所有人可见`}>
      <div className={styles.label}>
        <div className={styles.heading}>
          <strong>{SEAT_NAMES[seat]}家明牌</strong>
          <span className={`${styles.sideTag} ${isTeammate ? styles.teammate : styles.opponent}`}>
            {isTeammate ? '你的搭档' : '对手'}
          </span>
        </div>
        <span className={styles.summary}>剩余 {cards.length} 张 · 分牌 {points} 分</span>
      </div>
      {cards.length === 0 ? <p className={styles.empty}>手牌已出完</p> : (
        <div className={styles.groups}>
          {SUIT_ORDER.map((suit) => {
            const suitCards = sortedCards.filter((card) => card.suit === suit);
            const isTrump = suit === trump;
            const isRed = suit === 'H' || suit === 'D';

            return (
              <div
                key={suit}
                className={`${styles.suitGroup} ${isTrump ? styles.trumpGroup : ''}`}
                role="group"
                aria-label={`${SUIT_NAME[suit]}${isTrump ? '，主牌' : ''}，${suitCards.length} 张${suitCards.length === 0 ? '，缺门' : ''}`}
              >
                <div className={styles.suitLabel} aria-hidden="true">
                  <span className={styles.suitTitle}>
                    <span className={`${styles.suitSymbol} ${isRed ? styles.redSuit : ''}`}>{SUIT_SYMBOL[suit]}</span>
                    {isTrump && <span className={styles.trumpTag}>主</span>}
                  </span>
                  <span className={styles.suitCount}>{suitCards.length} 张</span>
                </div>
                {suitCards.length > 0 ? (
                  <ul className={styles.cards}>
                    {suitCards.map((card) => {
                      const cardScore = cardPoints(card);
                      return (
                        <li
                          key={cardId(card)}
                          className={`${styles.rankCard} ${isRed ? styles.redCard : ''} ${cardScore > 0 ? styles.pointCard : ''}`}
                          aria-label={`${card.rank}${SUIT_SYMBOL[suit]}${isTrump ? '，主牌' : ''}${cardScore > 0 ? `，${cardScore}分` : ''}`}
                        >
                          <span className={styles.rank}>{card.rank}</span>
                          {cardScore > 0 && <span className={styles.points}>{cardScore}分</span>}
                        </li>
                      );
                    })}
                  </ul>
                ) : <span className={styles.voidSuit}>缺门</span>}
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
}
