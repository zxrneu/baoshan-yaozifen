/** 浏览器布局回归：复用真实组件与样式，以实际矩形验证提示不会被手牌遮挡。 */
import { useLayoutEffect, useRef, useState, type CSSProperties } from 'react';
import { createRoot } from 'react-dom/client';
import HumanHand from '@yaozifen/web/components/HumanHand';
import LandscapeViewport from '@yaozifen/web/components/LandscapeViewport';
import handStyles from '../../apps/web/src/components/HumanHand.module.css';
import { cardId, makeCard, type Card, type Suit } from '@yaozifen/game-core/cards';
import '../../apps/web/src/styles/index.css';

const spades = (['A', 'K', 'Q', 'J', '9'] as const).map(rank => makeCard('S', rank));
const heart = makeCard('H', 'Q');
const cases: { name: string; width: number; cards: Card[]; phase: 'playing' | 'bury'; ledSuit: Suit | null; trump: Suit | null; selected: Card | null }[] = [
  { name: '横屏须跟与选中提示', width: 540, cards: [...spades, heart], phase: 'playing', ledSuit: 'S', trump: null, selected: spades[1] },
  { name: '窄手牌区须跟提示换行', width: 180, cards: [...spades, heart], phase: 'playing', ledSuit: 'S', trump: null, selected: spades[1] },
  { name: '窄手牌区缺门提示换行', width: 180, cards: spades, phase: 'playing', ledSuit: 'H', trump: 'S', selected: spades[1] },
  { name: '扣底提示与已选手牌', width: 180, cards: [...spades, heart], phase: 'bury', ledSuit: null, trump: null, selected: spades[1] },
  { name: '没有提示时的手牌', width: 180, cards: spades, phase: 'playing', ledSuit: null, trump: null, selected: null },
];

function LayoutRegression() {
  const root = useRef<HTMLElement>(null);
  const [results, setResults] = useState<string[]>([]);
  const check = () => {
    if (!root.current) return;
    const viewport = root.current.parentElement!;
    const rotated = Math.abs(new DOMMatrixReadOnly(getComputedStyle(viewport).transform).b) > 0.5;
    setResults(Array.from(root.current.querySelectorAll<HTMLElement>('[data-layout-case]')).map(section => {
      const tips = section.querySelector<HTMLElement>(`.${handStyles.tipStack}`);
      const cards = Array.from(section.querySelectorAll('button'));
      if (!tips || cards.length === 0) return `失败：${section.dataset.layoutCase}缺少组件`;
      if (tips.children.length === 0) return `通过：${section.dataset.layoutCase}（无提示）`;
      // 留出 6px，涵盖触屏伪元素在牌顶扩出的点击区域。
      // 旋转 90° 后，牌桌的纵向间距对应物理屏幕横轴，仍检验同一处留白。
      const gap = rotated
        ? tips.getBoundingClientRect().left - Math.max(...cards.map(card => card.getBoundingClientRect().right))
        : Math.min(...cards.map(card => card.getBoundingClientRect().top)) - tips.getBoundingClientRect().bottom;
      const passed = gap >= 6;
      return `${passed ? '通过' : '失败'}：${section.dataset.layoutCase}（间距 ${gap.toFixed(1)}px）`;
    }));
  };
  useLayoutEffect(check, []);
  return (
    <LandscapeViewport><main ref={root} style={{ padding: 16, height: '100%', overflow: 'auto' }}>
      <h1 style={{ fontSize: 20 }}>出牌提示布局回归</h1>
      <button type="button" onClick={check}>重新检查布局</button>
      <output aria-label="布局检查结果" style={{ display: 'block', whiteSpace: 'pre-line', marginBlock: 12 }}>
        {results.join('\n')}
      </output>
      {cases.map(test => (
        <section key={test.name} data-layout-case={test.name} style={{ width: test.width, maxWidth: '100%', marginBottom: 24 }}>
          <h2 style={{ fontSize: 16 }}>{test.name}</h2>
          <div style={{ '--card-w': '54px', '--card-h': '75.6px' } as CSSProperties}>
            <HumanHand
              cards={test.cards}
              phase={test.phase}
              humanTurn
              legalIds={new Set(test.cards.filter(card => test.ledSuit !== 'S' || card.suit === 'S').map(cardId))}
              selected={test.phase === 'bury' && test.selected ? [test.selected] : []}
              selectedPlayCard={test.phase === 'playing' ? test.selected : null}
              trump={test.trump}
              kittyIds={new Set()}
              ledSuit={test.ledSuit}
              confirmBeforePlay
              onCardClick={() => {}}
            />
          </div>
        </section>
      ))}
    </main></LandscapeViewport>
  );
}

createRoot(document.getElementById('root')!).render(<LayoutRegression />);
