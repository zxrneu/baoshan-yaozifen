/** 牌桌中央：四家已出的牌 + 底牌背视 + 上一轮留存 */
import { Card as CardModel } from '@yaozifen/game-core/cards';
import { SEAT_NAMES, TrickCard, Phase } from '@yaozifen/game-core';
import CardView from '../CardView';
import styles from './TrickArea.module.css';

interface Props {
  viewSeat?: number;
  trick: TrickCard[];
  lastTrick: TrickCard[];
  lastWinner: number | null;
  lastPoints: number;
  kitty: CardModel[];
  phase: Phase;
  compact?: boolean;
  standalone?: boolean;
  prompt: string;
}

// 桌面布局：0东(右) 1南(下) 2西(左) 3北(上)
const SEAT_POS = ['right', 'bottom', 'left', 'top'] as const;
const SEATS = [0, 1, 2, 3];

export default function TrickArea({ trick, lastTrick, lastWinner, lastPoints, kitty, phase, prompt, compact, standalone, viewSeat = 1 }: Props) {
  // 本轮有人出牌 → 显示本轮；本轮为空且有上一轮留存 → 显示上一轮（赢家高亮）
  const showingLast = trick.length === 0 && lastTrick.length > 0 && phase === 'playing';
  const shown = showingLast ? lastTrick : trick;
  // 扣底阶段旧底牌已进庄家手牌：隐藏底牌区，避免误导；扣回完成后（playing）再显示新底牌
  const showKitty = kitty.length > 0 && (phase === 'trump' || phase === 'playing' || phase === 'handEnd' || phase === 'matchEnd');

  return (
    <div className={`${styles.center} ${compact ? styles.compact : ''} ${standalone ? styles.standalone : ''}`}>
      {phase !== 'playing' ? (
        <div className={styles.phasePrompt}>
          <strong>{prompt}</strong>
          {phase === 'bury' && <span>选取非分牌扣回底牌</span>}
        </div>
      ) : <div className={`${styles.trick} ${showingLast ? styles.collecting : ''}`}>
        {SEATS.map((s) => {
          const played = shown.find((t) => t.seat === s);
          const isWinner = showingLast && lastWinner === s;
          const posClass = styles[SEAT_POS[(s - viewSeat + 5) % 4]] ?? '';

          return (
            <div key={s} className={`${styles.trickSlot} ${posClass}`}>
              {played ? (
                <div className={`${styles.trickCard} ${isWinner ? styles.winner : ''}`}>
                  <CardView card={played.card} />
                  {isWinner && <div className={styles.winnerTag}>{SEAT_NAMES[s]}收·{lastPoints}分</div>}
                </div>
              ) : (
                <div className={styles.slotEmpty} aria-label={SEAT_NAMES[s]} />
              )}
            </div>
          );
        })}
      </div>}
      {showingLast && <div className={styles.lastTip}>上一轮结果（等待下一轮出牌）</div>}
      {showKitty && (
        <div className={styles.kitty}>
          <span className={styles.kittyLabel}>底牌</span>{kitty.map((c, i) => <CardView key={i} card={c} faceDown size="mini" />)}
        </div>
      )}
    </div>
  );
}
