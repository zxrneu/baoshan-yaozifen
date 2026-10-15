/** 人类手牌：出牌防误触、扣底多选、主牌高亮与花色隔断 */
import { Card as CardModel, Suit, SUIT_NAME, SUIT_SYMBOL, cardPoints } from '@yaozifen/game-core/cards';
import type { CSSProperties } from 'react';
import { Phase } from '@yaozifen/game-core';
import CardView from '../CardView';
import styles from './HumanHand.module.css';

interface Props {
  cards: CardModel[];
  phase: Phase;
  humanTurn: boolean;
  legalIds: ReadonlySet<string>;
  selected: CardModel[];
  selectedPlayCard: CardModel | null;
  trump: Suit | null;
  kittyIds: ReadonlySet<string>;
  /** 当前轮首家花色（跟牌时用于判断是否缺门可杀） */
  ledSuit: Suit | null;
  /** 出牌是否需要二次确认：开启时选中的牌会提示「再点一次出牌」 */
  confirmBeforePlay: boolean;
  onCardClick: (card: CardModel) => void;
}

export default function HumanHand({
  cards,
  phase,
  humanTurn,
  legalIds,
  selected,
  selectedPlayCard,
  trump,
  kittyIds,
  ledSuit,
  confirmBeforePlay,
  onCardClick,
}: Props) {
  const isBuryPhase = phase === 'bury';
  const mustFollow = humanTurn && phase === 'playing' && ledSuit !== null
    && cards.some((c) => c.suit === ledSuit);
  // 缺门可杀：出牌阶段、有领出花色、手里无该门花色、且持有主牌 → 提示可杀
  const canTrumpKill =
    humanTurn && phase === 'playing' &&
    ledSuit !== null &&
    trump !== null &&
    !cards.some((c) => c.suit === ledSuit) &&
    cards.some((c) => c.suit === trump);

  return (
    <div className={styles.handWrap}>
      {/*
       * 提示统一收进 tipStack 并按实际内容占位，换行后也不会被选中手牌遮挡。
       */}
      <div className={styles.tipStack}>
        {kittyIds.size > 0 && isBuryPhase && (
          <div className={styles.kittyTip}>带“底”标记的是本副摸入的底牌</div>
        )}
        {mustFollow && cards.some((c) => c.suit !== ledSuit) && (
          <div className={styles.ruleTip}>
            须跟 {ledSuitName(ledSuit)}<span className={styles.ruleDetail}> · 灰色牌本轮不可出</span>
          </div>
        )}
        {humanTurn && isBuryPhase && (
          <div className={styles.ruleTip}>灰色分牌（A / 10 / 5）不能扣底</div>
        )}
        {canTrumpKill && (
          <div className={styles.killTip}>
            ⚡ 缺门可杀：已缺 {ledSuitName(ledSuit)}，可用主牌抢分！
          </div>
        )}
        {/* 选中态在触屏上没有 hover 可依赖，这里给出一条常驻文字反馈，说明下一步动作。 */}
        {humanTurn && phase === 'playing' && selectedPlayCard !== null && (
          <div className={styles.playPickTip}>
            {confirmBeforePlay
              ? <>已选 <strong>{selectedPlayCard.rank}{SUIT_SYMBOL[selectedPlayCard.suit]}</strong> · 再点同一张牌出牌</>
              : <>已选 <strong>{selectedPlayCard.rank}{SUIT_SYMBOL[selectedPlayCard.suit]}</strong> · 点其他牌即出</>}
          </div>
        )}
      </div>
      <div
        className={`${styles.hand} ${isBuryPhase ? styles.buryHand : cards.length > 12 ? styles.longHand : ''} ${cards.length <= 1 ? styles.singleCard : ''}`}
        style={{ '--hand-gaps': Math.max(1, cards.length - 1) } as CSSProperties}
        aria-label={`你的手牌，共 ${cards.length} 张`}
      >
        {cards.map((c, i) => {
          const id = `${c.rank}${c.suit}`;
          const isLegal = humanTurn && phase === 'playing' && legalIds.has(id);
          const isBuryPick = selected.some((x) => x.rank === c.rank && x.suit === c.suit);
          const isPlayPick =
            humanTurn && phase === 'playing' &&
            selectedPlayCard !== null &&
            selectedPlayCard.rank === c.rank &&
            selectedPlayCard.suit === c.suit;

          const isSelected = isBuryPick || isPlayPick;
          const isBuryPointCard = humanTurn && isBuryPhase && cardPoints(c) > 0;
          const isIllegalPlay = humanTurn && phase === 'playing' && !isLegal;
          const clickable = isLegal || (humanTurn && isBuryPhase);
          const selectable = clickable && !isBuryPointCard;
          const disabledReason = isBuryPointCard ? '分牌不能扣底'
            : isIllegalPlay && ledSuit !== null ? `须跟${ledSuitName(ledSuit)}，本轮不可出`
            : undefined;
          const isSuitStart = i > 0 && cards[i].suit !== cards[i - 1].suit;

          return (
            <div
              key={id}
              className={`${styles.handCardWrapper} ${selectable ? styles.selectable : ''} ${isSuitStart ? styles.suitStart : ''}`}
              style={{ zIndex: isBuryPhase ? undefined : isSelected ? 40 : i + 1 }}
            >
              <CardView
                card={c}
                playable={selectable}
                selected={isSelected}
                disabled={isIllegalPlay || isBuryPointCard}
                disabledReason={disabledReason}
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
  return `${SUIT_NAME[s]}${SUIT_SYMBOL[s]}`;
}
