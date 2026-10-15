/** 主牌徽章仅显示已公开花色；图形与文字共同传达含义，不依赖颜色区分。 */
import { SUIT_NAME, type Suit } from '../cards';
import { SUIT_PATH } from '../suitShapes';
import styles from './TrumpBadge.module.css';

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
