/** 浏览器回归夹具只检查真实牌桌几何与选择反馈；隔离 AI、服务端和持久化副作用。 */
import { useLayoutEffect, useMemo, useState } from 'react';
import { createRoot } from 'react-dom/client';
import SquareTable from '../../src/components/SquareTable';
import LandscapeViewport from '../../src/components/LandscapeViewport';
import { createGame, SEAT_NAMES } from '../../src/engine';
import { type Card, cardLabel } from '../../src/cards';
import '../../src/styles/index.css';

function Fixture() {
  const [seat, setSeat] = useState(1);
  const [selected, setSelected] = useState<Card | null>(null);
  const [result, setResult] = useState('');
  const game = useMemo(() => {
    const value = createGame(42); value.phase = 'playing'; value.declarer = 1;
    value.highestBid = 85; value.trump = 'C'; value.leader = seat;
    return value;
  }, [seat]);
  const check = () => {
    const buttons = [...document.querySelectorAll<HTMLButtonElement>('[data-seat-hand] button')];
    const misses = buttons.filter(button => {
      const rect = button.getBoundingClientRect();
      return !button.contains(document.elementFromPoint(rect.x + rect.width / 2, rect.y + rect.height / 2));
    });
    setResult(misses.length ? `失败：${misses.length}/${buttons.length} 张牌的中心未命中本牌：${misses.map(b => b.getAttribute('aria-label')).join('、')}` : `通过：${buttons.length} 张牌的中心均命中本牌`);
  };
  useLayoutEffect(check, [seat, selected]);
  return <LandscapeViewport><div className="game-content" style={{height:'100%',overflow:'auto',padding:12}}>
    <h1 style={{fontSize:18,margin:'0 0 8px'}}>Debug 牌桌命中回归</h1>
    <label>行动座位 <select aria-label="行动座位" value={seat} onChange={event => {setSeat(Number(event.target.value));setSelected(null);}}>{SEAT_NAMES.map((name,index)=><option key={name} value={index}>{name}家</option>)}</select></label>
    <button onClick={check}>检查牌面中心</button><span role="status">{result}</span>
    <p>已选：{selected ? cardLabel(selected) : '无'} · 手机可滚动查看四座牌桌，滚动后重新检查。</p>
    <SquareTable game={game} humanSeat={1} seat={seat} visibleHandSeats={new Set([0,1,2,3])}
      selectedPlayCard={selected} aiHintCard={null} selectedBuryCards={[]} bidOptions={[]}
      onHumanCardClick={setSelected} onManualPlaySeat={() => {}} confirmPlayCard={() => {}}
      doBid={() => {}} doTrump={() => {}} doBury={() => {}} autoSelectBury={() => {}}
      clearSelectedBury={() => {}} goNextHand={() => {}} restart={() => {}} />
  </div></LandscapeViewport>;
}
createRoot(document.getElementById('root')!).render(<Fixture />);
