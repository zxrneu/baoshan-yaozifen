/** 顶栏：局况一览（比分、主牌、庄家、吃分进度） */
import { SUIT_NAME, SUIT_SYMBOL } from '../cards';
import { SEAT_NAMES, SIDE_NAMES, GameState } from '../engine';

interface Props {
  game: GameState;
  humanSeat: number;
}

const PHASE_LABEL: Record<string, string> = {
  bidding: '叫分', trump: '定主', bury: '扣底', playing: '出牌',
  handEnd: '本副结束', matchEnd: '本场结束',
};

export default function Scoreboard({ game, humanSeat }: Props) {
  return (
    <header className="topbar">
      <h1>保山幺子分 <em>baoshan-yaozifen</em></h1>
      <div className="phase-tag">{PHASE_LABEL[game.phase]}</div>
      <div className="scores">
        {[0, 1].map((s) => (
          <span key={s} className={s === humanSeat % 2 ? 'me' : ''}>
            {SIDE_NAMES[s]} {game.scores[s]}
          </span>
        ))}
        <span className="target">先胜 {game.targetWins} 副</span>
      </div>
      <div className="meta">
        {game.trump && (
          <span className="trump-chip">主 {SUIT_SYMBOL[game.trump]}{SUIT_NAME[game.trump]}</span>
        )}
        {game.highestBidder !== null && (
          <span>庄 {SEAT_NAMES[game.declarer!]} · 叫 {game.highestBid}</span>
        )}
        <span>底牌 {game.kitty.length} 张</span>
        <span>第 {game.trickNumber}/12 墩</span>
        <span className="pts-live">
          吃分 庄 {game.declarerTrickPoints + game.buriedPoints} · 闲 {game.defenderTrickPoints}
        </span>
      </div>
    </header>
  );
}
