import { SEAT_NAMES } from '../engine';
import styles from './TurnPointer.module.css';

interface Props {
  seat: number;
  isThinking: boolean;
  hasReadyDecision: boolean;
}

// 顺时针：北 → 东 → 南 → 西，与牌桌座位的位置一致。
const DIRECTIONS = ['east', 'south', 'west', 'north'] as const;

export default function TurnPointer({ seat, isThinking, hasReadyDecision }: Props) {
  if (seat < 0 || seat >= SEAT_NAMES.length) return null;
  const status = isThinking ? '思考中' : hasReadyDecision ? '已决定' : '等待决定';

  return (
    <div
      className={`${styles.pointer} ${isThinking ? styles.thinking : ''}`}
      role="status"
      aria-label={`当前轮到${SEAT_NAMES[seat]}家，${status}`}
      data-direction={DIRECTIONS[seat]}
    >
      <div className={styles.dial} aria-hidden="true">
        <span className={`${styles.mark} ${styles.north}`}>北</span>
        <span className={`${styles.mark} ${styles.east}`}>东</span>
        <span className={`${styles.mark} ${styles.south}`}>南</span>
        <span className={`${styles.mark} ${styles.west}`}>西</span>
        <svg className={styles.hand} viewBox="0 0 100 100">
          <path d="M50 7 L61 27 L54 24 L54 61 Q50 68 46 61 L46 24 L39 27 Z" />
        </svg>
        <span className={styles.pivot} />
      </div>
      <strong className={styles.label}>{SEAT_NAMES[seat]}家 · {status}</strong>
    </div>
  );
}
