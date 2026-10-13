/** 横屏视口：以单一职责封装方向适配，旋转牌桌及弹窗而不重建对局。 */
import type { ReactNode } from 'react';
import styles from './LandscapeViewport.module.css';

export default function LandscapeViewport({ children }: { children: ReactNode }) {
  return <div className={styles.surface}>
    <div className={styles.viewport} aria-label="横屏游戏区域">{children}</div>
  </div>;
}
