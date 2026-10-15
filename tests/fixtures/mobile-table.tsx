/** 手机布局验收夹具：复用正式牌桌与座位，仅替换对局状态为公开固定题目。 */
import { useState } from 'react';
import { createRoot } from 'react-dom/client';
import LandscapeViewport from '@yaozifen/web/components/LandscapeViewport';
import HumanHand from '@yaozifen/web/components/HumanHand';
import OpponentSeat from '@yaozifen/web/components/OpponentSeat';
import TrickArea from '@yaozifen/web/components/TrickArea';
import ControlPanel from '@yaozifen/web/components/ControlPanel';
import KittyRevealBanner from '@yaozifen/web/components/KittyRevealBanner';
import { freshDeck, cardId, type Card } from '@yaozifen/game-core/cards';
import { thinkingService } from '@yaozifen/ai-core/engines/thinkingService';
import styles from '../../apps/web/src/App.module.css';
import '../../apps/web/src/styles/index.css';
const phase = new URLSearchParams(location.search).get('phase') === 'bury' ? 'bury' : 'playing';
const revealed = new URLSearchParams(location.search).has('revealed');
const cards = freshDeck().slice(0, phase === 'bury' ? 16 : 12);
function Fixture() {
  const [selected, setSelected] = useState<Card | null>(null);
  const [played, setPlayed] = useState(false);
  const [kittyOpen, setKittyOpen] = useState(new URLSearchParams(location.search).has('kitty'));
  return <LandscapeViewport><div className={styles.app}>
    <header className={styles.header} aria-label="牌桌顶栏"><h1>保山幺子分</h1><button onClick={() => { thinkingService.startThinking(3, '正在思考'); thinkingService.finishThinking(3, '西家坐庄 · 95 分，评估本轮合法出牌并选择最佳结果。', undefined, true); }}>显示决策结论</button></header>
    <div className={styles.workspace}><main aria-label="牌桌" data-phase={phase} data-revealed-position={revealed ? 'top' : undefined} className={`${styles.table} ${revealed ? styles.hasRevealedHand : ''}`}>
      <div className={styles.tableHud}>西家坐庄 · 95 分</div>
      {[0, 2, 3].map(seat => <OpponentSeat key={seat} seat={seat} cardCount={12} isTurn={false} isDeclarer={seat === 2} isPartner={false} hasDeclarer isTeammate={seat === 3} engineLabel="Bridge" isRevealed={revealed && seat === 3} revealedCards={revealed && seat === 3 ? cards : undefined} />)}
      <TrickArea trick={[]} lastTrick={[]} lastWinner={null} lastPoints={0} kitty={[]} phase={phase} prompt="请选择手牌" compact={revealed} />
      <div className={styles.tableActions} aria-label="对局操作"><ControlPanel seat={1} humanSeat={1} phase={phase} highestBid={95} bidOptions={[]} kittySize={4} selected={[]} humanHand={cards} selectedPlayCard={selected} trick={[]} result={null} confirmBeforePlay doBid={() => {}} doTrump={() => {}} doBury={() => {}} autoSelectBury={() => {}} clearSelectedBury={() => {}} confirmPlayCard={() => setPlayed(true)} goNextHand={() => {}} restart={() => {}} /></div>
      <div className={styles.playerArea}><div className={styles.southSeat}>南家 · 你</div><div className={styles.handsArea} aria-label="我的手牌"><HumanHand cards={cards} phase={phase} humanTurn legalIds={new Set(cards.map(cardId))} selected={[]} selectedPlayCard={selected} trump="H" kittyIds={new Set()} ledSuit={null} confirmBeforePlay onCardClick={setSelected}/></div></div>
      {played && <output>已出牌</output>}
    </main><aside className={styles.toolbar}>对局工具栏</aside></div>
    {kittyOpen && <KittyRevealBanner kittyCards={cards.slice(0, 4)} onDismiss={() => setKittyOpen(false)} />}
  </div></LandscapeViewport>;
}
createRoot(document.getElementById('root')!).render(<Fixture />);
