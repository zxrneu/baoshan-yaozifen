/** 人类手牌：出牌/扣底两种交互模式，逻辑由 props 驱动 */
import { Card as CardModel, Suit, cardPoints } from '../cards';
import { Phase } from '../engine';
import CardView from '../CardView';

interface Props {
  cards: CardModel[];
  phase: Phase;
  legalIds: ReadonlySet<string>;
  selected: CardModel[];
  trump: Suit | null;
  /** 当前墩首家花色（跟牌时用于判断是否缺门可杀） */
  ledSuit: Suit | null;
  onCardClick: (card: CardModel) => void;
}

export default function HumanHand({ cards, phase, legalIds, selected, trump, ledSuit, onCardClick }: Props) {
  // 缺门可杀：出牌阶段、有领出花色、手里无该门花色、且持有主牌 → 提示可杀
  const canTrumpKill =
    phase === 'playing' &&
    ledSuit !== null &&
    trump !== null &&
    !cards.some((c) => c.suit === ledSuit) &&
    cards.some((c) => c.suit === trump);
  return (
    <div className="hand-wrap">
      {canTrumpKill && <div className="kill-tip">缺门可杀：已缺 {ledSuitName(ledSuit)}，可用主牌抢分</div>}
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
              isTrump={trump !== null && c.suit === trump}
              onClick={clickable ? () => onCardClick(c) : undefined}
            />
          );
        })}
      </div>
    </div>
  );
}

function ledSuitName(s: Suit): string {
  return ({ S: '黑桃♠', H: '红桃♥', D: '方块♦', C: '梅花♣' } as Record<Suit, string>)[s];
}
