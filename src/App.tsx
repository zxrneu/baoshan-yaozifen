/**
 * 幺子分牌桌 UI（薄组合层）。
 * 状态与流程在 useGame 编排；展示拆分到 components/ 各组件。
 * 人坐在 1 号位（南），其余三家由默认启发式 AI 扮演。
 */
import { sideOf } from './engine';
import { useGame } from './hooks/useGame';
import Scoreboard from './components/Scoreboard';
import OpponentSeat from './components/OpponentSeat';
import TrickArea from './components/TrickArea';
import HumanHand from './components/HumanHand';
import ControlPanel from './components/ControlPanel';
import GameLog from './components/GameLog';

export default function App() {
  const g = useGame();
  const { game, seat, humanSeat } = g;

  return (
    <div className="app">
      <Scoreboard game={game} humanSeat={humanSeat} />

      <main className="table">
        {[0, 2, 3].map((s) => (
          <OpponentSeat
            key={s}
            seat={s}
            cardCount={game.hands[s]?.length ?? 0}
            isTurn={seat === s}
            isDeclarer={game.declarer === s}
            isPartner={sideOf(s) === sideOf(humanSeat)}
          />
        ))}

        <div className={`seat bottom ${seat === humanSeat ? 'turn' : ''}`}>
          <div className="seat-name">
            南（你）
            {game.declarer === humanSeat && <b className="badge">庄</b>}
          </div>
        </div>

        <TrickArea trick={game.trick} kitty={game.kitty} phase={game.phase} />

        <HumanHand
          cards={g.humanHand}
          phase={game.phase}
          legalIds={g.humanLegal}
          selected={g.selected}
          onCardClick={g.onCardClick}
        />
      </main>

      <ControlPanel
        seat={seat}
        humanSeat={humanSeat}
        phase={game.phase}
        highestBid={game.highestBid}
        bidOptions={g.bidOptions}
        kittySize={game.kitty.length}
        selectedCount={g.selected.length}
        trick={game.trick}
        result={game.result}
        doBid={g.doBid}
        doTrump={g.doTrump}
        doBury={g.doBury}
        goNextHand={g.goNextHand}
        restart={g.restart}
      />

      {g.toast && <div className={`toast ${g.toast.bad ? 'bad' : ''}`}>{g.toast.text}</div>}

      <GameLog history={game.history} />
    </div>
  );
}
