/** 对家三家的座位牌背视图 */
import { SEAT_NAMES } from '../engine';
import CardView from '../CardView';

interface Props {
  seat: number;
  cardCount: number;
  isTurn: boolean;
  isDeclarer: boolean;
  isPartner: boolean;
}

const SEAT_POS = ['left', 'bottom', 'right', 'top'] as const;

export default function OpponentSeat({ seat, cardCount, isTurn, isDeclarer, isPartner }: Props) {
  return (
    <div className={`seat ${SEAT_POS[seat]} ${isTurn ? 'turn' : ''}`}>
      <div className="seat-name">
        {SEAT_NAMES[seat]}
        {isDeclarer && <b className="badge">庄</b>}
        {isPartner && <b className="badge partner">搭</b>}
      </div>
      <div className="seat-cards">
        {Array.from({ length: cardCount }, (_, i) => (
          <CardView key={i} card={{ suit: 'S', rank: '2' }} faceDown />
        ))}
      </div>
    </div>
  );
}
