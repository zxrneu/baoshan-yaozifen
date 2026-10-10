/** 人类手牌：出牌/扣底两种交互模式，逻辑由 props 驱动 */
import { Card as CardModel, cardPoints } from '../cards';
import { Phase } from '../engine';
import CardView from '../CardView';

interface Props {
  cards: CardModel[];
  phase: Phase;
  legalIds: ReadonlySet<string>;
  selected: CardModel[];
  onCardClick: (card: CardModel) => void;
}

export default function HumanHand({ cards, phase, legalIds, selected, onCardClick }: Props) {
  return (
    <div className="hand">
      {cards.map((c) => {
        const id = `${c.rank}${c.suit}`;
        const isLegal = phase === 'playing' && legalIds.has(id);
        const isBuryPick = selected.some((x) => x.rank === c.rank && x.suit === c.suit);
        const buryable = phase === 'bury' && (cardPoints(c) === 0 || isBuryPick);
        const clickable = isLegal || buryable;
        return (
          <CardView
            key={id}
            card={c}
            playable={clickable}
            selected={isBuryPick}
            disabled={!clickable}
            onClick={clickable ? () => onCardClick(c) : undefined}
          />
        );
      })}
    </div>
  );
}
