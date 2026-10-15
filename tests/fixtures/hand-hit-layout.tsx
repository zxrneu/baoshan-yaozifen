/** 浏览器命中回归：检查真实手牌中心的命中对象，防止叠牌使一次点击选中邻牌。 */
import { useLayoutEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import HumanHand from '@yaozifen/web/components/HumanHand';
import LandscapeViewport from '@yaozifen/web/components/LandscapeViewport';
import { cardId, cardLabel, makeCard } from '@yaozifen/game-core/cards';
import '../../apps/web/src/styles/index.css';
const cards = (['S','H','C','D'] as const).flatMap(suit => (['K','Q','J'] as const).map(rank => makeCard(suit,rank)));
function Fixture() {
  const [result,setResult]=useState(''); const [picked,setPicked]=useState(''); const [width,setWidth]=useState(390);
  const check=()=>{
    const buttons=[...document.querySelectorAll<HTMLButtonElement>('[aria-label="你的手牌，共 12 张"] button')];
    const unreachable=buttons.filter(button=>{
      const rect=button.getBoundingClientRect(); return !button.contains(document.elementFromPoint(rect.left+rect.width/2,rect.top+rect.height/2));
    });
    setResult(unreachable.length ? `失败：${unreachable.length} 张牌的中心被相邻牌遮挡` : `通过：${buttons.length} 张牌的中心均可点击`);
  };
  useLayoutEffect(check,[]);
  return <LandscapeViewport><main style={{padding:16,maxWidth:width,height:'100%',overflow:'auto'}}>
    <h1 style={{fontSize:18}}>窄屏手牌点击回归</h1>
    <label>手牌容器宽度 <select value={width} onChange={event=>setWidth(Number(event.target.value))}>
      <option value={390}>390</option><option value={600}>600</option><option value={900}>900</option>
    </select></label>
    <button onClick={check}>检查命中</button><p role="status">{result}</p><p>已点击：{picked || '无'}</p>
    <HumanHand cards={cards} phase="playing" humanTurn legalIds={new Set(cards.map(cardId))} selected={[]} selectedPlayCard={null} trump={null} kittyIds={new Set()} ledSuit={null} confirmBeforePlay onCardClick={card=>setPicked(cardLabel(card))}/>
  </main></LandscapeViewport>;
}
createRoot(document.getElementById('root')!).render(<Fixture/>);
