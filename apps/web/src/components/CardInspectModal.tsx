/** 牌张查看只负责放大已可见的牌，不读取牌局暗牌。 */
import { type Card, SUIT_NAME, cardPoints, cardLabel } from '@yaozifen/game-core/cards';
import CardView from '../CardView';
import Modal from './Modal';
import type { CSSProperties } from 'react';
import { CardInspectionContext } from './cardInspection';
export default function CardInspectModal({ card, trump, onClose }: { card: Card; trump: string | null; onClose: () => void }) {
  return <Modal label="查看牌张" onClose={onClose} className="modal-box">
    <h2>{SUIT_NAME[card.suit]} {card.rank}</h2>
    <CardInspectionContext.Provider value={null}><div style={{'--card-w':'130px','--card-h':'182px',display:'flex',justifyContent:'center',margin:'24px 0'} as CSSProperties}><CardView card={card} isTrump={card.suit === trump} /></div></CardInspectionContext.Provider>
    <p>{cardLabel(card)} · {cardPoints(card)} 分{card.suit === trump ? ' · 主牌' : ''}</p>
    <button type="button" className="primary-btn" onClick={onClose}>返回牌桌</button>
  </Modal>;
}
