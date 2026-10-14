/** 主牌徽章仅显示已公开花色；图形与文字共同传达含义，不依赖颜色区分。 */
import { SUIT_NAME, type Suit } from '../cards';
import styles from './TrumpBadge.module.css';

const SUIT_PATH: Record<Suit, string> = {
  S: 'M12 2C9 6 3 9 3 13a5 5 0 0 0 8 4c0 3-2 4-2 4h6s-2-1-2-4a5 5 0 0 0 8-4c0-4-6-7-9-11Z',
  H: 'M12 21 3 12C-3 5 7-2 12 6 17-2 27 5 21 12Z',
  C: 'M10 11a5 5 0 1 1 4 0 5 5 0 1 1-1 7c0 2 2 3 2 3H9s2-1 2-3a5 5 0 1 1-1-7Z',
  D: 'm12 2 9 10-9 10-9-10Z',
};

export default function TrumpBadge({ trump }: { trump: Suit | null }) {
  return <span className={styles.badge} role="img" aria-label={trump ? `主牌：${SUIT_NAME[trump]}` : '等待定主'}>
    <span className={`${styles.tile} ${trump === 'H' || trump === 'D' ? styles.red : ''}`}>
      <svg width="28" height="32" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
        {trump ? <path d={SUIT_PATH[trump]} fill="currentColor" /> : <><rect x="3" y="2" width="18" height="20" rx="3" fill="none" stroke="currentColor" strokeWidth="1.5" /><path d="M9 9a3 3 0 1 1 4 3v2M13 17v1" fill="none" stroke="currentColor" strokeWidth="1.5" /></>}
      </svg>
    </span>
    <span className={styles.copy}><small>{trump ? '主牌' : '主牌待定'}</small>{trump && <strong>{SUIT_NAME[trump]}</strong>}</span>
  </span>;
}
