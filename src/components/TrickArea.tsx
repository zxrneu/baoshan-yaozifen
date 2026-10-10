/** 牌桌中央：四家已出的牌 + 底牌背视 */
import { Card as CardModel } from '../cards';
import { SEAT_NAMES, TrickCard, Phase } from '../engine';
import CardView from '../CardView';

interface Props {
  trick: TrickCard[];
  kitty: CardModel[];
  phase: Phase;
}

// 桌面布局：0东(左) 1南(下) 2西(右) 3北(上)
const SEAT_POS = ['left', 'bottom', 'right', 'top'] as const;
const SEATS = [0, 1, 2, 3];

export default function TrickArea({ trick, kitty, phase }: Props) {
  return (
    <div className="center">
      <div className="trick">
        {SEATS.map((s) => {
          const played = trick.find((t) => t.seat === s);
          return (
            <div key={s} className={`trick-slot ${SEAT_POS[s]}`}>
              {played ? <CardView card={played.card} /> : <div className="slot-empty" aria-label={SEAT_NAMES[s]} />}
            </div>
          );
        })}
      </div>
      {kitty.length > 0 && phase !== 'bidding' && (
        <div className="kitty">
          底牌：{kitty.map((c, i) => <CardView key={i} card={c} faceDown />)}
        </div>
      )}
    </div>
  );
}
