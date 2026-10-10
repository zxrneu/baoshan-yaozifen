import type { Phase } from '../engine';
import type { GameSpeed } from '../hooks/useGame';
import styles from './GameTools.module.css';

interface Props {
  phase: Phase;
  completedTricks: number;
  speed: GameSpeed;
  onSpeedChange: (speed: GameSpeed) => void;
  onOpenHistory: () => void;
  onOpenLedger: () => void;
  onOpenLastTrick: () => void;
  onOpenRules: () => void;
}

export default function GameTools(props: Props) {
  const nextSpeed: Record<GameSpeed, GameSpeed> = { fast: 'normal', normal: 'slow', slow: 'fast' };
  const speedLabel: Record<GameSpeed, string> = { fast: '快速', normal: '正常', slow: '慢速' };
  return (
    <nav className={styles.tools} aria-label="对局工具">
      <button type="button" onClick={props.onOpenHistory}>出牌记录 · {props.completedTricks}</button>
      <button type="button" onClick={props.onOpenLedger}>分牌盘点</button>
      {props.phase === 'playing' && (
        <button type="button" disabled={props.completedTricks === 0} onClick={props.onOpenLastTrick}>上一轮</button>
      )}
      <button type="button" onClick={() => props.onSpeedChange(nextSpeed[props.speed])} aria-label={`对局速度：${speedLabel[props.speed]}，点击切换`}>
        速度 · {speedLabel[props.speed]}
      </button>
      <button type="button" onClick={props.onOpenRules}>规则</button>
    </nav>
  );
}
