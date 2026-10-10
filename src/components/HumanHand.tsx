/** 人类手牌：出牌防误触、扣底多选、主牌高亮与花色隔断 */
import { Card as CardModel, Suit, cardPoints } from '../cards';
import type { CSSProperties } from 'react';
import { Phase } from '../engine';
import CardView from '../CardView';
import styles from './HumanHand.module.css';

interface Props {
  cards: CardModel[];
  phase: Phase;
  legalIds: ReadonlySet<string>;
  selected: CardModel[];
  selectedPlayCard: CardModel | null;
  trump: Suit | null;
  kittyIds: ReadonlySet<string>;
  /** 当前轮首家花色（跟牌时用于判断是否缺门可杀） */
  ledSuit: Suit | null;
  onCardClick: (card: CardModel) => void;
}

export default function HumanHand({
  cards,
  phase,
  legalIds,
  selected,
  selectedPlayCard,
  trump,
  kittyIds,
  ledSuit,
  onCardClick,
}: Props) {
  const isBuryPhase = phase === 'bury';
  // 缺门可杀：出牌阶段、有领出花色、手里无该门花色、且持有主牌 → 提示可杀
  const canTrumpKill =
    phase === 'playing' &&
    ledSuit !== null &&
    trump !== null &&
    !cards.some((c) => c.suit === ledSuit) &&
    cards.some((c) => c.suit === trump);

  return (
    <div className={styles.handWrap}>
      {kittyIds.size > 0 && (
        <div className={styles.kittyTip}>带“底”标记的是本副摸入的底牌</div>
      )}
      {canTrumpKill && (
        <div className={styles.killTip}>
          ⚡ 缺门可杀：已缺 {ledSuitName(ledSuit)}，可用主牌抢分！
        </div>
      )}
      <div
        className={`${styles.hand} ${isBuryPhase ? styles.buryHand : cards.length > 12 ? styles.longHand : ''} ${cards.length <= 1 ? styles.singleCard : ''}`}
        style={{ '--hand-gaps': Math.max(1, cards.length - 1) } as CSSProperties}
        aria-label={`你的手牌，共 ${cards.length} 张`}
      >
        {cards.map((c, i) => {
          const id = `${c.rank}${c.suit}`;
          const isLegal = phase === 'playing' && legalIds.has(id);
          const isBuryPick = selected.some((x) => x.rank === c.rank && x.suit === c.suit);
          const isPlayPick =
            phase === 'playing' &&
            selectedPlayCard !== null &&
            selectedPlayCard.rank === c.rank &&
            selectedPlayCard.suit === c.suit;

          const isSelected = isBuryPick || isPlayPick;
          const isBuryPointCard = phase === 'bury' && cardPoints(c) > 0;
          const clickable = isLegal || phase === 'bury';
          const isSuitStart = i > 0 && cards[i].suit !== cards[i - 1].suit;

          return (
            <div
              key={id}
              className={`${styles.handCardWrapper} ${isSuitStart ? styles.suitStart : ''}`}
              style={{ zIndex: isBuryPhase ? undefined : isSelected ? 40 : i + 1 }}
            >
              <CardView
                card={c}
                playable={clickable}
                selected={isSelected}
                disabled={(phase === 'playing' && !isLegal) || isBuryPointCard}
                isTrump={trump !== null && c.suit === trump}
                isKitty={kittyIds.has(id)}
                onClick={clickable ? () => onCardClick(c) : undefined}
              />
              {isBuryPhase && isBuryPick && (
                <span className={styles.buryCheck} aria-hidden="true">✓</span>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function ledSuitName(s: Suit): string {
  return ({ S: '黑桃♠', H: '红桃♥', D: '方块♦', C: '梅花♣' } as Record<Suit, string>)[s];
}
