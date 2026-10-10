import { createRoot } from 'react-dom/client';
import { bid, bury, createGame, currentSeat, declareTrump, legalMoves, playCard, sideOf, SEAT_NAMES } from './src/engine';
import { cardId, sortHand, SUIT_NAME, SUIT_SYMBOL } from './src/cards';
import { smartBury } from './src/ai/smart';
import Scoreboard from './src/components/Scoreboard';
import OpponentSeat from './src/components/OpponentSeat';
import TrickArea from './src/components/TrickArea';
import HumanHand from './src/components/HumanHand';
import ControlPanel from './src/components/ControlPanel';
import GameTools from './src/components/GameTools';
import SkinPicker from './src/components/SkinPicker';
import styles from './src/App.module.css';
import './src/styles/index.css';
const revealedSeat = Number(new URLSearchParams(location.search).get('seat') ?? 2);
const declarer = (revealedSeat + 2) % 4;
let game = createGame(39);
for (let i = 0; i < 4; i++) { const seat = currentSeat(game); game = bid(game, seat, seat === declarer ? 100 : null); }
game = declareTrump(game, declarer, 'S');
game = bury(game, declarer, smartBury(game, declarer));
while (currentSeat(game) !== 1) { const seat = currentSeat(game); game = playCard(game, seat, legalMoves(game, seat)[0]); }
const own = sortHand(game.hands[1]);
const noop = () => {};
createRoot(document.getElementById('root')!).render(
  <div className={styles.app}>
    <div className={styles.header}><Scoreboard game={game} humanSeat={1} /><SkinPicker skin="classic" onChange={noop} /></div>
    <div className={styles.workspace}>
      <main className={`${styles.table} ${styles.hasRevealedHand}`} aria-label="对局牌桌" data-phase="playing" data-revealed-seat={revealedSeat}>
        <div className={styles.tableBrand} aria-hidden="true">保山幺子分<span>四人搭档 · 百分争先</span></div>
        <div className={styles.tableHud}><span className={styles.trumpLabel}>主牌 {SUIT_SYMBOL[game.trump!]} {SUIT_NAME[game.trump!]}</span><div className={styles.roundScores}><span>庄 {SEAT_NAMES[declarer]} · 叫 100 分</span><span>庄方 <strong>0</strong> / 100 · 闲方 <strong>0</strong></span></div></div>
        {[0, 2, 3].map(seat => <OpponentSeat key={seat} seat={seat} cardCount={game.hands[seat].length} isTurn={currentSeat(game) === seat} isDeclarer={declarer === seat} isPartner={seat === revealedSeat} hasDeclarer isTeammate={sideOf(seat) === 1} isRevealed={seat === revealedSeat} revealedCards={seat === revealedSeat ? game.hands[seat] : undefined} trump={game.trump} points={0} />)}
        <TrickArea trick={game.trick} lastTrick={[]} lastWinner={null} lastPoints={0} kitty={game.kitty} phase="playing" compact prompt="" />
        <div className={styles.tableActions} aria-label="对局操作"><ControlPanel seat={1} humanSeat={1} phase="playing" highestBid={100} bidOptions={[]} kittySize={4} selected={[]} humanHand={own} selectedPlayCard={null} trick={game.trick} result={null} doBid={noop} doTrump={noop} doBury={noop} autoSelectBury={noop} clearSelectedBury={noop} confirmPlayCard={noop} goNextHand={noop} restart={noop} /></div>
        <div className={styles.playerArea}><div className={`${styles.southSeat} ${styles.turn}`}><div className={styles.avatarFrame}>南</div><div className={styles.seatName}>南（你）</div><span className={styles.seatMeta}>南北队 · {own.length} 张</span><span className={styles.southCompactMeta}>{own.length}张 0分</span><span className={styles.seatMeta}>闲家 · 吃分 0</span></div><div className={styles.handsArea}><HumanHand cards={own} phase="playing" humanTurn legalIds={new Set(legalMoves(game, 1).map(cardId))} selected={[]} selectedPlayCard={null} trump={game.trump} kittyIds={new Set()} ledSuit={game.trick[0]?.card.suit ?? null} onCardClick={noop} /></div></div>
      </main>
      <aside className={styles.toolbar}><GameTools phase="playing" completedTricks={0} speed="normal" onSpeedChange={noop} onOpenRules={noop} onOpenLedger={noop} onOpenLastTrick={noop} onOpenHistory={noop} /></aside>
    </div>
  </div>
);
