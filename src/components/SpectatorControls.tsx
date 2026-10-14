/** 观战控制只提供节奏与查看入口，四座 AI 的推进由 useGame 统一编排。 */
import type { GameController } from '../hooks/useGame';
import styles from './SpectatorControls.module.css';
import HandReplayButton, { type HandReplayProps } from './HandReplayButton';
export default function SpectatorControls({ game: g, onExitPractice, onReplay }: HandReplayProps & { game: GameController; onExitPractice?: () => void }) {
  const practiceEnded = !!onExitPractice && !g.presentation && g.game.phase === 'matchEnd';
  return <aside className={styles.panel} aria-label="观战节奏控制">
    <span className={styles.eyebrow}>四座 AI 对局</span><h2>慢慢看，每一步都看得见</h2>
    <p role="status">{g.sessionMode === 'auto' ? '正在观看' : '已暂停'}{g.presentation ? ` · ${g.presentation.title}` : g.isThinking ? ' · AI 正在思考' : ''}</p>
    <div className={styles.buttons}>
      <button type="button" className="primary-btn" onClick={g.sessionMode === 'auto' ? g.pause : () => g.setIsStepMode(false)} disabled={practiceEnded || (g.sessionMode !== 'auto' && g.saveState.status === 'error')}>{g.sessionMode === 'auto' ? '暂停' : '继续'}</button>
      <button type="button" className="ghost-btn" onClick={() => void g.stepNext()} disabled={practiceEnded || (g.isThinking && !g.presentation)}>下一步</button>
    </div>
    <p className={styles.tip}>空格：下一步<br/>点头像看决策原因，点牌放大查看。查看时自动暂停，返回后点击继续。</p>
    <label className={styles.speed}>观看速度 <select value={g.speed} onChange={event => g.setSpeed(event.target.value as GameController['speed'])}><option value="slow">慢速</option><option value="normal">正常</option><option value="fast">快速</option></select></label>
    {!g.presentation && (g.game.phase === 'handEnd' || g.game.phase === 'matchEnd') && <><HandReplayButton saveState={g.saveState} onReplay={onReplay}/>{onExitPractice ? <button type="button" className="primary-btn" onClick={onExitPractice}>返回标准对局</button> : <button type="button" className="primary-btn" onClick={g.goNextHand}>{g.game.phase === 'matchEnd' ? '再看一场' : '下一副'}</button>}</>}
    <button type="button" className="ghost-btn" onClick={g.toggleSoundMute}>{g.soundMuted ? '开启音效' : '关闭音效'}</button>
    <button type="button" className="ghost-btn" onClick={g.stopSpectating}>退出观战</button>
  </aside>;
}
