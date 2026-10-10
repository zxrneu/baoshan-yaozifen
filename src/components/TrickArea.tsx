/** 牌桌中央：四家已出的牌 + 底牌背视 + 上一墩留存 */
import { Card as CardModel } from '../cards';
import { SEAT_NAMES, TrickCard, Phase } from '../engine';
import CardView from '../CardView';

interface Props {
  trick: TrickCard[];
  lastTrick: TrickCard[];
  lastWinner: number | null;
  lastPoints: number;
  kitty: CardModel[];
  phase: Phase;
}

// 桌面布局：0东(左) 1南(下) 2西(右) 3北(上)
const SEAT_POS = ['left', 'bottom', 'right', 'top'] as const;
const SEATS = [0, 1, 2, 3];

export default function TrickArea({ trick, lastTrick, lastWinner, lastPoints, kitty, phase }: Props) {
  // 本墩有人出牌 → 显示本墩；本墩为空且有上一墩留存 → 显示上一墩（赢家高亮）
  const showingLast = trick.length === 0 && lastTrick.length > 0 && phase === 'playing';
  const shown = showingLast ? lastTrick : trick;
  // 扣底阶段旧底牌已进庄家手牌：隐藏底牌区，避免误导；扣回完成后（playing）再显示新底牌
  const showKitty = kitty.length > 0 && (phase === 'trump' || phase === 'playing' || phase === 'handEnd' || phase === 'matchEnd');

  return (
    <div className="center">
      <div className={`trick${showingLast ? ' collecting' : ''}`}>
        {SEATS.map((s) => {
          const played = shown.find((t) => t.seat === s);
          const isWinner = showingLast && lastWinner === s;
          return (
            <div key={s} className={`trick-slot ${SEAT_POS[s]}`}>
              {played ? (
                <div className={`trick-card${isWinner ? ' winner' : ''}`}>
                  <CardView card={played.card} />
                  {isWinner && <div className="winner-tag">{SEAT_NAMES[s]}收·{lastPoints}分</div>}
                </div>
              ) : (
                <div className="slot-empty" aria-label={SEAT_NAMES[s]} />
              )}
            </div>
          );
        })}
      </div>
      {showingLast && <div className="last-tip">上一墩结果（待领出新墩）</div>}
      {showKitty && (
        <div className="kitty">
          底牌：{kitty.map((c, i) => <CardView key={i} card={c} faceDown />)}
        </div>
      )}
    </div>
  );
}
