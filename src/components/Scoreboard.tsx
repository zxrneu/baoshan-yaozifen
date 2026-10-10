/** 顶栏仅呈现整场比分与当前阶段，工具统一放入操作侧栏。 */
import type { GameState } from '../engine';
import styles from './Scoreboard.module.css';

const PHASE_LABEL: Record<GameState['phase'], string> = {
  bidding: '叫分', trump: '定主', bury: '扣底', playing: '出牌',
  handEnd: '本副结束', matchEnd: '本场结束',
};

export default function Scoreboard({ game, humanSeat }: { game: GameState; humanSeat: number }) {
  const mySide = humanSeat % 2;
  const handNumber = game.scores[0] + game.scores[1] + (game.result ? 0 : 1);
  return (
    <header className={styles.topbar}>
      <div className={styles.titleSection}>
        <span className={styles.brandIcon} aria-hidden="true">♠</span>
        <h1>保山幺子分</h1>
        <span className={styles.phaseTag}>{PHASE_LABEL[game.phase]}阶段</span>
      </div>
      <div className={styles.scores} aria-label={`南北队 ${game.scores[1]} 胜，东西队 ${game.scores[0]} 胜`}>
        <span className={mySide === 1 ? styles.myTeam : ''}>南北队{mySide === 1 ? '（你）' : ''}</span>
        <strong>{game.scores[1]}</strong><span className={styles.divider}>∶</span><strong>{game.scores[0]}</strong>
        <span className={mySide === 0 ? styles.myTeam : ''}>东西队{mySide === 0 ? '（你）' : ''}</span>
      </div>
      <div className={styles.meta}>
        <span>第 {handNumber} 副 · 先胜 {game.targetWins} 副</span>
        {game.phase === 'playing' && <span>第 {game.trickNumber}/12 轮</span>}
      </div>
    </header>
  );
}
