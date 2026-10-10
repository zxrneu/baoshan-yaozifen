/** 牌桌与阶段操作分区；对局状态和规则仍由 useGame 编排。 */
import { revealedPartnerSeat, sideOf, SEAT_NAMES, type GameState } from './engine';
import { SUIT_NAME, SUIT_SYMBOL } from './cards';
import { useGame } from './hooks/useGame';
import Scoreboard from './components/Scoreboard';
import GameTools from './components/GameTools';
import OpponentSeat from './components/OpponentSeat';
import TrickArea from './components/TrickArea';
import HumanHand from './components/HumanHand';
import ControlPanel from './components/ControlPanel';
import GameLog from './components/GameLog';
import RulesModal from './components/RulesModal';
import LastTrickModal from './components/LastTrickModal';
import PointsTrackerModal from './components/PointsTrackerModal';
import PlayHistoryModal from './components/PlayHistoryModal';
import HandResultModal from './components/HandResultModal';
import KittyRevealBanner from './components/KittyRevealBanner';
import RevealedHand from './components/RevealedHand';
import { useSkin } from './hooks/useSkin';
import SkinPicker from './components/SkinPicker';
import styles from './App.module.css';

function findLatestBid(bidding: GameState['bidding'], seat: number): number | null | undefined {
  for (let i = bidding.length - 1; i >= 0; i--) {
    if (bidding[i].seat === seat) return bidding[i].bid;
  }
  return undefined;
}

export default function App() {
  const g = useGame();
  const { skin, setSkin } = useSkin();
  const { game, seat, humanSeat } = g;
  const humanBid = findLatestBid(game.bidding, humanSeat);
  const revealedSeat = revealedPartnerSeat(game);
  const showRevealedHand = revealedSeat !== null && revealedSeat !== humanSeat;
  const seatPoints = (s: number) =>
    game.completedTricks.filter((t) => t.winner === s).reduce((sum, t) => sum + t.points, 0);
  const myTurn = seat === humanSeat;
  const actor = myTurn ? '你' : `${SEAT_NAMES[seat]}家`;
  const actionPrompt = game.phase === 'bidding' ? `${myTurn ? '轮到' : '等待'}${actor}叫分`
    : game.phase === 'trump' ? `${myTurn ? '请' : '等待'}${actor}定主`
    : game.phase === 'bury' ? `${myTurn ? '请' : '等待'}${actor}扣底`
    : game.phase === 'handEnd' || game.phase === 'matchEnd' ? '本副已结束' : '';

  return (
    <div className={styles.app}>
      <div className={styles.header}>
        <Scoreboard game={game} humanSeat={humanSeat} />
        <SkinPicker skin={skin} onChange={setSkin} />
      </div>
      <div className={styles.workspace}>
        <main className={styles.table} aria-label="对局牌桌" data-phase={game.phase}>
          <div className={styles.tableBrand} aria-hidden="true">保山幺子分<span>四人搭档 · 百分争先</span></div>
          <div className={styles.tableHud}>
            <span className={styles.trumpLabel}>
              {game.trump ? `主牌 ${SUIT_SYMBOL[game.trump]} ${SUIT_NAME[game.trump]}` : '尚未定主'}
            </span>
            {game.phase === 'bidding' ? (
              <span className={styles.tableMeta}>
                {game.highestBidder !== null ? `当前最高 ${SEAT_NAMES[game.highestBidder]} · ${game.highestBid} 分` : '起叫 70 分'}
              </span>
            ) : game.declarer !== null ? (
              <div className={styles.roundScores}>
                <span>庄 {SEAT_NAMES[game.declarer]} · 叫 {game.highestBid} 分</span>
                {(game.phase === 'playing' || game.result) && (
                  <span>庄方 <strong>{game.declarerTrickPoints + game.buriedPoints}</strong> / {game.highestBid} · 闲方 <strong>{game.defenderTrickPoints}</strong></span>
                )}
              </div>
            ) : null}
          </div>

          {[0, 2, 3].map((s) => (
            <OpponentSeat
              key={s}
              seat={s}
              cardCount={game.hands[s]?.length ?? 0}
              isTurn={seat === s}
              isDeclarer={game.declarer === s}
              isPartner={game.declarer !== null && game.declarer !== s && sideOf(s) === sideOf(game.declarer)}
              hasDeclarer={game.declarer !== null}
              isTeammate={sideOf(s) === sideOf(humanSeat)}
              isRevealed={revealedSeat === s}
              points={seatPoints(s)}
              biddingNote={game.phase === 'bidding' ? findLatestBid(game.bidding, s) : undefined}
              isBiddingPhase={game.phase === 'bidding'}
            />
          ))}

          <TrickArea
            trick={game.trick}
            lastTrick={game.lastTrick}
            lastWinner={game.lastWinner}
            lastPoints={game.lastPoints}
            kitty={game.kitty}
            phase={game.phase}
            prompt={actionPrompt}
          />

          <div className={styles.tableActions} aria-label="对局操作">
            <ControlPanel
              seat={seat}
              humanSeat={humanSeat}
              phase={game.phase}
              highestBid={game.highestBid}
              bidOptions={g.bidOptions}
              kittySize={game.kitty.length}
              selected={g.selected}
              humanHand={g.humanHand}
              selectedPlayCard={g.selectedPlayCard}
              trick={game.trick}
              result={game.result}
              doBid={g.doBid}
              doTrump={g.doTrump}
              doBury={g.doBury}
              autoSelectBury={g.autoSelectBury}
              clearSelectedBury={g.clearSelectedBury}
              confirmPlayCard={g.confirmPlayCard}
              goNextHand={g.goNextHand}
              restart={g.restart}
            />
          </div>

          <div className={styles.playerArea}>
            <div className={`${styles.southSeat} ${myTurn ? styles.turn : ''}`}>
              <div className={styles.avatarFrame} aria-hidden="true">南</div>
              <div className={styles.seatName}>南（你）</div>
              <span className={styles.seatMeta}>南北队 · {g.humanHand.length} 张</span>
              {revealedSeat === humanSeat && <span className={styles.bidNote}>明牌 · 所有人可见</span>}
              {game.declarer !== null && (
                <span className={styles.seatMeta}>
                  {game.declarer === humanSeat ? '庄家' : sideOf(humanSeat) === sideOf(game.declarer) ? '庄家搭档' : '闲家'} · 吃分 {seatPoints(humanSeat)}
                </span>
              )}
              {game.phase === 'bidding' && humanBid !== undefined && (
                <span className={styles.bidNote}>{humanBid === null ? '不叫' : `叫 ${humanBid} 分`}</span>
              )}
            </div>
            <HumanHand
              cards={g.humanHand}
              phase={game.phase}
              legalIds={g.humanLegal}
              selected={g.selected}
              selectedPlayCard={g.selectedPlayCard}
              trump={game.trump}
              kittyIds={g.humanKittyIds}
              ledSuit={game.trick.length > 0 ? game.trick[0].card.suit : null}
              onCardClick={g.onCardClick}
            />
          </div>
        </main>

        {showRevealedHand && (
          <RevealedHand
            seat={revealedSeat}
            cards={game.hands[revealedSeat]}
            trump={game.trump}
            isTeammate={sideOf(revealedSeat) === sideOf(humanSeat)}
            className={styles.revealedPanel}
          />
        )}

        <aside className={styles.toolbar} aria-label="对局工具栏">
          <span className={styles.tableCaption}>四人搭档 · 一副好牌，一桌老友</span>
          <GameTools
            phase={game.phase}
            completedTricks={game.completedTricks.length}
            speed={g.speed}
            onSpeedChange={g.setSpeed}
            onOpenRules={() => g.setShowRulesModal(true)}
            onOpenLedger={() => g.setShowPointsLedger(true)}
            onOpenLastTrick={() => g.setShowLastTrickModal(true)}
            onOpenHistory={() => g.setShowHistoryModal(true)}
          />
        </aside>
      </div>

      {g.toast && <div role={g.toast.bad ? 'alert' : 'status'} className={`${styles.toast} ${g.toast.bad ? styles.bad : ''}`}>{g.toast.text}</div>}
      <GameLog history={game.history} />
      {g.kittyRevealed && <KittyRevealBanner kittyCards={g.kittyRevealed} onDismiss={g.dismissKittyRevealed} />}
      {g.showHistoryModal && <PlayHistoryModal game={game} humanSeat={humanSeat} onClose={() => g.setShowHistoryModal(false)} />}
      {g.showRulesModal && <RulesModal onClose={() => g.setShowRulesModal(false)} />}
      {g.showLastTrickModal && <LastTrickModal lastTrick={game.lastTrick} lastWinner={game.lastWinner} lastPoints={game.lastPoints} onClose={() => g.setShowLastTrickModal(false)} />}
      {g.showPointsLedger && <PointsTrackerModal game={game} humanSeat={humanSeat} onClose={() => g.setShowPointsLedger(false)} />}
      {(game.phase === 'handEnd' || game.phase === 'matchEnd') && game.result && (
        <HandResultModal result={game.result} kitty={game.kitty} scores={game.scores} targetWins={game.targetWins} matchEnded={game.phase === 'matchEnd'} humanSeat={humanSeat} goNextHand={g.goNextHand} restart={g.restart} />
      )}
    </div>
  );
}
