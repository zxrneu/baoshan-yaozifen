import { SEAT_NAMES } from '../engine';
import type { SeatDecisionNotice } from '../hooks/useGame';
import { actionLabel } from '../workbench/actions';
import styles from './SeatActivity.module.css';

interface Props {
  seat: number;
  isTurn: boolean;
  isThinking: boolean;
  hasReadyDecision: boolean;
  notice: SeatDecisionNotice | null;
  onDismiss?: () => void;
}

export default function SeatActivity({ seat, isTurn, isThinking, hasReadyDecision, notice, onDismiss }: Props) {
  const position = ['east', 'south', 'west', 'north'][seat];
  const status = isThinking ? '思考中' : hasReadyDecision ? '已决定' : '等待决定';
  return (
    <>
      {isTurn && (
        <div
          className={`${styles.turnIndicator} ${styles[position]} ${isThinking ? styles.thinking : ''}`}
          role="status"
          aria-label={`当前轮到${SEAT_NAMES[seat]}家，${status}`}
        >
          <span className={styles.statusIcon} aria-hidden="true">{isThinking ? '◌' : '▶'}</span>
          <strong>{SEAT_NAMES[seat]}家 · {status}</strong>
          {isThinking && <span className={styles.thinkingDots} aria-hidden="true">···</span>}
        </div>
      )}
      {notice && (
        <div className={`${styles.decisionNotice} ${styles[position]}`} role="status" aria-label={`${SEAT_NAMES[seat]}家决策结果`}>
          <button type="button" className={styles.decisionText} onClick={onDismiss} title="点击隐藏决定提示">
            {actionLabel(notice.action)}
          </button>
        </div>
      )}
    </>
  );
}
