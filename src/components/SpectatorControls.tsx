/** 观战控制只提供节奏与查看入口，四座 AI 的推进由 useGame 统一编排。 */
import type { ReactNode } from 'react';
import type { GameController } from '../hooks/useGame';
import styles from './SpectatorControls.module.css';
import HandReplayButton, { type HandReplayProps } from './HandReplayButton';
import HandScoreboard from './HandScoreboard';
import GameLog from './GameLog';
import { currentSeat, SEAT_NAMES } from '../engine';
import { seatEngineLabel } from '../ai/engines/engineLabels';
import GameIcon from './GameIcon';
export default function SpectatorControls({ game: g, onExitPractice, onReplay, actionPresentation }: HandReplayProps & { game: GameController; actionPresentation?: ReactNode; onExitPractice?: () => void }) {
  const practiceEnded = !!onExitPractice && !g.presentation && g.game.phase === 'matchEnd';
  const displayedGame = g.presentation?.game ?? g.game;
  const actor = g.presentation?.seat ?? currentSeat(displayedGame);
  return <aside className={styles.panel} aria-label="观战节奏控制">
    <h2>观战信息</h2>
    <p role="status" aria-label="当前行动">{g.sessionMode === 'auto' ? '正在观看' : '已暂停'}{g.presentation ? ` · ${g.presentation.title}` : g.isThinking ? ' · AI 正在思考' : ''}{actor >= 0 && ` · ${SEAT_NAMES[actor]}家 · ${seatEngineLabel(g.engineManager, actor, true)}`}</p>
    <HandScoreboard game={displayedGame} humanSeat={-1} />
    {actionPresentation}
    <div className={styles.toolbar} role="group" aria-label="观战操作">
      <div className={styles.controlGroup}>
        <button type="button" className={`primary-btn ${styles.next}`} onClick={() => void g.stepNext()} disabled={practiceEnded || (g.isThinking && !g.presentation)}><GameIcon name="step" />下一步</button>
        <label className={styles.speed}><GameIcon name="speed" /><span>速度</span><select aria-label="观看速度" value={g.speed} onChange={event => g.setSpeed(event.target.value as GameController['speed'])}><option value="slow">慢速</option><option value="normal">正常</option><option value="fast">快速</option></select></label>
      </div>
      <div className={styles.controlGroup}>
        <button type="button" className={`ghost-btn ${styles.sound}`} aria-label="观战音效" aria-pressed={!g.soundMuted} onClick={g.toggleSoundMute}><GameIcon name={g.soundMuted ? 'muted' : 'volume'} /><span>音效</span><span className={styles.soundState}>{g.soundMuted ? '关' : '开'}</span></button>
        <button type="button" className="ghost-btn" onClick={g.stopSpectating}><GameIcon name="exit" />退出观战</button>
      </div>
    </div>
    <p className={styles.tip}>空格：下一步<br/>点头像看决策原因，点牌放大查看。查看时自动暂停，返回后点击顶栏开始。</p>
    {!g.presentation && (g.game.phase === 'handEnd' || g.game.phase === 'matchEnd') && <div className={styles.controlGroup}><HandReplayButton saveState={g.saveState} onReplay={onReplay}/>{onExitPractice ? <button type="button" className="primary-btn" onClick={onExitPractice}>返回标准对局</button> : <button type="button" className="primary-btn" onClick={g.goNextHand}>{g.game.phase === 'matchEnd' ? '再看一场' : '下一副'}</button>}</div>}
    <GameLog history={g.game.history} actions={g.observedActions} />
  </aside>;
}
