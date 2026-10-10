/** 纯展示组件：一张牌 */
import { Card as CardModel, SUIT_SYMBOL, cardPoints } from './cards';

interface Props {
  card: CardModel;
  faceDown?: boolean;
  selected?: boolean;
  disabled?: boolean;
  playable?: boolean;
  /** 是否为主牌（手牌角标用，不影响规则） */
  isTrump?: boolean;
  onClick?: () => void;
}

const RED = new Set(['H', 'D']);

export default function CardView({ card, faceDown, selected, disabled, playable, isTrump, onClick }: Props) {
  if (faceDown) {
    return <div className="card face-down" aria-label="暗牌" />;
  }
  const cls = [
    'card',
    RED.has(card.suit) ? 'red' : 'black',
    selected ? 'selected' : '',
    playable ? 'playable' : '',
    disabled ? 'disabled' : '',
    isTrump ? 'is-trump' : '',
  ].filter(Boolean).join(' ');
  const pts = cardPoints(card);
  return (
    <button type="button" className={cls} onClick={onClick} disabled={disabled && !onClick}>
      <span className="corner top">
        {card.rank}
        <i>{SUIT_SYMBOL[card.suit]}</i>
      </span>
      <span className="pip">{SUIT_SYMBOL[card.suit]}</span>
      {pts > 0 && <span className="pts">{pts}</span>}
      {isTrump && <span className="trump-flag" aria-label="主牌">主</span>}
      <span className="corner bottom">
        {card.rank}
        <i>{SUIT_SYMBOL[card.suit]}</i>
      </span>
    </button>
  );
}
