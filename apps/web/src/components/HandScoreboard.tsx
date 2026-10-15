/** 本副战况只投影公开分数与目标；单一职责，不查询手牌或参与规则决策。 */
import type { CSSProperties } from 'react';
import { SEAT_NAMES, type GameState } from '@yaozifen/game-core';
import TrumpBadge from './TrumpBadge';
import GameIcon from './GameIcon';
import styles from './HandScoreboard.module.css';

function ScoreProgress({ side, role, points, target, yours }: {
  side: number; role: '庄家' | '闲家'; points: number; target: number; yours: boolean;
}) {
  const progress = Math.min(points, target);
  return <div className={`${styles.scoreRow} ${role === '庄家' ? styles.declarer : styles.defender}`}>
    <div className={styles.scoreLabel}><span><GameIcon name={role === '庄家' ? 'crown' : 'shield'} />{side === 0 ? '东西' : '南北'} · {role}{yours ? '（你）' : ''}</span><strong>{points}<small> / {target}</small></strong></div>
    <div className={styles.track} role="progressbar" aria-label={`${role}锁定进度`} aria-valuemin={0} aria-valuemax={target} aria-valuenow={progress} aria-valuetext={`已吃 ${points} 分，锁定线 ${target} 分`}>
      <div style={{ '--progress': `${progress / target * 100}%` } as CSSProperties} />
    </div>
    <span className={styles.distance}>{points >= target ? '已到锁定线' : `还差 ${target - points} 分锁定`}</span>
  </div>;
}

export default function HandScoreboard({ game, humanSeat }: { game: GameState; humanSeat: number }) {
  const declarerPoints = game.result?.declarerPoints ?? game.declarerTrickPoints + game.buriedPoints;
  const defenderPoints = game.result?.defenderPoints ?? game.defenderTrickPoints;
  const scoring = game.phase === 'playing' || game.result !== null;
  return <section className={styles.summary} aria-label="本副战况">
    <div className={styles.heading}><h2>本副战况</h2><span>{game.phase === 'playing' ? `第 ${game.trickNumber} / 12 轮` : '四人 · 搭档吃分'}</span></div>
    <div className={styles.contract}>
      <TrumpBadge trump={game.trump} />
      <strong>{game.declarer === null ? '叫分中' : `${SEAT_NAMES[game.declarer]}家坐庄 · ${game.highestBid} 分`}</strong>
    </div>
    {game.declarer === null ? <p className={styles.bidInfo}>{game.highestBidder === null ? `起叫 ${game.rules.minBid} 分` : `当前最高：${SEAT_NAMES[game.highestBidder]}家 · ${game.highestBid} 分`}</p> : <div className={styles.scoreRows}>
      <ScoreProgress side={game.declarer % 2} role="庄家" points={declarerPoints} target={game.highestBid} yours={humanSeat >= 0 && humanSeat % 2 === game.declarer % 2} />
      <ScoreProgress side={1 - game.declarer % 2} role="闲家" points={defenderPoints} target={105 - game.highestBid} yours={humanSeat >= 0 && humanSeat % 2 !== game.declarer % 2} />
    </div>}
    <p className={styles.footnote}><GameIcon name="cards" />{scoring ? `未打出 ${Math.max(0, 100 - declarerPoints - defenderPoints)} 分 · 全副 100 分` : 'A / 10 各 10 分 · 5 为 5 分'}</p>
  </section>;
}
