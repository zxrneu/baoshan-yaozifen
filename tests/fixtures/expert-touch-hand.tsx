/** 触屏命中夹具（SRP）：使用正式手牌和牌桌样式，只记录用户实际命中的牌。 */
import { useState } from 'react';
import { createRoot } from 'react-dom/client';
import HumanHand from '../../src/components/HumanHand';
import LandscapeViewport from '../../src/components/LandscapeViewport';
import { cardId, cardPoints, makeCard, type Card } from '../../src/cards';
import styles from '../../src/App.module.css';
import '../../src/styles/index.css';

const params = new URLSearchParams(location.search);
const phase = params.has('bury') ? 'bury' : 'playing';
const cards = (['S', 'H', 'C', 'D'] as const).flatMap(suit =>
  (phase === 'bury' ? ['A', 'K', '10', 'Q'] as const : ['A', 'K', '10'] as const).map(rank => makeCard(suit, rank)));
const first = cards.find(card => cardPoints(card) === 0)!;
function Fixture() {
  const [selected, setSelected] = useState<Card[]>(params.has('selected') ? [first] : []);
  const [picked, setPicked] = useState('尚未点击');
  function pick(card: Card) {
    setPicked(cardId(card));
    setSelected(previous => phase === 'bury'
      ? previous.some(value => cardId(value) === cardId(card)) ? previous.filter(value => cardId(value) !== cardId(card)) : [...previous, card]
      : [card]);
  }
  return <LandscapeViewport><div className={styles.app}>
    <header className={styles.header}><h1>触屏牌面命中回归</h1></header>
    <div className={`${styles.workspace} ${styles.workspaceWithActions}`}>
      <main className={styles.table} aria-label="命中回归牌桌" data-phase={phase}>
        <div className={styles.playerArea}><div className={styles.southSeat}>南家 · 你</div>
          <div className={styles.handsArea}><HumanHand cards={cards} phase={phase} humanTurn
            legalIds={new Set(cards.map(cardId))} selected={phase === 'bury' ? selected : []}
            selectedPlayCard={phase === 'playing' ? selected[0] ?? null : null}
            trump="C" kittyIds={new Set(phase === 'bury' ? [cardId(cards[0]), cardId(cards[1])] : [])}
            ledSuit={null} confirmBeforePlay={!params.has('instant')} onCardClick={pick}/></div></div>
      </main>
      <aside className={styles.toolbar}><output aria-label="实际点击牌">{picked}</output></aside>
    </div>
  </div></LandscapeViewport>;
}
createRoot(document.getElementById('root')!).render(<Fixture/>);
