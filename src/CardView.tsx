/** 纯展示组件：一张牌 */
import { Card as CardModel, SUIT_SYMBOL, cardPoints } from './cards';

interface Props {
  card: CardModel;
  faceDown?: boolean;
  selected?: boolean;
  disabled?: boolean;
  playable?: boolean;
  onClick?: () => void;
}

const RED = new Set(['H', 'D']);

export default function CardView({ card, faceDown, selected, disabled, playable, onClick }: Props) {
  if (faceDown) {
    return <div className="card face-down" aria-label="暗牌" />;
  }
  const cls = [
    'card',
    RED.has(card.suit) ? 'red' : 'black',
    selected ? 'selected' : '',
    playable ? 'playable' : '',
    disabled ? 'disabled' : '',
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
      <span className="corner bottom">
        {card.rank}
        <i>{SUIT_SYMBOL[card.suit]}</i>
      </span>
    </button>
  );
}
